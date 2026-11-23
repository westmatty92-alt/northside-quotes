// @vitest-environment node
// POST /api/quote-requests/{request_id}/ghl-copy-retries (retryGhlCopy, US-014) against the STAGING database, with a real staff
// session, the real request_ghl_copy_retry / claim_ghl_job / finish_ghl_job functions and the real runner, and the offline GHL
// simulator standing in for GoHighLevel (the route builds its GHL client from the environment, which points at the simulator).
// No live GHL call is possible: the token and location are the simulator's, and VERCEL_ENV is unset so the base URL override applies.
//
// The staging variables come through ../staging-env.ts (URL and service-role key, INT1's loader) and, for the staff session and
// the cleanup, tests/helpers/staging-env.ts (publishable key and database URL, from the same .env.local files). THIS SUITE NEVER
// SKIPS: when a variable is missing, or the URL names production, every test here fails and the message names variables, never
// values. Every request, job, event and Auth user it creates is removed in afterAll, which then counts what is left and fails if
// it is not zero.
//
// Proves: AC-014.1 / AC-014.2 (a failed copy is retried at once, the answer is copied or failed with retried true), AC-014.3 (a
// second call while an attempt runs, or when the copy is not failed, is 409 and creates nothing), AC-014.4 (an unticked request:
// 409 not_retryable, no job, NO GoHighLevel call), AC-009.4 and the match rule (a retry never creates a second contact), 401 for
// every call that is not a staff session, 404 for an unknown or unsubmitted request, the settle rules (config_missing, auth and a
// 5xx), the answer agreeing with the request detail, and that nothing secret or personal is answered or logged.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as detailGet } from '@/app/api/quote-requests/[request_id]/route';
import { GET as getRoute, POST } from '@/app/api/quote-requests/[request_id]/ghl-copy-retries/route';
import { RetryGhlCopyResponse } from '@/lib/api/generated/go-high-level/go-high-level.zod';
import { GetQuoteRequestResponse } from '@/lib/api/generated/inbox/inbox.zod';
import { captureOutput, expectProblem } from '../../helpers/api';
import { idParams, inboxTools, staffRequest, type StaffSession } from '../../helpers/inbox';
import { loadStagingEnv as loadBackendEnv, stagingEnvProblem as backendEnvProblem } from '../../helpers/staging-env';
import { setupStaging, type Staging } from '../../helpers/staging';
import { startGhlSimulator, type GhlSimulator } from '../../mocks/ghl/simulator.mjs';
import { loadStagingEnv, stagingEnvProblem } from '../staging-env';

// Fill in the env from .env.local when the process lacks it, then check it. No skip: a problem fails every test below.
loadStagingEnv();
loadBackendEnv();
const envProblem = stagingEnvProblem() ?? backendEnvProblem();

it('the staging database is configured and is not production', () => {
  expect(envProblem, envProblem).toBeUndefined();
});

// setupStaging registers hooks that throw on a missing variable (which vitest would count as skipped), so it is only used
// when the variables are there; otherwise the beforeEach below fails each test on its own.
const staging: Staging | undefined = envProblem ? undefined : setupStaging();
const s = () => staging as Staging;
const db = () => s().db();

const ib = envProblem ? undefined : inboxTools(s());
const RUN = randomUUID().slice(0, 8);
const created: string[] = [];

let sim: GhlSimulator;
let owner: StaffSession;
let outsider: { id: string; token: string };

beforeAll(async () => {
  sim = await startGhlSimulator({ slowMs: 1_500, idPrefix: `i2x${RUN}c` });
  if (envProblem) return;
  owner = await ib!.staff('Owner (INT2 retry test)');
  outsider = await ib!.nonStaff();
});

afterAll(async () => {
  await sim?.close();
  if (envProblem || created.length === 0) return;
  // remove what this file made (jobs and events cascade from the request), then prove nothing is left
  const removed = await db().from('quote_requests').delete().in('id', created);
  expect(removed.error).toBeNull();
  for (const [table, column] of [
    ['quote_requests', 'id'],
    ['ghl_sync_jobs', 'request_id'],
    ['events', 'request_id'],
  ] as const) {
    const left = await db().from(table).select('*', { count: 'exact', head: true }).in(column, created);
    expect(left.error).toBeNull();
    expect({ table, left: left.count }).toEqual({ table, left: 0 });
  }
});

