// @vitest-environment node
// GET /api/jobs/ghl-sync (runGhlSyncJobs), called in-process. Offline: no database and no network beyond the local GHL simulator.
//
// The route is tested in two ways, both through the real route handler:
//   - with the integration seam (runGhlJobs) replaced by a spy: the cron secret gate, the arguments, the answer's shape, the 500 and the 405;
//   - with the seam replaced by the REAL runner on an in-memory job store and the GHL simulator: what a run does to jobs, that a
//     second or simultaneous call runs nothing twice, that a GHL outage is counted and not thrown, and the 60 s budget reserve.
// A run against the shared staging database is deliberately not here: the route claims EVERY due job, so it would take other tests'
// jobs (the staging tests of tests/integrations/ghl run in parallel workers) and fail them as config_missing.
//
// Proves: SECURITY_MODEL invariant 12 and S0 SEC-4 (401 for `Bearer undefined`, `Bearer `, no header, a wrong secret, and every
// call while CRON_SECRET is unset or shorter than 32 characters; a refused call runs nothing), the contract's JobRunResult,
// "idempotent: calling it twice in a row, or at the same time, runs nothing twice", "stops claiming when less than 60 seconds of
// the 300-second budget is left", and invariant 11 (the 500 and the log line carry { error_class, code } and nothing else).
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PATCH, POST, PUT, maxDuration } from '@/app/api/jobs/ghl-sync/route';
import { RunGhlSyncJobsResponse } from '@/lib/api/generated/jobs/jobs.zod';
import { createGhlClient } from '@/lib/server/integrations/ghl/client';
import { GhlStoreError, RUN_BUDGET_MS, RUN_RESERVE_MS, runGhlJobsWith } from '@/lib/server/integrations/ghl/runner';
import { captureOutput, expectProblem, jsonRequest } from '../../helpers/api';
import { startGhlSimulator, type GhlSimulator } from '../../mocks/ghl/simulator.mjs';
import { FakeStore, makeRequest, simEnv } from '../ghl/helpers';

// What the seam does in each test. Default: a spy that answers like an idle run.
const seam = vi.hoisted(() => ({ run: undefined as unknown as (...args: unknown[]) => Promise<unknown> }));
vi.mock('@/lib/server/integrations/ghl', () => ({ runGhlJobs: (...args: unknown[]) => seam.run(...args) }));

const CRON = randomBytes(32).toString('hex'); // random per run: no secret lives in a fixture
const quiet = () => undefined;
const IDLE = { claimed: 0, succeeded: 0, waiting: 0, failed: 0 };

let sim: GhlSimulator;
let spy: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>;

