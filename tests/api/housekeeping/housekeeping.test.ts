// @vitest-environment node
// GET /api/jobs/housekeeping (runHousekeeping) against the STAGING Supabase project, called in-process.
// Behind CRON_SECRET (SECURITY_MODEL invariant 12, S0 SEC-4): `Bearer undefined`, `Bearer ` and no header are 401, also while the
// secret is unset or short. With a good secret it purges pending requests older than 24 hours with their files, and every counter
// row older than 24 hours, and touches nothing newer, nothing submitted, and no event. (US-002, US-003, US-004.)
//
// Isolation on the shared staging database (REV-3): the job's cutoff is "the clock minus 24 hours", and the job takes no other
// scope. Every row this file expects to be purged or kept is created in January 2001, and every authorised call runs the
// production route and job unchanged with only `Date` faked to NOW (2001-01-03 12:00 UTC). The cutoff is then
// 2001-01-02 12:00 UTC, so the purge can reach only this file's rows, never a real row or another run's fixtures. That is
// proved by "bystander" rows that are stale in real time (created 25 to 26 hours ago, as other runs' fixtures are) and must
// survive. Because nothing else on staging is from that era, the counts are asserted exactly.
// Limit: two copies of THIS file running at the same moment share the era and can purge each other's rows (CI serialises the
// staging-database jobs). A run cancelled before its afterAll is cleared by the sweep at the start of the next one.
// Every row, file and event this file creates is tracked and deleted by setupStaging's afterAll (the events through psql, as the
// service role cannot), which then proves nothing is left.
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GET, POST, PUT } from '@/app/api/jobs/housekeeping/route';
import { RunHousekeepingResponse } from '@/lib/api/generated/jobs/jobs.zod';
import { captureOutput, expectProblem, jsonRequest } from '../../helpers/api';
import { setupStaging } from '../../helpers/staging';

const staging = setupStaging();

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
/** The clock the authorised calls run with. Every fixture the purge may touch is from this era. */
const NOW = Date.UTC(2001, 0, 3, 12);
/** Nothing real is older than this; everything older is this file's (and is swept before the run). */
const ERA_END = new Date(Date.UTC(2002, 0, 1)).toISOString();
/** `ms` before NOW (this file's era). */
const before = (ms: number) => new Date(NOW - ms).toISOString();
/** `hours` before the real time (rows other runs own). */
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const hash = () => randomBytes(32).toString('hex');
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const reference = () => `NQ-${Array.from(randomBytes(6), (b) => REFERENCE_ALPHABET[b % 31]).join('')}`;
const TABLES = ['rate_limit_hits', 'spam_refusal_windows', 'sign_in_attempts', 'sign_in_pauses'] as const;

const call = (authorization?: string) =>
  GET(jsonRequest('/api/jobs/housekeeping', { method: 'GET', headers: authorization === undefined ? {} : { authorization } }), undefined);

/** Run `fn` with only Date faked to NOW (timers, fetch and TLS keep the real clock). */
async function atNow<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}
const authorisedCall = () => atNow(() => call(`Bearer ${staging.secrets.cron}`));

type Fixture = {
  stalePending: string;
  freshPending: string;
  oldSubmitted: string;
  oldHash: string;
  freshHash: string;
  oldWindowEvent: string;
  freshWindowEvent: string;
  oldEmailHash: string;
  freshEmailHash: string;
  /** Stale in real time, outside this file's era: what another run's fixtures look like. */
  bystander: { request: string; ipHash: string; emailHash: string };
};
let fx: Fixture;

function pendingRow(createdAt: string) {
  return {
    submission_key: randomUUID(),
    name: 'Housekeeping Tester',
    phone: '4165550111',
    email: `be1.housekeeping.${randomBytes(3).toString('hex')}@example.test`,
    address: '14 Test Street, Hamilton ON',
    problem: 'Abandoned test request for the housekeeping job',
    urgency: 'flexible',
    photo_count: 1,
    created_at: createdAt,
  };
}

async function insertRequest(row: Record<string, unknown>): Promise<string> {
  const { data, error } = await staging.db().from('quote_requests').insert(row as never).select('id').single();
  expect(error).toBeNull();
  staging.trackRequest(data!.id);
  return data!.id;
}

async function putFile(id: string): Promise<void> {
  const { error } = await staging.db().storage.from('quote-photos').upload(`${id}/photo-1`, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { contentType: 'image/jpeg', upsert: false });
  expect(error).toBeNull();
}

