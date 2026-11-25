import 'server-only';

// src/lib/server/services/quote-requests.ts: what staff read and change (docs/architecture.md "Inbox reads" and "Inbox writes").
//
//   listQuoteRequests     GET  /api/quote-requests                     list_quote_requests() only, typed parameters, keyset cursor
//   getQuoteRequest       GET  /api/quote-requests/{id}                the request, its signed photo URLs and the GHL state
//   listQuoteRequestPhotos GET /api/quote-requests/{id}/photos         fresh signed URLs
//   saveQuote             PUT  /api/quote-requests/{id}/quote          save_quote_request_quote() (version checked)
//   changeQuoteRequestStatus POST /api/quote-requests/{id}/status-changes change_quote_request_status() (version checked)
//   getCurrentWeeklyCount GET  /api/weekly-counts/current              weekly_counts()
//
// Every function takes the user-scoped client from requireStaff(): the queries run under RLS as that staff member, and this
// module never uses the service-role client (it is not on the SECURITY_MODEL invariant 2 list). No filter string is ever
// built from input (S0 SEC-13): the list is one RPC call with typed parameters, everything else filters with .eq().
// Database and Storage text never reaches a response or a log line: failures are { error_class, code } only (invariant 11).
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  ChangeQuoteRequestStatusBody,
  ListQuoteRequestsQueryParams,
  SaveQuoteBody,
  listQuoteRequestsQueryQMax,
  saveQuoteBodyNoteMax,
} from '@/lib/api/generated/inbox/inbox.zod';
import type {
  GhlState,
  Photo,
  QuoteRequestDetail,
  QuoteRequestPage,
  Status,
  StatusChangeResult,
  Urgency,
  WeeklyCount,
} from '@/lib/api/generated/model';
import { UNPARSEABLE, dbProblem, errorFields, ProblemError, type DbError, type FieldError } from '@/lib/server/http';
import { logLine } from '@/lib/server/log';
import type { Database } from '@/types/database';

type Db = SupabaseClient<Database>;

const BUCKET = 'quote-photos';
/** The contract: signed photo URLs last 900 seconds. */
const SIGNED_URL_SECONDS = 900;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The problem for a failed database call. The staff operations list no 503 in the contract, so an unreachable or overloaded
 * database is a 500 internal_error here (the same call BE2 made for requireStaff); PT401, PT404, PT409 and PT422 keep their
 * own answers. Only the SQLSTATE reaches the log line.
 */
function staffDbProblem(error: DbError): ProblemError {
  const problem = dbProblem(error);
  if (problem.status !== 503) return problem;
  return new ProblemError(500, 'internal_error', { errorClass: problem.errorClass, logCode: problem.logCode });
}

/** A canonical UTC ISO 8601 time (millisecond precision, `Z`) for a timestamp the database returned, or null. */
function iso(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function requiredIso(value: string | null | undefined): string {
  const result = iso(value);
  if (result === null) throw new ProblemError(500, 'internal_error', { errorClass: 'BadTimestamp', logCode: 'none' });
  return result;
}

const notFound = () => new ProblemError(404, 'not_found');
const badRequest = () => new ProblemError(400, 'bad_request');

// ---- validation helpers ------------------------------------------------------------------------------------------------

const MESSAGES: Record<string, string> = {
  status: 'Choose New, Quoted, Won or Lost',
  q: 'Search text must be 1 to 100 characters',
  limit: 'Page size must be a whole number from 1 to 100',
  price_cents: 'Enter an amount from 0.01 to 99,999.99 with at most 2 decimals',
  note: 'The note can be at most 1,000 characters',
  to_status: 'Choose New, Quoted, Won or Lost',
  version: 'Reload the request and try again',
};

/** zod issues as { field, message }, one per field, with our own text (zod's own messages are never sent). */
function validationErrors(error: z.ZodError): FieldError[] {
  const seen = new Map<string, FieldError>();
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const field = key.slice(0, 60);
        if (!seen.has(field)) seen.set(field, { field, message: 'This field is not accepted' });
      }
      continue;
    }
    const first = issue.path[0];
    const field = typeof first === 'string' ? first : 'request';
    if (!seen.has(field)) seen.set(field, { field, message: MESSAGES[field] ?? 'Check this answer' });
  }
  return [...seen.values()];
}