beforeEach(() => {
  if (envProblem) throw new Error(envProblem); // a problem fails each test on its own; it never skips
  sim.reset();
  sim.setMode('ok');
  // The route builds its GHL client from process.env on every call: point it at the simulator.
  vi.stubEnv('VERCEL_ENV', undefined);
  vi.stubEnv('GHL_API_BASE_URL', sim.url);
  vi.stubEnv('GHL_LOCATION_ID', sim.locationId);
  vi.stubEnv('GHL_PRIVATE_INTEGRATION_TOKEN', sim.token);
});

// ---- fixtures -------------------------------------------------------------------------------------------------------------

type JobFields = { state?: string; attempt_count?: number; last_attempt_at?: string | null; last_error_class?: string | null; next_attempt_at?: string };

/** A submitted request (inserted directly, like tests/helpers/inbox.ts), tracked for cleanup. */
async function seed(options: { consent: boolean; email?: string; phone?: string; state?: 'pending' | 'submitted' }) {
  const request = await ib!.seed({ consent: options.consent, ...(options.phone === undefined ? {} : { phone: options.phone }), ...(options.state === undefined ? {} : { state: options.state }) });
  created.push(request.id);
  if (options.email !== undefined) {
    const { error } = await db().from('quote_requests').update({ email: options.email }).eq('id', request.id);
    expect(error).toBeNull();
    return { ...request, email: options.email };
  }
  return request;
}

const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

async function addCopyJob(requestId: string, fields: JobFields): Promise<void> {
  const { error } = await db().from('ghl_sync_jobs').insert({ request_id: requestId, kind: 'contact_copy', ...fields } as never);
  expect(error).toBeNull();
}

/** A consented request whose automatic attempts ran out: the copy is failed (6 attempts), like SCR-06's "Copy to GoHighLevel failed". */
async function failedCopy(email?: string) {
  const request = await seed({ consent: true, ...(email === undefined ? {} : { email }) });
  await addCopyJob(request.id, { state: 'failed', attempt_count: 6, last_attempt_at: hourAgo(), last_error_class: 'server_error' });
  return request;
}

async function copyJob(requestId: string) {
  const { data, error } = await db().from('ghl_sync_jobs').select('*').eq('request_id', requestId).eq('kind', 'contact_copy');
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  return data![0]!;
}

async function jobCount(requestId: string): Promise<number> {
  const { count, error } = await db().from('ghl_sync_jobs').select('*', { count: 'exact', head: true }).eq('request_id', requestId);
  expect(error).toBeNull();
  return count ?? 0;
}

async function linkedContact(requestId: string): Promise<string | null> {
  const { data, error } = await db().from('quote_requests').select('ghl_contact_id').eq('id', requestId).single();
  expect(error).toBeNull();
  return data!.ghl_contact_id;
}

const path = (id: string) => `/api/quote-requests/${id}/ghl-copy-retries`;
/** The staff member's call; `token` null sends no Authorization header at all, a string sends that bearer token instead. */
const retry = (id: string, token: string | null = owner.token) =>
  Promise.resolve(POST(staffRequest(path(id), token === null ? undefined : token, { method: 'POST' }), idParams(id)));
const sentToGhl = () => sim.calls().length;
const line = (c: { method: string; path: string }) => `${c.method} ${c.path.replace(/^\/contacts\/[^/]+\/tags$/, '/contacts/:id/tags')}`;