beforeAll(async () => {
  sim = await startGhlSimulator({ slowMs: 5_000 });
});
afterAll(async () => {
  await sim.close();
});
beforeEach(() => {
  sim.reset();
  vi.stubEnv('CRON_SECRET', CRON);
  spy = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(IDLE);
  seam.run = spy;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const call = (authorization?: string) =>
  GET(jsonRequest('/api/jobs/ghl-sync', { method: 'GET', headers: authorization === undefined ? {} : { authorization } }), undefined);
const authorized = () => call(`Bearer ${CRON}`);

/** The real runner behind the seam, on an in-memory store, talking to the simulator. */
function realRunner(store: FakeStore, clientEnv = simEnv(sim)) {
  const client = createGhlClient({ env: clientEnv, timeoutMs: 2_000 });
  seam.run = (options) => runGhlJobsWith((options ?? {}) as Record<string, never>, { store, client, log: quiet });
}

let counter = 0;
/** A consented request with a due contact_copy job in `store` (unique email and phone, so each one is its own homeowner). */
function addJob(store: FakeStore) {
  counter += 1;
  return store.add(makeRequest({ email: `sync${counter}.${randomBytes(3).toString('hex')}@example.test`, phone: `416555${String(1000 + counter)}` }));
}

describe('invariant 12 / S0 SEC-4: Bearer undefined, empty and missing each give 401, and nothing runs', () => {
  it.each([
    ['no Authorization header', undefined],
    ['"Bearer " (empty)', 'Bearer '],
    ['"Bearer undefined"', 'Bearer undefined'],
    ['"Bearer null"', 'Bearer null'],
    ['a wrong secret of the right length', `Bearer ${'w'.repeat(CRON.length)}`],
    ['a wrong secret of another length', `Bearer ${'w'.repeat(64)}`],
    ['the right secret with one character cut off', `Bearer ${CRON.slice(0, -1)}`],
    ['the right secret with one character added', `Bearer ${CRON}x`],
    ['the right secret without the Bearer scheme', 'SECRET'],
    ['the right secret with a lower-case scheme', 'bearer SECRET'],
    ['the right secret with two spaces', 'Bearer  SECRET'],
  ])('%s -> 401 unauthorized (problem+json), the runner is not called', async (_label, header) => {
    const authorization = header?.replace('SECRET', CRON);
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await call(authorization);
    });
    const problem = await expectProblem(res as Response, 401, 'unauthorized');
    expect(JSON.stringify(problem)).not.toContain(CRON);
    expect(output).not.toContain(CRON);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['31 characters', 'c'.repeat(31)],
  ])('with CRON_SECRET %s, "Bearer undefined", "Bearer ", no header and even a matching header are all 401', async (_label, value) => {
    vi.stubEnv('CRON_SECRET', value);
    for (const header of ['Bearer undefined', 'Bearer ', undefined, `Bearer ${value ?? ''}`, `Bearer ${CRON}`]) {
      await expectProblem(await call(header), 401, 'unauthorized');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('a 32-character secret is enough: exactly that secret is accepted, a different one of the same length is not', async () => {
    const minimum = 'm'.repeat(32);
    vi.stubEnv('CRON_SECRET', minimum);
    await expectProblem(await call(`Bearer ${'n'.repeat(32)}`), 401, 'unauthorized');
    expect((await call(`Bearer ${minimum}`)).status).toBe(200);
  });

  it('any other method is a 405 problem with Allow: GET, even with the right secret, and runs nothing', async () => {
    const headers = { authorization: `Bearer ${CRON}` };
    for (const [name, handler] of [['POST', POST], ['PUT', PUT], ['PATCH', PATCH], ['DELETE', DELETE]] as const) {
      const res = await handler(jsonRequest('/api/jobs/ghl-sync', { method: name, headers }), undefined);
      await expectProblem(res, 405, 'method_not_allowed');
      expect(res.headers.get('allow')).toBe('GET');
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('with the right secret: the contract\'s answer', () => {
  it('runs every due job (no request id) and answers 200 with exactly claimed, succeeded, waiting and failed', async () => {
    spy.mockResolvedValue({ claimed: 2, succeeded: 1, waiting: 1, failed: 0, extra: 'never exposed' });
    const res = await authorized();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const raw: unknown = await res.json();
    expect(RunGhlSyncJobsResponse.parse(raw)).toEqual({ claimed: 2, succeeded: 1, waiting: 1, failed: 0 });
    expect(Object.keys(raw as object).sort()).toEqual(['claimed', 'failed', 'succeeded', 'waiting']);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(); // no arguments at all: no requestId, so every due job
  });

  it('an idle run is a 200 with four zeros', async () => {
    const res = await authorized();
    expect(res.status).toBe(200);
    expect(RunGhlSyncJobsResponse.parse(await res.json())).toEqual(IDLE);
  });

  it('is configured for the 300-second function cap that the runner\'s budget assumes, and the runner keeps 60 s in reserve', () => {
    expect(maxDuration).toBe(300);
    expect(RUN_BUDGET_MS).toBe(300_000);
    expect(RUN_RESERVE_MS).toBe(60_000);
  });
});

describe('with the real runner behind the route (in-memory jobs, GHL simulator)', () => {
  it('runs the due jobs, answers the counts, and a second call in a row runs nothing twice', async () => {
    const store = new FakeStore();
    addJob(store);
    addJob(store);
    realRunner(store);

    const first = RunGhlSyncJobsResponse.parse(await (await authorized()).json());
    expect(first).toEqual({ claimed: 2, succeeded: 2, waiting: 0, failed: 0 });
    expect(sim.contacts()).toHaveLength(2);
    const callsAfterFirst = sim.calls().length;
    expect(store.finished.map((f) => f.settle.outcome)).toEqual(['succeeded', 'succeeded']);

    const second = RunGhlSyncJobsResponse.parse(await (await authorized()).json());
    expect(second).toEqual(IDLE);
    expect(sim.calls()).toHaveLength(callsAfterFirst);
    expect(sim.contacts()).toHaveLength(2);
  });

  it('two calls at the same moment run each job once between them', async () => {
    const store = new FakeStore();
    for (let i = 0; i < 4; i += 1) addJob(store);
    realRunner(store);

    const [a, b] = await Promise.all([authorized(), authorized()]);
    const first = RunGhlSyncJobsResponse.parse(await a.json());
    const second = RunGhlSyncJobsResponse.parse(await b.json());

    expect(first.claimed + second.claimed).toBe(4);
    expect(first.succeeded + second.succeeded).toBe(4);
    expect(sim.callsTo('POST', '/contacts')).toHaveLength(4);
    expect(sim.contacts()).toHaveLength(4);
    expect(new Set(store.finished.map((f) => f.job.id)).size).toBe(4); // each job settled exactly once
  });

  it('a GHL outage is counted as waiting and is still a 200: the route never fails because GHL does', async () => {
    sim.setMode('500');
    const store = new FakeStore();
    addJob(store);
    realRunner(store);

    const res = await authorized();
    expect(res.status).toBe(200);
    expect(RunGhlSyncJobsResponse.parse(await res.json())).toEqual({ claimed: 1, succeeded: 0, waiting: 1, failed: 0 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'retry', errorClass: 'server_error' });
  });

  it('a refused value (422) is counted as failed at once', async () => {
    sim.setMode('unprocessable');
    const store = new FakeStore();
    addJob(store);
    realRunner(store);

    expect(RunGhlSyncJobsResponse.parse(await (await authorized()).json())).toEqual({ claimed: 1, succeeded: 0, waiting: 0, failed: 1 });
  });

  it('no GHL token configured: failed at once as config_missing, no GHL call, and the answer holds no secret', async () => {
    const store = new FakeStore();
    addJob(store);
    realRunner(store, simEnv(sim, { GHL_PRIVATE_INTEGRATION_TOKEN: undefined }));

    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await authorized();
    });
    expect(RunGhlSyncJobsResponse.parse(await (res as Response).json())).toEqual({ claimed: 1, succeeded: 0, waiting: 0, failed: 1 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'failed', errorClass: 'config_missing' });
    expect(sim.calls()).toHaveLength(0);
    expect(output).not.toContain(sim.token);
    expect(output).not.toContain(CRON);
  });

  it('stops claiming when less than 60 s of the 300 s budget is left (the route passes no budget of its own)', async () => {
    const store = new FakeStore();
    for (let i = 0; i < 3; i += 1) addJob(store);
    realRunner(store);
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    store.afterFinish = () => {
      clock += 245_000; // the first job "took" 245 s: 55 s are left, which is under the 60 s reserve
    };

    const res = await authorized();
    expect(res.status).toBe(200);
    expect(RunGhlSyncJobsResponse.parse(await res.json())).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(store.queue).toHaveLength(2); // the other two stay due for the next run
  });

  it('keeps claiming while at least 60 s are left (240 s used is still inside the budget)', async () => {
    const store = new FakeStore();
    for (let i = 0; i < 3; i += 1) addJob(store);
    realRunner(store);
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    store.afterFinish = () => {
      clock += 80_000; // after the third job 240 s have passed; every claim happened with 60 s or more left
    };

    expect(RunGhlSyncJobsResponse.parse(await (await authorized()).json())).toEqual({ claimed: 3, succeeded: 3, waiting: 0, failed: 0 });
    expect(store.queue).toHaveLength(0);
  });
});

describe('invariant 11: a failing database is a 500 with no detail, and the log carries { error_class, code } only', () => {
  it('GhlStoreError -> 500 internal_error; the log line names the class and the SQLSTATE and nothing else', async () => {
    spy.mockRejectedValue(new GhlStoreError('claim', '57P01'));
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await authorized();
    });
    const problem = await expectProblem(res as Response, 500, 'internal_error');
    expect(problem.title).toBe('Something went wrong');
    expect(JSON.stringify(problem)).not.toMatch(/claim|57P01|GHL|store/i);
    expect(output).not.toContain('GHL job store failed'); // the error's message is never logged

    const line = JSON.parse(output.split('\n').filter(Boolean)[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'error', route: 'GET /api/jobs/ghl-sync', status: 500, error_class: 'GhlStoreError', code: '57P01' });
    // the log allow-list: exactly these fields, no message, no stack, no detail
    expect(Object.keys(line).sort()).toEqual(['code', 'duration_ms', 'error_class', 'level', 'method', 'outcome', 'request_id', 'route', 'status']);
  });

  it('any other thrown value is a 500 whose message (even one holding personal data) is never answered or logged', async () => {
    spy.mockRejectedValue(new Error('duplicate key for zora.quillfeather@example.test at 77 Marigold Crescent'));
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await authorized();
    });
    await expectProblem(res as Response, 500, 'internal_error');
    expect(output).not.toMatch(/zora|marigold|duplicate key|example\.test/i);
    expect(output).not.toContain(CRON);
  });
});