/** A JSON body that is a plain object, or a 400 (not JSON, too large, an array, a string...). */
function objectBody(body: unknown): Record<string, unknown> {
  if (body === UNPARSEABLE || typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest();
  return body as Record<string, unknown>;
}

/** Postgres text cannot hold a NUL character or a lone surrogate: refuse them as a field error instead of a database 500. */
function unstorable(text: string): boolean {
  return text.includes('\u0000') || !text.isWellFormed();
}

/**
 * Longer than `max` characters, counted as the contract and Postgres count them (code points). zod's own `max` counts UTF-16
 * units, which would refuse 600 emoji as "1,200 characters"; the string schemas below leave the upper bound to this check.
 */
function overLength(text: string, max: number): boolean {
  return text.length > max && [...text].length > max;
}

// ---- the list ----------------------------------------------------------------------------------------------------------

/** What PostgREST returns for a timestamptz: UTC, microseconds, `+00:00`. The cursor keeps it verbatim (Date only has milliseconds). */
const CURSOR_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,6})?(?:\+00:00|Z)$/;
const CURSOR_PREFIX = 'c1.';
const MAX_CURSOR_LENGTH = 200;

export type ListAfter = { submittedAt: string; id: string };

export function encodeCursor(after: ListAfter): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify([after.submittedAt, after.id]), 'utf8').toString('base64url');
}

/**
 * Decode and validate a cursor before anything is sent to the database (S0 SEC-13). Anything that is not exactly what
 * encodeCursor writes (a calendar-valid UTC time and a lower-case uuid) is a 400 bad_request, never a database error.
 */
export function decodeCursor(cursor: string): ListAfter {
  if (cursor.length > MAX_CURSOR_LENGTH || !cursor.startsWith(CURSOR_PREFIX)) throw badRequest();
  const encoded = cursor.slice(CURSOR_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw badRequest();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw badRequest();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw badRequest();
  const [submittedAt, id] = parsed as unknown[];
  if (typeof submittedAt !== 'string' || typeof id !== 'string' || !UUID.test(id)) throw badRequest();
  const match = CURSOR_TIME.exec(submittedAt);
  if (match === null) throw badRequest();
  // calendar check: 2026-02-31 would roll over into March, so the round trip through Date must give the same date and time
  const whole = match[1] ?? '';
  const roundTrip = new Date(`${whole}Z`);
  if (Number.isNaN(roundTrip.getTime()) || roundTrip.toISOString().slice(0, 19) !== whole) throw badRequest();
  return { submittedAt, id };
}

export type ListQuery = { status?: Status; q?: string; limit: number; after?: ListAfter };

const ListQuerySchema = ListQuoteRequestsQueryParams.omit({ cursor: true }).extend({ q: z.string().min(1).optional() }).strict();

/**
 * The query string of GET /api/quote-requests as a validated ListQuery. The cursor is decoded first (a bad cursor is 400);
 * then the generated contract schema checks status, q and limit (422 naming the field), and any other parameter is a 422 too.
 */
export function parseListQuery(params: URLSearchParams): ListQuery {
  const cursors = params.getAll('cursor');
  if (cursors.length > 1) throw badRequest();
  const after = cursors[0] === undefined ? undefined : decodeCursor(cursors[0]);

  const raw: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    if (key === 'cursor') continue;
    const values = params.getAll(key);
    raw[key] = values.length === 1 ? values[0] : values; // a repeated parameter fails the schema
  }
  if (typeof raw.limit === 'string' && /^[0-9]{1,6}$/.test(raw.limit)) raw.limit = Number(raw.limit);

  const parsed = ListQuerySchema.safeParse(raw);
  const errors = parsed.success ? [] : validationErrors(parsed.error);
  if (typeof raw.q === 'string' && (unstorable(raw.q) || overLength(raw.q, listQuoteRequestsQueryQMax)) && !errors.some((e) => e.field === 'q')) {
    errors.push({ field: 'q', message: MESSAGES.q ?? 'Check this answer' });
  }
  if (!parsed.success || errors.length > 0) throw new ProblemError(422, 'validation_failed', { errors });

  const { status, q, limit } = parsed.data;
  return { ...(status === undefined ? {} : { status }), ...(q === undefined ? {} : { q }), limit, ...(after === undefined ? {} : { after }) };
}

