import 'server-only';

// src/lib/server/services/submissions.ts: the public submission, in two calls (docs/architecture.md "Submissions",
// docs/SECURITY_MODEL.md "The public formToken scheme", decision 0002).
//
//   startQuoteRequest   POST /api/quote-requests            token, honeypot, validation, then ONE start_quote_request() call
//   completeQuoteRequest POST /api/quote-requests/{id}/submission   photo checks, then complete_quote_request()
//
// Services take plain values and throw ProblemError; the handlers hold no rules. One of the modules allowed to use the
// service-role client (SECURITY_MODEL invariant 2). Database, Storage and zod text never reaches a response or a log line.
import { z } from 'zod';
import { CreateQuoteRequestBody } from '@/lib/api/generated/public-form/public-form.zod';
import type { QuoteRequestStarted, QuoteRequestSubmitted } from '@/lib/api/generated/model';
import { AdminClientConfigError, getAdminClient } from '@/lib/server/admin';
import { recordPhotoUploadFailed, recordSpamRefusal, type PhotoFailureReason } from '@/lib/server/events';
import { UNPARSEABLE, dbProblem, fieldMessage, unavailable, ProblemError, type DbError, type FieldError } from '@/lib/server/http';
import { logLine } from '@/lib/server/log';
import { verifyFormToken } from '@/lib/server/form-token';
import { addressHash, addressKey } from './network';
import { PHOTO_HEAD_BYTES, MAX_PHOTO_BYTES, inspectPhoto, type PhotoContentType } from './photo-check';

const BUCKET = 'quote-photos';
const UPLOAD_WINDOW_MS = 60 * 60 * 1000; // the storage policy accepts uploads for 60 minutes after the request was started

/** The service-role client, or a 503 when it is not configured (nothing was stored). */
function admin() {
  try {
    return getAdminClient();
  } catch (error) {
    if (error instanceof AdminClientConfigError) throw unavailable('AdminClientConfigError');
    throw error;
  }
}

/** The one refusal for the honeypot and the 3-second minimum: the same status, code and bytes for both (invariant 8). */
const refusal = () => new ProblemError(400, 'submission_refused');

type TokenCheck = { nonce: string; spamKey: string };

/**
 * Check the form token (signature, then age). Throws EnvConfigError first when APP_SIGNING_SECRET is missing or short
 * (503 through withApi). A token younger than 3 seconds is the time trap: recorded, then refused like the honeypot.
 */
async function checkFormToken(formToken: string | null, clientAddress: string | null, nowMs: number): Promise<TokenCheck> {
  const result = verifyFormToken(formToken ?? '', nowMs);
  const spamKey = addressHash(clientAddress);
  if (!result.ok) {
    if (result.reason === 'invalid') throw new ProblemError(401, 'form_token_invalid');
    if (result.reason === 'expired') throw new ProblemError(400, 'form_expired');
    await recordSpamRefusal(spamKey, 'too_fast');
    throw refusal();
  }
  return { nonce: result.nonce, spamKey };
}

// ---- createQuoteRequest -----------------------------------------------------------------------------------------------

type CreateBody = z.infer<typeof CreateQuoteRequestBody>;

const MESSAGES: Record<string, string> = {
  ...Object.fromEntries(['name', 'phone', 'email', 'address', 'problem', 'urgency'].map((f) => [f, fieldMessage(f) ?? 'Check this answer'])),
  photos: 'Add at most 3 photos',
};
const PHOTO_PLAN_MESSAGE = 'Photos must be JPEG, PNG or WebP, up to 5 MB each, in order from 1';

function issueField(path: PropertyKey[]): string {
  const [first, second] = path;
  if (first === 'photos') return typeof second === 'number' ? `photos[${second + 1}]` : 'photos';
  return typeof first === 'string' ? first : 'form';
}

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
    const field = issueField(issue.path);
    if (!seen.has(field)) seen.set(field, { field, message: MESSAGES[field] ?? (field.startsWith('photos[') ? PHOTO_PLAN_MESSAGE : 'Check this answer') });
  }
  return [...seen.values()];
}

/** Phone as typed: remove spaces, dashes, dots, brackets and a leading +1, then exactly 10 digits. */
function normalizePhone(typed: string): string | undefined {
  const phone = typed.replace(/[\s\-.()]/g, '').replace(/^\+1/, '');
  return /^[0-9]{10}$/.test(phone) ? phone : undefined;
}