async function answer(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/json');
  expect(res.headers.get('x-request-id')).toBeTruthy();
  const raw: unknown = await res.json();
  expect(Object.keys(raw as object).sort()).toEqual(['copy', 'retried']);
  return RetryGhlCopyResponse.parse(raw);
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for the simulator to see a call');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// ---- a retry that runs ----------------------------------------------------------------------------------------------------

describe('AC-014.1 / AC-014.2: a failed copy is retried at once', () => {
  it('the attempt works: 200 copied, retried true; one contact is created, linked, and the job is settled with its own lease', async () => {
    const r = await failedCopy();

    const res = await retry(r.id);
    const body = await answer(res);

    expect(body.retried).toBe(true);
    expect(body.copy.state).toBe('copied');
    expect(Math.abs(Date.parse(body.copy.at ?? '') - Date.now())).toBeLessThan(60_000);

    expect(sim.calls().map(line)).toEqual(['GET /contacts/search/duplicate', 'POST /contacts']);
    expect(sim.contacts()).toHaveLength(1);
    expect(sim.contacts()[0]).toMatchObject({ email: r.email, phone: `+1${r.phone}` });
    expect([...sim.contacts()[0]!.tags].sort()).toEqual(['quote-new', 'quote-request']);
    expect(await linkedContact(r.id)).toBe(sim.contacts()[0]!.id);

    // 6 failed automatic attempts, plus this one
    expect(await copyJob(r.id)).toMatchObject({ state: 'succeeded', attempt_count: 7, last_error_class: null, lease_id: null, locked_until: null });
    expect((await ib!.events(r.id, 'ghl_sync_succeeded')).map((e) => e.properties)).toMatchObject([{ attempt_number: 7 }]);
    expect(JSON.stringify(body)).not.toContain(sim.contacts()[0]!.id); // the contact id is never answered
  });

  it('the answer is the copy state the request detail shows afterwards (one mapping, two routes)', async () => {
    const r = await failedCopy();
    const body = await answer(await retry(r.id));

    const detail = await detailGet(staffRequest(`/api/quote-requests/${r.id}`, owner.token), idParams(r.id));
    expect(detail.status).toBe(200);
    expect(GetQuoteRequestResponse.parse(await detail.json()).ghl.copy).toEqual(body.copy);
  });

  it('the attempt fails again (GHL 5xx): 200 failed with the attempt\'s time and retried true; no automatic retry is scheduled', async () => {
    const r = await failedCopy();
    sim.setMode('500');

    const body = await answer(await retry(r.id));

    expect(body.retried).toBe(true);
    expect(body.copy.state).toBe('failed');
    expect(Math.abs(Date.parse(body.copy.at ?? '') - Date.now())).toBeLessThan(60_000);
    // a manual retry allows exactly one more attempt: the job is failed again, not waiting for a 5 minute backoff
    expect(await copyJob(r.id)).toMatchObject({ state: 'failed', attempt_count: 7, last_error_class: 'server_error', lease_id: null });
    const names = (await ib!.events(r.id, 'ghl_sync_attempt_failed')).map((e) => e.properties);
    expect(names).toMatchObject([{ attempt_number: 7, error_class: 'server_error' }]);
    expect(await ib!.events(r.id, 'ghl_sync_gave_up')).toHaveLength(0);
    expect(sim.contacts()).toHaveLength(0);
    expect(await linkedContact(r.id)).toBeNull();

    // and it can be retried once more after that: the copy is failed again, so the button is back
    sim.setMode('ok');
    expect((await answer(await retry(r.id))).copy.state).toBe('copied');
    expect(sim.contacts()).toHaveLength(1);
    expect((await copyJob(r.id)).attempt_count).toBe(8);
  });

  it.each([
    ['token revoked (401)', 'revoked' as const, 'auth'],
    ['token without the scope (403)', 'forbidden' as const, 'auth'],
    ['GHL refuses a value (422)', 'unprocessable' as const, 'rejected'],
  ])('%s: failed at once with class %s recorded, retried true, nothing created', async (_label, mode, errorClass) => {
    const r = await failedCopy();
    sim.setMode(mode);

    const body = await answer(await retry(r.id));

    expect(body).toMatchObject({ retried: true, copy: { state: 'failed' } });
    expect(await copyJob(r.id)).toMatchObject({ state: 'failed', last_error_class: errorClass, attempt_count: 7 });
    expect(sim.contacts()).toHaveLength(0);
  });

  it('no GHL token configured: failed as config_missing, retried true, and no GHL call at all (AC-009.3)', async () => {
    const r = await failedCopy();
    vi.stubEnv('GHL_PRIVATE_INTEGRATION_TOKEN', undefined);

    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await retry(r.id);
    });
    const body = await answer(res as Response);

    expect(body).toMatchObject({ retried: true, copy: { state: 'failed' } });
    expect(sentToGhl()).toBe(0);
    expect(await copyJob(r.id)).toMatchObject({ state: 'failed', last_error_class: 'config_missing' });
    expect(output).not.toContain(sim.token);
  });
});