/**
 * listQuoteRequests: one call to list_quote_requests() with typed parameters (RLS decides what the caller sees: submitted
 * rows only). Asks for limit + 1 rows to know whether a next page exists; the cursor is the last row that is returned.
 */
export async function listQuoteRequests(db: Db, query: ListQuery): Promise<QuoteRequestPage> {
  const { data, error } = await db.rpc('list_quote_requests', {
    p_status: query.status,
    p_q: query.q,
    p_after_submitted_at: query.after?.submittedAt,
    p_after_id: query.after?.id,
    p_limit: query.limit + 1,
  });
  if (error) throw staffDbProblem(error);

  const rows = data ?? [];
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    data: page.map((row) => ({
      id: row.id,
      reference: row.reference,
      name: row.name,
      urgency: row.urgency as Urgency,
      status: row.status as Status,
      submitted_at: requiredIso(row.submitted_at),
      version: row.version,
    })),
    next_cursor: rows.length > query.limit && last !== undefined ? encodeCursor({ submittedAt: last.submitted_at, id: last.id }) : null,
  };
}

// ---- photos ------------------------------------------------------------------------------------------------------------

type PhotoRow = { position: number; content_type: string; storage_path: string };

/**
 * Signed URLs for a request's photos, created with the staff member's own token (invariant 6), valid 900 seconds. A photo
 * Storage could not sign, or all of them when Storage is down, get url null and expires_at null ("Photo unavailable",
 * AC-005.7): the rest of the answer is still sent. The URL itself is never logged.
 */
async function signPhotos(db: Db, rows: PhotoRow[], requestId: string): Promise<Photo[]> {
  if (rows.length === 0) return [];
  const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString(); // taken before signing: never later than the real expiry
  const signed = new Map<string, string>();
  try {
    const result = await db.storage.from(BUCKET).createSignedUrls(
      rows.map((row) => row.storage_path),
      SIGNED_URL_SECONDS,
    );
    if (result.error) {
      logLine('warn', { quote_request_id: requestId, outcome: 'photo_signing_failed', error_class: 'storage', code: 'sign' });
    } else {
      for (const item of result.data ?? []) {
        if (item.path !== null && item.error === null && item.signedUrl) signed.set(item.path, item.signedUrl);
      }
    }
  } catch (error) {
    logLine('warn', { quote_request_id: requestId, outcome: 'photo_signing_failed', ...errorFields(error) });
  }
  return rows.map((row) => {
    const url = signed.get(row.storage_path) ?? null;
    return {
      position: row.position,
      content_type: row.content_type as Photo['content_type'],
      url,
      expires_at: url === null ? null : expiresAt,
    };
  });
}

/** listQuoteRequestPhotos: fresh signed URLs in position order; 404 for an unknown or pending request. */
export async function listQuoteRequestPhotos(db: Db, requestId: string): Promise<{ data: Photo[] }> {
  if (!UUID.test(requestId)) throw notFound();
  const [request, photos] = await Promise.all([
    db.from('quote_requests').select('id').eq('id', requestId).maybeSingle(),
    db.from('quote_photos').select('position, content_type, storage_path').eq('request_id', requestId).order('position', { ascending: true }),
  ]);
  if (request.error) throw staffDbProblem(request.error);
  if (photos.error) throw staffDbProblem(photos.error);
  if (!request.data) throw notFound();
  return { data: await signPhotos(db, photos.data ?? [], requestId) };
}

// ---- the detail and its GoHighLevel state ------------------------------------------------------------------------------

/** A sync job as the detail needs it. */
export type JobView = { state: string; last_attempt_at: string | null };

/**
 * The contract's `ghl` object from the request's consent and its job rows (docs/architecture.md "GHL state shown on SCR-06").
 * No consent: copy is not_copied_no_consent with at null and stage_tag is null (such a request has no job rows).
 * copy: succeeded is copied, failed is failed, pending and waiting are waiting (at = last attempt, null before the first).
 * stage_tag: the newest non-superseded stage-tag job decides (succeeded up_to_date, failed failed, pending and waiting
 * waiting); with no such job it follows the copy, because the contact is created or linked with the current stage tag.
 */