type ParsedCreate = { data: CreateBody; phone: string; consent: boolean };

/**
 * Validate the body against the generated contract schema. Email is trimmed first; `marketing_consent` is coerced with
 * `=== true` before anything else and is never an error (AC-001.17); unknown fields are a 422 naming them.
 */
function parseCreateBody(body: Record<string, unknown>): ParsedCreate {
  const input: Record<string, unknown> = { ...body };
  const consent = input.marketing_consent === true;
  delete input.marketing_consent;
  if (input.website === null) delete input.website;
  if (typeof input.email === 'string') input.email = input.email.trim();

  const parsed = CreateQuoteRequestBody.strict().safeParse(input);
  const errors = parsed.success ? [] : validationErrors(parsed.error);

  const phone = typeof input.phone === 'string' ? normalizePhone(input.phone) : undefined;
  if (typeof input.phone === 'string' && phone === undefined && !errors.some((e) => e.field === 'phone')) {
    errors.push({ field: 'phone', message: MESSAGES.phone ?? 'Enter a 10-digit phone number' });
  }
  // Postgres text cannot hold a NUL character: refuse it here as a field error instead of letting it reach the database as a 500.
  for (const field of ['name', 'email', 'address', 'problem']) {
    if (typeof input[field] === 'string' && input[field].includes('\u0000') && !errors.some((e) => e.field === field)) {
      errors.push({ field, message: MESSAGES[field] ?? 'Check this answer' });
    }
  }
  if (parsed.success) {
    parsed.data.photos.forEach((photo, index) => {
      if (photo.position !== index + 1) errors.push({ field: `photos[${index + 1}]`, message: PHOTO_PLAN_MESSAGE });
    });
  }
  if (errors.length > 0 || !parsed.success || phone === undefined) {
    throw new ProblemError(422, 'validation_failed', { errors });
  }
  return { data: parsed.data, phone, consent };
}

const StartOutcome = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.enum(['created', 'replayed', 'updated']),
    request_id: z.uuid(),
    state: z.enum(['pending', 'submitted']),
    reference: z.string().nullable(),
    created_at: z.string(),
  }),
  z.object({ outcome: z.literal('token_used') }),
  z.object({ outcome: z.literal('rate_limited'), retry_after_seconds: z.number().int() }),
]);

type StartArgs = {
  p_submission_key: string;
  p_name: string;
  p_phone: string;
  p_email: string;
  p_address: string;
  p_problem: string;
  p_urgency: string;
  p_photo_count: number;
  p_ip_hash: string;
  p_marketing_consent: boolean;
};

async function callStart(args: StartArgs): Promise<{ data: unknown; error: DbError | null }> {
  const { data, error } = await admin().rpc('start_quote_request', args);
  return { data, error };
}

/** Delete every uploaded object of one request (a folder of at most 3). Returns how many were removed; 503 when Storage fails. */
export async function removeRequestUploads(requestId: string): Promise<number> {
  const bucket = admin().storage.from(BUCKET);
  const listed = await bucket.list(requestId, { limit: 10 });
  if (listed.error) throw unavailable('storage', 'list');
  const paths = (listed.data ?? []).filter((f) => /^photo-[1-3]$/.test(f.name)).map((f) => `${requestId}/${f.name}`);
  if (paths.length === 0) return 0;
  const removed = await bucket.remove(paths);
  if (removed.error) throw unavailable('storage', 'remove');
  return paths.length;
}

export type StartInput = {
  /** The X-Form-Token header, or null. */
  formToken: string | null;
  /** The parsed JSON body, or UNPARSEABLE. */
  body: unknown;
  /** The raw client address from x-real-ip / x-forwarded-for, or null. */
  clientAddress: string | null;
  /** For tests. */
  nowMs?: number;
};

export type StartResult = { status: 200 | 201; body: QuoteRequestStarted };

/**
 * createQuoteRequest. Order: token (401, 400 form_expired, time trap) -> body (400) -> honeypot -> validation (422) ->
 * start_quote_request() once (created 201, replayed 200, updated 200 after clearing uploads, token_used 409, rate_limited
 * 429). Refusals for the honeypot, the time trap and the rate limit are recorded (errors ignored) and answered the same way
 * whether or not recording worked. A counter that cannot be read accepts the request (AC-003.5, inside the database call).
 */