describe('a retry never creates a second contact (AC-009.4, the contact match rule)', () => {
  it('a contact for this homeowner already exists in GHL (a create whose reply was lost): the retry finds it by the duplicate search and links it', async () => {
    const r = await failedCopy();
    const existing = sim.seedContact({ name: 'Existing Contact', email: r.email, phone: `+1${r.phone}`, tags: ['vip'] });

    const body = await answer(await retry(r.id));

    expect(body).toMatchObject({ retried: true, copy: { state: 'copied' } });
    expect(sim.callsTo('POST', '/contacts').filter((c) => c.path === '/contacts')).toHaveLength(0);
    expect(sim.calls().map(line)).toEqual(['GET /contacts/search/duplicate', 'POST /contacts/:id/tags', 'DELETE /contacts/:id/tags']);
    expect(sim.contacts()).toHaveLength(1);
    expect(sim.contacts()[0]).toMatchObject({ id: existing, name: 'Existing Contact' }); // its fields are untouched
    expect([...sim.contacts()[0]!.tags].sort()).toEqual(['quote-new', 'quote-request', 'vip']);
    expect(await linkedContact(r.id)).toBe(existing);
  });

  it('another consented request of the same homeowner is already linked: the retry links to that contact from our own database, with no search and no create', async () => {
    const first = await seed({ consent: true });
    const contactId = sim.seedContact({ name: 'First Contact', email: first.email, phone: `+1${first.phone}`, tags: ['quote-request', 'quote-new'] });
    const linked = await db().from('quote_requests').update({ ghl_contact_id: contactId, ghl_linked_at: new Date().toISOString() }).eq('id', first.id);
    expect(linked.error).toBeNull();
    const second = await failedCopy(first.email.toUpperCase()); // the same email in capitals: the match rule ties them together

    const body = await answer(await retry(second.id));

    expect(body).toMatchObject({ retried: true, copy: { state: 'copied' } });
    expect(sim.calls().map(line)).toEqual(['POST /contacts/:id/tags', 'DELETE /contacts/:id/tags']);
    expect(sim.contacts()).toHaveLength(1);
    expect(await linkedContact(second.id)).toBe(contactId);
  });
});

// ---- a retry that is refused ----------------------------------------------------------------------------------------------

describe('AC-014.4: a request whose homeowner did not tick the offers box is never copied', () => {
  it('409 not_retryable, no GHL call, no job created, no contact linked', async () => {
    const r = await seed({ consent: false });
    expect(await jobCount(r.id)).toBe(0);

    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await retry(r.id);
    });

    const problem = await expectProblem(res as Response, 409, 'not_retryable');
    expect(problem.title).toBe('This copy cannot be retried.');
    expect(sentToGhl()).toBe(0);
    expect(await jobCount(r.id)).toBe(0);
    expect(await linkedContact(r.id)).toBeNull();
    expect(JSON.parse(output.split('\n').filter(Boolean)[0]!)).toMatchObject({ level: 'warn', status: 409, error_class: 'postgrest', code: 'PT409' });
    expect(output).not.toMatch(/consent|never copied/i); // the database's text is never logged
  });

  it('the same refusal for every attempt, and the database still refuses to queue a job for it', async () => {
    const r = await seed({ consent: false });
    for (let i = 0; i < 3; i += 1) await expectProblem(await retry(r.id), 409, 'not_retryable');
    const insert = await db().from('ghl_sync_jobs').insert({ request_id: r.id, kind: 'contact_copy' });
    expect(insert.error?.code).toBe('23514');
    expect(sentToGhl()).toBe(0);
  });
});

describe('AC-014.3: only a failed copy can be retried, and only one attempt runs at a time', () => {
  it.each([
    ['pending (the first attempt has not run)', { state: 'pending', next_attempt_at: tomorrow() }],
    ['waiting (a retry is scheduled)', { state: 'waiting', attempt_count: 1, last_attempt_at: hourAgo(), last_error_class: 'timeout', next_attempt_at: tomorrow() }],
    ['succeeded (already copied)', { state: 'succeeded', attempt_count: 1, last_attempt_at: hourAgo() }],
  ] as Array<[string, JobFields]>)('a copy that is %s -> 409 not_retryable, nothing changes and GHL is not called', async (_label, fields) => {
    const r = await seed({ consent: true });
    await addCopyJob(r.id, fields);
    const before = await copyJob(r.id);

    await expectProblem(await retry(r.id), 409, 'not_retryable');

    const after = await copyJob(r.id);
    expect({ state: after.state, attempt_count: after.attempt_count, next_attempt_at: after.next_attempt_at, lease_id: after.lease_id }).toEqual({
      state: before.state,
      attempt_count: before.attempt_count,
      next_attempt_at: before.next_attempt_at,
      lease_id: null,
    });
    expect(sentToGhl()).toBe(0);
  });

  it('a second call while the first attempt is still running is 409 and sends nothing of its own; the first one finishes with one contact', async () => {
    const r = await failedCopy();
    sim.setMode('slow'); // every GHL call takes 1.5 s, so the first attempt is in flight for a few seconds

    const first = retry(r.id);
    await until(() => sentToGhl() >= 1); // the first attempt is now inside GHL, its job leased
    const callsWhileRunning = sentToGhl();
    const second = await retry(r.id);

    await expectProblem(second, 409, 'not_retryable');
    expect(sentToGhl()).toBe(callsWhileRunning); // the refused call reached GHL with nothing
    const firstBody = await answer(await first);
    expect(firstBody).toMatchObject({ retried: true, copy: { state: 'copied' } });
    expect(sim.callsTo('POST', '/contacts').filter((c) => c.path === '/contacts')).toHaveLength(1);
    expect(sim.contacts()).toHaveLength(1);
    expect((await copyJob(r.id)).attempt_count).toBe(7);
  });

  it('two calls at the same moment: one runs the attempt, the other is 409', async () => {
    const r = await failedCopy();

    const responses = await Promise.all([retry(r.id), retry(r.id)]);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    const refused = responses.find((res) => res.status === 409)!;
    await expectProblem(refused, 409, 'not_retryable');
    expect(sim.callsTo('POST', '/contacts').filter((c) => c.path === '/contacts')).toHaveLength(1);
    expect(sim.contacts()).toHaveLength(1);
    expect((await copyJob(r.id)).attempt_count).toBe(7);
  });
});

