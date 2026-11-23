// @vitest-environment node
// GET /api/jobs/housekeeping (runHousekeeping) against the STAGING Supabase project, called in-process.
// Behind CRON_SECRET (SECURITY_MODEL invariant 12, S0 SEC-4): `Bearer undefined`, `Bearer ` and no header are 401, also while the
// secret is unset or short. With a good secret it purges pending requests older than 24 hours with their files, and every counter
// row older than 24 hours, and touches nothing newer, nothing submitted, and no event. (US-002, US-003, US-004.)
//
// Staging is shared: the job purges ALL stale rows, as it is meant to, so counts are asserted as "at least what this file inserted".
// Every row, file and event this file creates is deleted in afterAll (the events through psql, as the service role cannot).
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET, POST, PUT } from '@/app/api/jobs/housekeeping/route';
import { RunHousekeepingResponse } from '@/lib/api/generated/jobs/jobs.zod';
import { captureOutput, expectProblem, jsonRequest } from '../../helpers/api';
import { setupStaging } from '../../helpers/staging';

const staging = setupStaging();

const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const hash = () => randomBytes(32).toString('hex');
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const reference = () => `NQ-${Array.from(randomBytes(6), (b) => REFERENCE_ALPHABET[b % 31]).join('')}`;

const call = (authorization?: string) =>
  GET(jsonRequest('/api/jobs/housekeeping', { method: 'GET', headers: authorization === undefined ? {} : { authorization } }), undefined);

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

const exists = async (table: 'quote_requests', id: string) => ((await staging.db().from(table).select('id').eq('id', id)).data ?? []).length === 1;
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

beforeAll(async () => {
  // beforeAll of useStaging (env and secrets) is registered first, so it has run
  const stalePending = await insertRequest(pendingRow(ago(26)));
  await putFile(stalePending);
  const freshPending = await insertRequest(pendingRow(ago(1)));
  await putFile(freshPending);
  const oldSubmitted = await insertRequest({ ...pendingRow(ago(30)), state: 'submitted', reference: reference(), submitted_at: ago(30), photo_count: 0 });

  const oldHash = hash();
  const freshHash = hash();
  staging.trackHash(oldHash);
  staging.trackHash(freshHash);
  const rows = [
    { ip_hash: oldHash, created_at: ago(25) },
    { ip_hash: oldHash, created_at: ago(48) },
    { ip_hash: freshHash, created_at: ago(1) },
  ];
  expect((await staging.db().from('rate_limit_hits').insert(rows)).error).toBeNull();
  const oldWindowEvent = await spamWindow(oldHash, ago(26));
  const freshWindowEvent = await spamWindow(freshHash, ago(1));

  const oldEmailHash = hash();
  const freshEmailHash = hash();
  const attempts = [
    { email_hash: oldEmailHash, ip_hash: oldHash, succeeded: false, created_at: ago(25) },
    { email_hash: freshEmailHash, ip_hash: freshHash, succeeded: false, created_at: ago(1) },
  ];
  expect((await staging.db().from('sign_in_attempts').insert(attempts)).error).toBeNull();
  const pauses = [
    { scope: 'email', key_hash: oldEmailHash, paused_until: ago(24), created_at: ago(25) },
    { scope: 'email', key_hash: freshEmailHash, paused_until: new Date(Date.now() + HOUR).toISOString(), created_at: ago(1) },
  ];
  expect((await staging.db().from('sign_in_pauses').insert(pauses)).error).toBeNull();

  fx = { stalePending, freshPending, oldSubmitted, oldHash, freshHash, oldWindowEvent, freshWindowEvent, oldEmailHash, freshEmailHash };
});

afterAll(async () => {
  // the sign-in rows are not covered by the shared cleanup
  if (!fx) return;
  await staging.db().from('sign_in_attempts').delete().in('email_hash', [fx.oldEmailHash, fx.freshEmailHash]);
  await staging.db().from('sign_in_pauses').delete().in('key_hash', [fx.oldEmailHash, fx.freshEmailHash]);
  expect(await attemptCount(fx.oldEmailHash) + (await attemptCount(fx.freshEmailHash)) + (await pauseCount(fx.oldEmailHash)) + (await pauseCount(fx.freshEmailHash))).toBe(0);
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
      res = await call(authorization);
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
          res = await call(header);
        });
        await expectProblem(res as Response, 401, 'unauthorized');
      }
    } finally {
      vi.stubEnv('CRON_SECRET', staging.secrets.cron);
    }
  });

  it('none of the refused calls touched the stale rows', async () => {
    expect(await exists('quote_requests', fx.stalePending)).toBe(true);
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

describe('runHousekeeping with the right secret', () => {
  it('purges pending requests and their files, and every counter row, older than 24 hours; the response matches the contract', async () => {
    const res = await call(`Bearer ${staging.secrets.cron}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const result = RunHousekeepingResponse.parse(await res.json());
    expect(Object.keys(result).sort()).toEqual(['pending_requests_purged', 'photos_purged', 'rate_limit_rows_purged', 'sign_in_rows_purged']);
    expect(result.pending_requests_purged).toBeGreaterThanOrEqual(1);
    expect(result.photos_purged).toBeGreaterThanOrEqual(1);
    expect(result.rate_limit_rows_purged).toBeGreaterThanOrEqual(3); // two old hits and one old spam window
    expect(result.sign_in_rows_purged).toBeGreaterThanOrEqual(2); // one old attempt and one old pause
  });

  it('removed the stale pending request and its file, the old hits, spam window, sign-in attempt and sign-in pause', async () => {
    expect(await exists('quote_requests', fx.stalePending)).toBe(false);
    expect(await hasFile(fx.stalePending)).toBe(false);
    expect(await hitCount(fx.oldHash)).toBe(0);
    expect(await windowCount(fx.oldHash)).toBe(0);
    expect(await attemptCount(fx.oldEmailHash)).toBe(0);
    expect(await pauseCount(fx.oldEmailHash)).toBe(0);
  });

  it('kept everything newer than 24 hours, a submitted request however old, and every spam event (they hold no address)', async () => {
    expect(await exists('quote_requests', fx.freshPending)).toBe(true);
    expect(await hasFile(fx.freshPending)).toBe(true);
    expect(await exists('quote_requests', fx.oldSubmitted)).toBe(true);
    expect(await hitCount(fx.freshHash)).toBe(1);
    expect(await windowCount(fx.freshHash)).toBe(1);
    expect(await attemptCount(fx.freshEmailHash)).toBe(1);
    expect(await pauseCount(fx.freshEmailHash)).toBe(1);
    expect(await eventExists(fx.oldWindowEvent)).toBe(true);
    expect(await eventExists(fx.freshWindowEvent)).toBe(true);
  });

  it('is safe to run again: the second run purges none of this file\'s rows and still answers the contract', async () => {
    const res = await call(`Bearer ${staging.secrets.cron}`);
    expect(res.status).toBe(200);
    RunHousekeepingResponse.parse(await res.json());
    expect(await exists('quote_requests', fx.freshPending)).toBe(true);
    expect(await exists('quote_requests', fx.oldSubmitted)).toBe(true);
  });

  it('logs ids and counts only (no request column, no address hash)', async () => {
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await call(`Bearer ${staging.secrets.cron}`);
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