export async function startQuoteRequest(input: StartInput): Promise<StartResult> {
  const { nonce, spamKey } = await checkFormToken(input.formToken, input.clientAddress, input.nowMs ?? Date.now());

  const body = input.body;
  if (body === UNPARSEABLE || typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ProblemError(400, 'bad_request');
  }
  const raw = body as Record<string, unknown>;

  // Honeypot: anything but empty is refused with the generic 400, never a 422 (invariant 8).
  if (raw.website !== undefined && raw.website !== null && raw.website !== '') {
    await recordSpamRefusal(spamKey, 'honeypot');
    throw refusal();
  }

  const { data, phone, consent } = parseCreateBody(raw);
  const address = addressKey(input.clientAddress);
  const args: StartArgs = {
    p_submission_key: nonce,
    p_name: data.name,
    p_phone: phone,
    p_email: data.email,
    p_address: data.address,
    p_problem: data.problem,
    p_urgency: data.urgency,
    p_photo_count: data.photos.length,
    // No address known: null, and the database accepts the request (AC-003.5). The cast is for the generated type only.
    p_ip_hash: (address === null ? null : spamKey) as string,
    p_marketing_consent: consent,
  };

  let result = await callStart(args);
  // 23505 on submission_key means another call with this token won the race between our read and our write: answer it as the replay.
  if (result.error?.code === '23505') result = await callStart(args);
  if (result.error) throw dbProblem(result.error);

  const outcome = StartOutcome.parse(result.data);
  if (outcome.outcome === 'token_used') throw new ProblemError(409, 'form_already_used');
  if (outcome.outcome === 'rate_limited') {
    await recordSpamRefusal(spamKey, 'rate_limited');
    throw new ProblemError(429, 'rate_limited', { headers: { 'Retry-After': String(outcome.retry_after_seconds) } });
  }

  if (outcome.state === 'submitted') {
    return {
      status: 200,
      body: { request_id: outcome.request_id, submission_state: 'submitted', reference: outcome.reference, photo_uploads: [], upload_expires_at: null },
    };
  }
  if (outcome.outcome === 'updated') await removeRequestUploads(outcome.request_id); // changed answers: the photos are uploaded again

  return {
    status: outcome.outcome === 'created' ? 201 : 200,
    body: {
      request_id: outcome.request_id,
      submission_state: 'pending',
      reference: null,
      photo_uploads: data.photos.map((photo) => ({
        position: photo.position,
        bucket: BUCKET,
        path: `${outcome.request_id}/photo-${photo.position}`,
        content_type: photo.content_type,
      })),
      upload_expires_at: new Date(new Date(outcome.created_at).getTime() + UPLOAD_WINDOW_MS).toISOString(),
    },
  };
}

// ---- submitQuoteRequest -----------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CompleteRow = z.object({
  request_id: z.uuid(),
  reference: z.string(),
  submitted_at: z.string(),
  photo_count: z.number().int(),
  replayed: z.boolean(),
});

type StoredPhoto = { position: number; storage_path: string; content_type: PhotoContentType; size_bytes: number };

const PHOTO_MESSAGES = {
  missing: "This photo didn't upload. Please add it again.",
  bad_type: 'Photos must be JPEG, PNG or WebP',
  too_large: 'Photos must be at most 5 MB and 12,000 pixels on each side',
} as const;

/**
 * Check every planned photo of a pending request: present, at most 5 MB, JPEG/PNG/WebP by its first bytes, PNG and WebP
 * at most 12,000 pixels a side. Every bad photo is removed and recorded as photo_upload_failed; a Storage failure is a 503.
 */
