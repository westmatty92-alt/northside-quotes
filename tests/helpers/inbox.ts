// tests/helpers/inbox.ts: seeding and request builders for the staff inbox tests (BE3), on top of tests/helpers/staging.ts.
//
// Staging is shared, so every request a test file seeds carries a name token that is unique to this file and this run
// (`ib.tag`), and the list tests scope their searches with it. Every request is tracked through staging.trackRequest, so
// afterAll deletes it with its photos, jobs, status history and events (all cascade) and proves nothing is left.
// Requests are inserted with the service role directly, because the tests need control over submitted_at, status and the
// job rows; the code under test only ever reads and writes through the user-scoped client and the staff RPCs.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { jpegBytes } from './api';
import { psql, type Staging } from './staging';

const ORIGIN = 'http://localhost';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A reference the way the database draws them: NQ- and 6 characters of the 31-character alphabet. */
export function randomReference(): string {
  let reference = 'NQ-';
  for (let i = 0; i < 6; i += 1) reference += ALPHABET[randomInt(0, ALPHABET.length)];
  return reference;
}

/** A GET, PUT or POST to `/api/...` as a staff browser sends it: JSON body, bearer token (none when `token` is undefined). */
export function staffRequest(
  path: string,
  token: string | undefined,
  init: { method?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { ...init.headers };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (init.rawBody !== undefined) body = init.rawBody;
  else if (init.body !== undefined) body = JSON.stringify(init.body);
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${ORIGIN}${path}`, { method: init.method ?? 'GET', headers, body });
}

/** The second argument Next.js hands a dynamic route handler. */
export const idParams = (id: string): { params: Promise<{ request_id: string }> } => ({ params: Promise.resolve({ request_id: id }) });

/** SQL text run by psql on SUPABASE_STAGING_DB_URL; returns what it prints. The URL is an argument only and never printed. */
export function psqlOutput(sql: string): string {
  try {
    return execFileSync('psql', [process.env.SUPABASE_STAGING_DB_URL ?? '', '-v', 'ON_ERROR_STOP=1', '-qAt'], {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error ? String((error as { status: unknown }).status) : 'unknown';
    throw new Error(`psql on the staging database failed (exit ${status})`);
  }
}

export type SeedRequest = {
  id: string;
  reference: string;
  name: string;
  phone: string;
  email: string;
  submittedAt: string;
};

export type SeedOptions = {
  label?: string;
  name?: string;
  state?: 'pending' | 'submitted';
  status?: 'new' | 'quoted' | 'won' | 'lost';
  urgency?: 'emergency' | 'soon' | 'flexible';
  submittedAt?: string;
  statusChangedAt?: string | null;
  consent?: boolean;
  priceCents?: number | null;
  note?: string | null;
  photoCount?: number;
  phone?: string;
  reference?: string;
  version?: number;
};

export type StaffSession = { id: string; email: string; token: string; displayName: string };

export type InboxTools = ReturnType<typeof inboxTools>;

/** Call once per test file, after setupStaging(). */
export function inboxTools(staging: Staging) {
  // Letters only, on purpose: search text with 3 or more digits also searches phone numbers (US-013), so a tag with digits
  // could match an unrelated request whose phone contains them.
  const tag = `bex${Array.from(randomBytes(9), (b) => String.fromCharCode(97 + (b % 26))).join('')}`;
  let counter = 0;

  function row(options: SeedOptions) {
    counter += 1;
    const id = randomUUID();
    const submittedAt = options.submittedAt ?? new Date().toISOString();
    const state = options.state ?? 'submitted';
    const consent = options.consent ?? false;
    const status = options.status ?? 'new';
    const name = options.name ?? `${tag} ${options.label ?? `r${counter}`}`;
    const reference = options.reference ?? randomReference();
    const phone = options.phone ?? String(randomInt(4_000_000_000, 5_000_000_000));
    return {
      seed: { id, reference, name, phone, email: `be3.${tag}.${counter}@example.test`, submittedAt } satisfies SeedRequest,
      insert: {
        id,
        submission_key: randomUUID(),
        state,
        reference: state === 'submitted' ? reference : null,
        name,
        phone,
        email: `be3.${tag}.${counter}@example.test`,
        address: '14 Test Street, Hamilton ON',
        problem: 'The test tap drips constantly under the sink',
        urgency: options.urgency ?? 'soon',
        status,
        status_changed_at: options.statusChangedAt === undefined ? (status === 'new' ? null : submittedAt) : options.statusChangedAt,
        price_cents: options.priceCents ?? null,
        note: options.note ?? null,
        photo_count: options.photoCount ?? 0,
        version: options.version ?? 1,
        marketing_consent: consent,
        marketing_consent_at: state === 'submitted' && consent ? submittedAt : null,
        submitted_at: state === 'submitted' ? submittedAt : null,
      },
    };
  }

  /** Insert one request with the service role; it is tracked for cleanup. */
  async function seed(options: SeedOptions = {}): Promise<SeedRequest> {
    const { seed: made, insert } = row(options);
    staging.trackRequest(made.id);
    const { error } = await staging.db().from('quote_requests').insert(insert);
    expect(error).toBeNull();
    return made;
  }

  /** Insert many requests in one call (for the 51-row page tests). */
  async function seedMany(options: SeedOptions[]): Promise<SeedRequest[]> {
    const rows = options.map(row);
    for (const r of rows) staging.trackRequest(r.seed.id);
    const { error } = await staging.db().from('quote_requests').insert(rows.map((r) => r.insert));
    expect(error).toBeNull();
    return rows.map((r) => r.seed);
  }

  /** Upload one photo to the private bucket and record it, the way complete_quote_request does (service role). */
  async function photo(requestId: string, position: number, contentType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'): Promise<void> {
    const bytes = jpegBytes(600);
    const path = `${requestId}/photo-${position}`;
    const uploaded = await staging.db().storage.from('quote-photos').upload(path, bytes, { contentType, upsert: true });
    expect(uploaded.error).toBeNull();
    const { error } = await staging
      .db()
      .from('quote_photos')
      .insert({ request_id: requestId, position, storage_path: path, content_type: contentType, size_bytes: bytes.length });
    expect(error).toBeNull();
  }

  /** Insert a GHL sync job row (only a consented request can have one; the database refuses the rest). */
  async function job(
    requestId: string,
    options: { kind: 'contact_copy' | 'stage_tag'; state: string; targetStatus?: 'new' | 'quoted' | 'won' | 'lost'; lastAttemptAt?: string | null; createdAt?: string },
  ): Promise<void> {
    const { error } = await staging
      .db()
      .from('ghl_sync_jobs')
      .insert({
        request_id: requestId,
        kind: options.kind,
        state: options.state,
        target_status: options.kind === 'stage_tag' ? (options.targetStatus ?? 'new') : null,
        last_attempt_at: options.lastAttemptAt ?? null,
        attempt_count: options.lastAttemptAt ? 1 : 0,
        ...(options.createdAt === undefined ? {} : { created_at: options.createdAt }),
      });
    expect(error).toBeNull();
  }

  /** A throwaway staff member with a real session: an Auth user and a staff row (deleted in afterAll), signed in with the publishable key. */
  async function staff(displayName = 'Test staff'): Promise<StaffSession> {
    const user = await staging.createUser({ staff: true, displayName });
    const signed = await staging.anon().auth.signInWithPassword({ email: user.email, password: user.password });
    expect(signed.error).toBeNull();
    const token = signed.data.session?.access_token ?? '';
    expect(token).not.toBe('');
    return { id: user.id, email: user.email, token, displayName };
  }

  /** A throwaway signed-in user with NO staff row. */
  async function nonStaff(): Promise<{ id: string; token: string }> {
    const user = await staging.createUser();
    const signed = await staging.anon().auth.signInWithPassword({ email: user.email, password: user.password });
    expect(signed.error).toBeNull();
    return { id: user.id, token: signed.data.session?.access_token ?? '' };
  }

  /** The stored row, read with the service role (what the database holds, whatever the API said). */
  async function stored(id: string) {
    const { data, error } = await staging
      .db()
      .from('quote_requests')
      .select('status, status_changed_at, version, price_cents, note, first_quoted_at, last_staff_update_by, last_staff_update_at')
      .eq('id', id)
      .single();
    expect(error).toBeNull();
    if (!data) throw new Error(`request ${id} is not stored`);
    return data;
  }

  /** The events of one name for one request. */
  async function events(requestId: string, name: string) {
    const { data, error } = await staging.db().from('events').select('id, name, user_id, properties').eq('request_id', requestId).eq('name', name);
    expect(error).toBeNull();
    return data ?? [];
  }

  async function statusChanges(requestId: string) {
    const { data, error } = await staging
      .db()
      .from('quote_request_status_changes')
      .select('from_status, to_status, changed_by, changed_at')
      .eq('request_id', requestId)
      .order('changed_at', { ascending: true });
    expect(error).toBeNull();
    return data ?? [];
  }

  async function jobs(requestId: string) {
    const { data, error } = await staging.db().from('ghl_sync_jobs').select('kind, state, target_status').eq('request_id', requestId);
    expect(error).toBeNull();
    return data ?? [];
  }

  return { tag, seed, seedMany, photo, job, staff, nonStaff, stored, events, statusChanges, jobs, psql };
}