async function removeFiles(id: string): Promise<void> {
  const files = await staging.db().storage.from('quote-photos').list(id, { limit: 10 });
  const paths = (files.data ?? []).map((f) => `${id}/${f.name}`);
  if (paths.length > 0) expect((await staging.db().storage.from('quote-photos').remove(paths)).error).toBeNull();
}

const exists = async (id: string) => ((await staging.db().from('quote_requests').select('id').eq('id', id)).data ?? []).length === 1;
const hasFile = async (id: string) => ((await staging.db().storage.from('quote-photos').list(id)).data ?? []).length === 1;
const hitCount = async (h: string) => ((await staging.db().from('rate_limit_hits').select('id').eq('ip_hash', h)).data ?? []).length;
const windowCount = async (h: string) => ((await staging.db().from('spam_refusal_windows').select('id').eq('ip_hash', h)).data ?? []).length;
const attemptCount = async (h: string) => ((await staging.db().from('sign_in_attempts').select('id').eq('email_hash', h)).data ?? []).length;
const pauseCount = async (h: string) => ((await staging.db().from('sign_in_pauses').select('id').eq('key_hash', h)).data ?? []).length;
const eventExists = async (id: string) => ((await staging.db().from('events').select('id').eq('id', id)).data ?? []).length === 1;

async function spamWindow(ipHash: string, createdAt: string): Promise<string> {
  const event = await staging.db().from('events').insert({ name: 'spam_submission_blocked', properties: { reason: 'honeypot', count: 1 } }).select('id').single();
  expect(event.error).toBeNull();
  staging.trackEvent(event.data!.id);
  const win = await staging.db().from('spam_refusal_windows').insert({ ip_hash: ipHash, reason: 'honeypot', event_id: event.data!.id, created_at: createdAt, window_start: createdAt });
  expect(win.error).toBeNull();
  return event.data!.id;
}

/** Clear what an earlier run of this file left behind (cancelled before its afterAll): every row older than ERA_END is this file's. */
async function sweepEarlierRuns(): Promise<void> {
  const db = staging.db();
  const windows = await db.from('spam_refusal_windows').select('event_id').lt('created_at', ERA_END);
  expect(windows.error).toBeNull();
  for (const w of windows.data ?? []) staging.trackEvent(w.event_id); // deleted with psql in afterAll
  const old = await db.from('quote_requests').select('id').lt('created_at', ERA_END);
  expect(old.error).toBeNull();
  const ids = (old.data ?? []).map((r) => r.id);
  for (const id of ids) await removeFiles(id);
  if (ids.length > 0) expect((await db.from('quote_requests').delete().in('id', ids)).error).toBeNull();
  for (const table of TABLES) expect((await db.from(table).delete().lt('created_at', ERA_END)).error).toBeNull();
}