describe('who may call it', () => {
  it.each([
    ['no Authorization header', null],
    ['a token that is not a token', 'not.a.token'],
    ['an oversized token', 'x'.repeat(5000)],
  ] as Array<[string, string | null]>)('%s -> 401 session_expired; the job is untouched and GHL is not called', async (_label, token) => {
    const r = await failedCopy();
    await expectProblem(await retry(r.id, token), 401, 'session_expired');
    expect(await copyJob(r.id)).toMatchObject({ state: 'failed', attempt_count: 6 });
    expect(sentToGhl()).toBe(0);
  });

  it('a signed-in user who is not staff -> 401 session_expired (the same answer for every reason), job untouched', async () => {
    const r = await failedCopy();
    await expectProblem(await retry(r.id, outsider.token), 401, 'session_expired');
    expect(await copyJob(r.id)).toMatchObject({ state: 'failed', attempt_count: 6 });
    expect(sentToGhl()).toBe(0);
  });

  it('cookies are not a credential: a request with only a cookie is 401', async () => {
    const r = await failedCopy();
    const res = await POST(staffRequest(path(r.id), undefined, { method: 'POST', headers: { cookie: `sb-access-token=${owner.token}` } }), idParams(r.id));
    await expectProblem(res, 401, 'session_expired');
    expect(sentToGhl()).toBe(0);
  });

  it('any other method is a 405 problem with Allow: POST', async () => {
    const r = await failedCopy();
    const res = await getRoute(staffRequest(path(r.id), owner.token), idParams(r.id));
    await expectProblem(res, 405, 'method_not_allowed');
    expect(res.headers.get('allow')).toBe('POST');
    expect(await copyJob(r.id)).toMatchObject({ state: 'failed', attempt_count: 6 });
  });
});

describe('404: a request that does not exist or was never submitted', () => {
  it('an unknown id -> 404 not_found, no GHL call', async () => {
    await expectProblem(await retry(randomUUID()), 404, 'not_found');
    expect(sentToGhl()).toBe(0);
  });

  it('an id that is not a uuid -> 404 not_found', async () => {
    await expectProblem(await retry('not-a-uuid'), 404, 'not_found');
    expect(sentToGhl()).toBe(0);
  });

  it('a request that is still pending (never submitted) -> 404 not_found, even with consent ticked', async () => {
    const r = await seed({ consent: true, state: 'pending' });
    await expectProblem(await retry(r.id), 404, 'not_found');
    expect(await jobCount(r.id)).toBe(0);
    expect(sentToGhl()).toBe(0);
  });
});

describe('nothing secret or personal is answered or logged', () => {
  it('a full retry (the route\'s line and the runner\'s line) holds no token, no name, phone, email or address', async () => {
    const r = await failedCopy();
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await retry(r.id);
    });
    const text = JSON.stringify(await answer(res as Response));

    for (const secret of [sim.token, owner.token, r.name, r.phone, r.email, '14 Test Street']) {
      expect(output).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
    const lines = output.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const route = lines.find((l) => l.route === 'POST /api/quote-requests/[request_id]/ghl-copy-retries');
    const runner = lines.find((l) => l.route === 'ghl-sync');
    expect(route).toMatchObject({ level: 'info', status: 200, outcome: 'ok' });
    expect(runner).toMatchObject({ outcome: 'succeeded', job_id: (await copyJob(r.id)).id, quote_request_id: r.id });
  });
});