async function checkPhotos(requestId: string, planned: number): Promise<StoredPhoto[]> {
  if (planned === 0) return [];
  const bucket = admin().storage.from(BUCKET);
  const listed = await bucket.list(requestId, { limit: 10 });
  if (listed.error) throw unavailable('storage', 'list');
  const sizes = new Map<string, number | undefined>();
  for (const file of listed.data ?? []) {
    const size: unknown = file.metadata?.size;
    sizes.set(file.name, typeof size === 'number' ? size : undefined);
  }

  const stored: StoredPhoto[] = [];
  const problems: Array<FieldError & { code: 'photo_missing' | 'photo_invalid' }> = [];
  const toRemove: string[] = [];
  const failures: Array<{ reason: PhotoFailureReason; position: number }> = [];

  for (let position = 1; position <= planned; position += 1) {
    const field = `photos[${position}]`;
    const path = `${requestId}/photo-${position}`;
    if (!sizes.has(`photo-${position}`)) {
      problems.push({ field, message: PHOTO_MESSAGES.missing, code: 'photo_missing' });
      failures.push({ reason: 'storage_error', position });
      continue;
    }

    const listedSize = sizes.get(`photo-${position}`);
    let verdict: ReturnType<typeof inspectPhoto>;
    let size = listedSize ?? 0;
    if (listedSize !== undefined && listedSize > MAX_PHOTO_BYTES) {
      verdict = { ok: false, reason: 'too_large' }; // refused on the listed size, without downloading it
    } else {
      const downloaded = await bucket.download(path);
      if (downloaded.error || !downloaded.data) {
        await recordPhotoUploadFailed(requestId, 'storage_error', position);
        throw unavailable('storage', 'download');
      }
      size = downloaded.data.size;
      const head = new Uint8Array(await downloaded.data.slice(0, PHOTO_HEAD_BYTES).arrayBuffer());
      verdict = inspectPhoto(head, size);
    }

    if (verdict.ok) {
      stored.push({ position, storage_path: path, content_type: verdict.contentType, size_bytes: size });
    } else {
      problems.push({ field, message: PHOTO_MESSAGES[verdict.reason], code: 'photo_invalid' });
      failures.push({ reason: verdict.reason, position });
      toRemove.push(path);
    }
  }

  if (problems.length === 0) return stored;

  if (toRemove.length > 0) {
    const removed = await bucket.remove(toRemove);
    if (removed.error) logLine('warn', { quote_request_id: requestId, outcome: 'bad_photo_not_removed', error_class: 'storage', code: 'remove' });
  }
  for (const failure of failures) await recordPhotoUploadFailed(requestId, failure.reason, failure.position);
  throw new ProblemError(422, problems.some((p) => p.code === 'photo_invalid') ? 'photo_invalid' : 'photo_missing', {
    errors: problems.map(({ field, message }) => ({ field, message })),
  });
}

export type CompleteInput = {
  formToken: string | null;
  requestId: string;
  clientAddress: string | null;
  nowMs?: number;
};

export type CompleteResult = {
  body: QuoteRequestSubmitted;
  /** True only when this call stored the request AND queued its GoHighLevel copy job (a ticked offers box, first completion). */
  jobQueued: boolean;
};

/**
 * submitQuoteRequest. The token must be the one that created the request (401 otherwise); an unknown id is 404. For a
 * pending request every photo is checked, then complete_quote_request() stores it in one transaction. A request already
 * submitted answers 200 with the same reference and does nothing else.
 */
export async function completeQuoteRequest(input: CompleteInput): Promise<CompleteResult> {
  const { nonce } = await checkFormToken(input.formToken, input.clientAddress, input.nowMs ?? Date.now());
  if (!UUID.test(input.requestId)) throw new ProblemError(404, 'not_found');

  const db = admin();
  const found = await db.from('quote_requests').select('id, state, submission_key, photo_count').eq('id', input.requestId).maybeSingle();
  if (found.error) throw dbProblem(found.error);
  if (!found.data) throw new ProblemError(404, 'not_found');
  if (found.data.submission_key !== nonce) throw new ProblemError(401, 'form_token_invalid');

  const photos = found.data.state === 'pending' ? await checkPhotos(found.data.id, found.data.photo_count) : [];
  const completed = await db.rpc('complete_quote_request', { p_request_id: found.data.id, p_photos: photos });
  if (completed.error) throw dbProblem(completed.error);
  const result = CompleteRow.parse(completed.data);

  let jobQueued = false;
  if (!result.replayed) {
    const job = await db.from('ghl_sync_jobs').select('id').eq('request_id', result.request_id).eq('kind', 'contact_copy').limit(1);
    if (job.error) throw dbProblem(job.error);
    jobQueued = (job.data ?? []).length > 0;
  }

  return {
    body: {
      request_id: result.request_id,
      reference: result.reference,
      submitted_at: new Date(result.submitted_at).toISOString(),
      photo_count: result.photo_count,
    },
    jobQueued,
  };
}