beforeAll(async () => {
  // beforeAll of setupStaging (env and secrets) is registered first, so it has run
  await sweepEarlierRuns();

  const stalePending = await insertRequest(pendingRow(before(26 * HOUR)));
  await putFile(stalePending);
  const freshPending = await insertRequest(pendingRow(before(1 * HOUR)));
  await putFile(freshPending);
  const oldSubmitted = await insertRequest({ ...pendingRow(before(30 * HOUR)), state: 'submitted', reference: reference(), submitted_at: before(30 * HOUR), photo_count: 0 });

  const [oldHash, freshHash, oldEmailHash, freshEmailHash] = [hash(), hash(), hash(), hash()];
  for (const h of [oldHash, freshHash, oldEmailHash, freshEmailHash]) staging.trackHash(h); // afterAll deletes counters and sign-in rows by these
  const rows = [
    { ip_hash: oldHash, created_at: before(24 * HOUR + MINUTE) }, // just past the 24-hour line
    { ip_hash: oldHash, created_at: before(48 * HOUR) },
    { ip_hash: freshHash, created_at: before(24 * HOUR - MINUTE) }, // just inside it
    { ip_hash: freshHash, created_at: before(1 * HOUR) },
  ];
  expect((await staging.db().from('rate_limit_hits').insert(rows)).error).toBeNull();
  const oldWindowEvent = await spamWindow(oldHash, before(26 * HOUR));
  const freshWindowEvent = await spamWindow(freshHash, before(1 * HOUR));

  const attempts = [
    { email_hash: oldEmailHash, ip_hash: oldHash, succeeded: false, created_at: before(25 * HOUR) },
    { email_hash: freshEmailHash, ip_hash: freshHash, succeeded: false, created_at: before(1 * HOUR) },
  ];
  expect((await staging.db().from('sign_in_attempts').insert(attempts)).error).toBeNull();
  const pauses = [
    { scope: 'email', key_hash: oldEmailHash, paused_until: before(24 * HOUR), created_at: before(25 * HOUR) },
    { scope: 'email', key_hash: freshEmailHash, paused_until: new Date(NOW + HOUR).toISOString(), created_at: before(1 * HOUR) },
  ];
  expect((await staging.db().from('sign_in_pauses').insert(pauses)).error).toBeNull();

  // other runs' fixtures: stale in real time, so the old test (which purged with the real clock) deleted them
  const bystanderRequest = await insertRequest(pendingRow(ago(26)));
  await putFile(bystanderRequest);
  const [bystanderIp, bystanderEmail] = [hash(), hash()];
  staging.trackHash(bystanderIp);
  staging.trackHash(bystanderEmail);
  expect((await staging.db().from('rate_limit_hits').insert({ ip_hash: bystanderIp, created_at: ago(25) })).error).toBeNull();
  expect((await staging.db().from('sign_in_attempts').insert({ email_hash: bystanderEmail, ip_hash: bystanderIp, succeeded: false, created_at: ago(25) })).error).toBeNull();
  expect((await staging.db().from('sign_in_pauses').insert({ scope: 'email', key_hash: bystanderEmail, paused_until: ago(24), created_at: ago(25) })).error).toBeNull();

  fx = {
    stalePending,
    freshPending,
    oldSubmitted,
    oldHash,
    freshHash,
    oldWindowEvent,
    freshWindowEvent,
    oldEmailHash,
    freshEmailHash,
    bystander: { request: bystanderRequest, ipHash: bystanderIp, emailHash: bystanderEmail },
  };
});

describe('S0 SEC-4 / invariant 12: Bearer undefined, empty and missing each give 401, and nothing is purged', () => {
  it.each([
    ['no Authorization header', undefined],
    ['"Bearer " (empty)', 'Bearer '],
    ['"Bearer undefined"', 'Bearer undefined'],
    ['a wrong secret', `Bearer ${'w'.repeat(64)}`],
    ['the right secret without the Bearer scheme', 'SECRET'],
    ['the right secret with a lower-case scheme', 'bearer SECRET'],
  ])('%s -> 401 unauthorized (problem+json)', async (_label, header) => {
    const authorization = header?.replace('SECRET', staging.secrets.cron);
    let res: Response | undefined;
    await captureOutput(async () => {
      res = await atNow(() => call(authorization)); // at NOW, so a refused call that purged would reach this file's rows
    });
    const problem = await expectProblem(res as Response, 401, 'unauthorized');
    expect(JSON.stringify(problem)).not.toContain(staging.secrets.cron);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['31 characters', 'c'.repeat(31)],
  ])('with CRON_SECRET %s, "Bearer undefined", "Bearer ", no header and even a matching header are all 401', async (_label, value) => {
    vi.stubEnv('CRON_SECRET', value);
    try {
      const attempts = ['Bearer undefined', 'Bearer ', undefined, `Bearer ${value ?? ''}`];
      for (const header of attempts) {
        let res: Response | undefined;
        await captureOutput(async () => {
          res = await atNow(() => call(header));
        });
        await expectProblem(res as Response, 401, 'unauthorized');
      }
    } finally {
      vi.stubEnv('CRON_SECRET', staging.secrets.cron);
    }
  });

  it('none of the refused calls touched the stale rows', async () => {
    expect(await exists(fx.stalePending)).toBe(true);
    expect(await hasFile(fx.stalePending)).toBe(true);
    expect(await hitCount(fx.oldHash)).toBe(2);
    expect(await windowCount(fx.oldHash)).toBe(1);
    expect(await attemptCount(fx.oldEmailHash)).toBe(1);
    expect(await pauseCount(fx.oldEmailHash)).toBe(1);
  });

  it('any other method is a 405 problem with Allow: GET', async () => {
    const res = await POST(jsonRequest('/api/jobs/housekeeping', { headers: { authorization: `Bearer ${staging.secrets.cron}` } }), undefined);
    await expectProblem(res, 405, 'method_not_allowed');
    expect(res.headers.get('allow')).toBe('GET');
    await expectProblem(await PUT(jsonRequest('/api/jobs/housekeeping', { method: 'PUT' }), undefined), 405, 'method_not_allowed');
  });
});