export function mapGhlState(consent: boolean, copyJob: JobView | undefined, tagJob: JobView | undefined): GhlState {
  if (!consent) return { copy: { state: 'not_copied_no_consent', at: null }, stage_tag: null };

  const copyState = copyJob?.state === 'succeeded' ? 'copied' : copyJob?.state === 'failed' ? 'failed' : 'waiting';
  const copyAt = iso(copyJob?.last_attempt_at);
  const copy: GhlState['copy'] = { state: copyState, at: copyAt };

  if (tagJob !== undefined) {
    const state = tagJob.state === 'succeeded' ? 'up_to_date' : tagJob.state === 'failed' ? 'failed' : 'waiting';
    return { copy, stage_tag: { state, at: iso(tagJob.last_attempt_at) } };
  }
  const followed = copyState === 'copied' ? 'up_to_date' : copyState;
  return { copy, stage_tag: { state: followed, at: copyAt } };
}

const REQUEST_COLUMNS =
  'id, reference, name, phone, email, address, problem, urgency, status, status_changed_at, submitted_at, price_cents, currency, note, photo_count, last_staff_update_at, marketing_consent, marketing_consent_at, version, staff:last_staff_update_by(display_name)';

/** The request with its photos and GHL state, read under the caller's RLS. 404 when it is unknown or still pending. */
async function loadDetail(db: Db, requestId: string): Promise<QuoteRequestDetail> {
  if (!UUID.test(requestId)) throw notFound();
  const [request, photos, copyJobs, tagJobs] = await Promise.all([
    db.from('quote_requests').select(REQUEST_COLUMNS).eq('id', requestId).maybeSingle(),
    db.from('quote_photos').select('position, content_type, storage_path').eq('request_id', requestId).order('position', { ascending: true }),
    db
      .from('ghl_sync_jobs')
      .select('state, last_attempt_at')
      .eq('request_id', requestId)
      .eq('kind', 'contact_copy')
      .order('created_at', { ascending: false })
      .limit(1),
    db
      .from('ghl_sync_jobs')
      .select('state, last_attempt_at')
      .eq('request_id', requestId)
      .eq('kind', 'stage_tag')
      .neq('state', 'superseded')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  for (const part of [request, photos, copyJobs, tagJobs]) if (part.error) throw staffDbProblem(part.error);
  const row = request.data;
  if (!row) throw notFound();
  if (row.reference === null) throw new ProblemError(500, 'internal_error', { errorClass: 'BadRow', logCode: 'none' });

  const lastUpdatedAt = iso(row.last_staff_update_at);
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    problem: row.problem,
    urgency: row.urgency as Urgency,
    status: row.status as Status,
    status_changed_at: iso(row.status_changed_at),
    submitted_at: requiredIso(row.submitted_at),
    price_cents: row.price_cents,
    currency: 'CAD',
    note: row.note,
    photo_count: row.photo_count,
    photos: await signPhotos(db, photos.data ?? [], requestId),
    last_updated: lastUpdatedAt === null ? null : { by_display_name: row.staff?.display_name ?? null, at: lastUpdatedAt },
    marketing_consent: row.marketing_consent,
    marketing_consent_at: iso(row.marketing_consent_at),
    ghl: mapGhlState(row.marketing_consent, copyJobs.data?.[0], tagJobs.data?.[0]),
    version: row.version,
  };
}

/** getQuoteRequest. */
export function getQuoteRequest(db: Db, requestId: string): Promise<QuoteRequestDetail> {
  return loadDetail(db, requestId);
}

// ---- price and note ----------------------------------------------------------------------------------------------------

/**
 * `version` as the database can hold it. quote_requests.version and the p_expected_version argument of both write functions
 * are 32-bit integers; the generated schema stops at a safe JavaScript integer, so a number above 2,147,483,647 used to reach
 * the database, fail there with SQLSTATE 22003 and answer 500 (BUG-QA2-4). Anything outside 1 to 2,147,483,647 is a 422
 * naming `version`, before any database call. (docs/openapi.yaml has no `maximum` yet: deferred contract question CQ-QA2-1.)
 */
const INT32_MAX = 2_147_483_647;
const Version = z.int().min(1).max(INT32_MAX);

const SaveSchema = SaveQuoteBody.extend({ note: z.string().nullable(), version: Version }).strict();

/**
 * saveQuote: validate (422 naming the field), then save_quote_request_quote() in one transaction: a stale version is 409
 * and nothing changes, an unknown or pending id is 404. The first price ever saved records quote_request_quoted inside the
 * function, once. Returns the updated request.
 */
export async function saveQuote(db: Db, requestId: string, body: unknown): Promise<QuoteRequestDetail> {
  if (!UUID.test(requestId)) throw notFound();
  const raw = objectBody(body);
  const parsed = SaveSchema.safeParse(raw);
  const errors = parsed.success ? [] : validationErrors(parsed.error);
  if (typeof raw.note === 'string' && (unstorable(raw.note) || overLength(raw.note, saveQuoteBodyNoteMax)) && !errors.some((e) => e.field === 'note')) {
    errors.push({ field: 'note', message: MESSAGES.note ?? 'Check this answer' });
  }
  if (!parsed.success || errors.length > 0) throw new ProblemError(422, 'validation_failed', { errors });

  const { price_cents, note, version } = parsed.data;
  const { error } = await db.rpc('save_quote_request_quote', {
    p_request_id: requestId,
    // null clears the price and the note; the generated argument types do not allow null
    p_price_cents: price_cents as number,
    p_note: note as string,
    p_expected_version: version,
  });
  if (error) throw staffDbProblem(error);
  return loadDetail(db, requestId);
}

// ---- status ------------------------------------------------------------------------------------------------------------

const StatusSchema = ChangeQuoteRequestStatusBody.extend({ version: Version }).strict();

const StatusRpcResult = z.object({
  changed: z.boolean(),
  status: z.enum(['new', 'quoted', 'won', 'lost']),
  status_changed_at: z.string().nullable(),
  version: z.number().int().min(1),
});

export type StatusChange = {
  /** 201 for a real change, 200 when the request was already in that status. */
  httpStatus: 200 | 201;
  body: StatusChangeResult;
  /** True when a real change left a stage-tag push queued, so the route should run the attempt after the response. */
  stageTagQueued: boolean;
};

/**
 * changeQuoteRequestStatus: validate, then change_quote_request_status() in one transaction (status, audit row, event, and
 * the stage-tag job for a consented request). Same status again is 200 changed false and nothing else happens; a stale
 * version is 409. After a real change, report whether a stage-tag job is waiting; if that check fails the answer is still
 * sent (the status is saved) and the route runs the attempt anyway, which claims nothing when there is no job.
 */
export async function changeQuoteRequestStatus(db: Db, requestId: string, body: unknown): Promise<StatusChange> {
  if (!UUID.test(requestId)) throw notFound();
  const parsed = StatusSchema.safeParse(objectBody(body));
  if (!parsed.success) throw new ProblemError(422, 'validation_failed', { errors: validationErrors(parsed.error) });

  const { data, error } = await db.rpc('change_quote_request_status', {
    p_request_id: requestId,
    p_to_status: parsed.data.to_status,
    p_expected_version: parsed.data.version,
  });
  if (error) throw staffDbProblem(error);
  const result = StatusRpcResult.parse(data);
  const response: StatusChangeResult = {
    changed: result.changed,
    status: result.status,
    status_changed_at: iso(result.status_changed_at),
    version: result.version,
  };
  if (!result.changed) return { httpStatus: 200, body: response, stageTagQueued: false };

  let stageTagQueued = true;
  const queued = await db
    .from('ghl_sync_jobs')
    .select('id')
    .eq('request_id', requestId)
    .eq('kind', 'stage_tag')
    .in('state', ['pending', 'waiting'])
    .limit(1);
  if (queued.error) {
    logLine('warn', { quote_request_id: requestId, outcome: 'stage_tag_check_failed', error_class: 'postgrest', code: queued.error.code || 'none' });
  } else {
    stageTagQueued = queued.data.length > 0;
  }
  return { httpStatus: 201, body: response, stageTagQueued };
}

// ---- weekly count ------------------------------------------------------------------------------------------------------

/** getCurrentWeeklyCount: Monday 00:00 to the next Monday 00:00 America/Toronto, won and lost by the date of the change to that status. */
export async function getCurrentWeeklyCount(db: Db): Promise<WeeklyCount> {
  const { data, error } = await db.rpc('weekly_counts');
  if (error) throw staffDbProblem(error);
  const row = data?.[0];
  if (!row) throw new ProblemError(500, 'internal_error', { errorClass: 'NoWeeklyCount', logCode: 'none' });
  return {
    week_start: requiredIso(row.week_start),
    week_end: requiredIso(row.week_end),
    time_zone: 'America/Toronto',
    requests: Number(row.requests),
    won: Number(row.won),
    lost: Number(row.lost),
  };
}