describe('runHousekeeping with the right secret (the production route and job; only the clock is set to NOW)', () => {
  it('purges exactly this file\'s stale pending request and its file, and its counter rows older than 24 hours; the response matches the contract', async () => {
    const res = await authorisedCall();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const result = RunHousekeepingResponse.parse(await res.json());
    expect(result).toEqual({
      pending_requests_purged: 1,
      photos_purged: 1,
      rate_limit_rows_purged: 3, // two old hits and one old spam window
      sign_in_rows_purged: 2, // one old attempt and one old pause
    });
  });

  it('removed the stale pending request and its file, the old hits (one a minute past 24 hours), spam window, sign-in attempt and sign-in pause', async () => {
    expect(await exists(fx.stalePending)).toBe(false);
    expect(await hasFile(fx.stalePending)).toBe(false);
    expect(await hitCount(fx.oldHash)).toBe(0);
    expect(await windowCount(fx.oldHash)).toBe(0);
    expect(await attemptCount(fx.oldEmailHash)).toBe(0);
    expect(await pauseCount(fx.oldEmailHash)).toBe(0);
  });

  it('kept everything newer than 24 hours (one a minute inside), a submitted request however old, and every spam event (they hold no address)', async () => {
    expect(await exists(fx.freshPending)).toBe(true);
    expect(await hasFile(fx.freshPending)).toBe(true);
    expect(await exists(fx.oldSubmitted)).toBe(true);
    expect(await hitCount(fx.freshHash)).toBe(2);
    expect(await windowCount(fx.freshHash)).toBe(1);
    expect(await attemptCount(fx.freshEmailHash)).toBe(1);
    expect(await pauseCount(fx.freshEmailHash)).toBe(1);
    expect(await eventExists(fx.oldWindowEvent)).toBe(true);
    expect(await eventExists(fx.freshWindowEvent)).toBe(true);
  });

  it('REV-3: left alone the rows another run owns, although they are stale in real time (25 to 26 hours old)', async () => {
    expect(await exists(fx.bystander.request)).toBe(true);
    expect(await hasFile(fx.bystander.request)).toBe(true);
    expect(await hitCount(fx.bystander.ipHash)).toBe(1);
    expect(await attemptCount(fx.bystander.emailHash)).toBe(1);
    expect(await pauseCount(fx.bystander.emailHash)).toBe(1);
  });

  it('is safe to run again: the second run purges nothing and still answers the contract', async () => {
    const res = await authorisedCall();
    expect(res.status).toBe(200);
    expect(RunHousekeepingResponse.parse(await res.json())).toEqual({ pending_requests_purged: 0, photos_purged: 0, rate_limit_rows_purged: 0, sign_in_rows_purged: 0 });
    expect(await exists(fx.freshPending)).toBe(true);
    expect(await exists(fx.oldSubmitted)).toBe(true);
  });

  it('logs ids and counts only (no request column, no address hash)', async () => {
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await authorisedCall();
    });
    expect((res as Response).status).toBe(200);
    for (const secret of [staging.secrets.cron, fx.oldHash, fx.freshHash, 'Housekeeping Tester', '4165550111', '@example.test']) expect(output).not.toContain(secret);
    expect(JSON.parse(output.split('\n').filter(Boolean)[0]!)).toMatchObject({ level: 'info', route: 'GET /api/jobs/housekeeping', status: 200, outcome: 'ok' });
  });
});

describe('a database that cannot be reached is a 500 (the contract lists 401 and 500 for this job)', () => {
  it('answers 500 internal_error with no database text', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:9'); // nothing listens on the discard port
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'not-a-real-key');
    try {
      const { GET: isolated } = await import('@/app/api/jobs/housekeeping/route');
      let res: Response | undefined;
      const output = await captureOutput(async () => {
        res = await isolated(jsonRequest('/api/jobs/housekeeping', { method: 'GET', headers: { authorization: `Bearer ${staging.secrets.cron}` } }), undefined);
      });
      const problem = await expectProblem(res as Response, 500, 'internal_error');
      expect(problem.title).toBe('Something went wrong');
      expect(output).not.toMatch(/ECONNREFUSED|fetch failed|127\.0\.0\.1/);
      expect(JSON.parse(output.split('\n').filter(Boolean)[0]!)).toMatchObject({ level: 'error', status: 500, error_class: 'postgrest' });
    } finally {
      vi.unstubAllEnvs();
      vi.stubEnv('APP_SIGNING_SECRET', staging.secrets.signing);
      vi.stubEnv('CRON_SECRET', staging.secrets.cron);
    }
  });
});
