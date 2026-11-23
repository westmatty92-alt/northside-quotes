// @vitest-environment node
// The runner loop: error classes -> settle outcomes, one lease per job, the 60 s reserve, the limit, bugs, a
// failing database, and what is logged. In-memory store plus the offline simulator.
// Proves: the outage table of docs/integration-contract.md "When the platform is down" (timeout, 5xx, 429, token
// missing, 401/403, 400/404/422); S0 SEC-7 (lease passed to finish, a lost lease is ignored); the "stop with less
// than 60 s of the 300 s budget left" rule; no crash loop on a bug; the log allow-list (no personal data, no token).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGhlClient, type GhlClient, type GhlErrorClass } from '@/lib/server/integrations/ghl/client';
import { logGhl, type GhlLogEntry } from '@/lib/server/integrations/ghl/log';
import { GhlStoreError, RUN_BUDGET_MS, RUN_RESERVE_MS, runGhlJobsWith } from '@/lib/server/integrations/ghl/runner';
import { startGhlSimulator, type GhlSimulator, type SimMode } from '../../mocks/ghl/simulator.mjs';
import { captureOutput, FakeStore, forbiddenClient, HOMEOWNER, makeRequest, simEnv } from './helpers';

let sim: GhlSimulator;
beforeAll(async () => {
  sim = await startGhlSimulator({ slowMs: 5_000 });
});
afterAll(async () => {
  await sim.close();
});
beforeEach(() => sim.reset());

const quiet = () => undefined;

describe('outage behaviour: every failure becomes a settle the database understands', () => {
  const cases: Array<[string, SimMode, { outcome: string; errorClass: GhlErrorClass }]> = [
    ['5xx', '500', { outcome: 'retry', errorClass: 'server_error' }],
    ['429 (retried with the same backoff)', '429', { outcome: 'retry', errorClass: 'rate_limited' }],
    ['timeout', 'slow', { outcome: 'retry', errorClass: 'timeout' }],
    ['revoked token (401)', 'revoked', { outcome: 'failed', errorClass: 'auth' }],
    ['forbidden (403)', 'forbidden', { outcome: 'failed', errorClass: 'auth' }],
    ['unprocessable (422)', 'unprocessable', { outcome: 'failed', errorClass: 'rejected' }],
    ['not found (404)', 'notfound', { outcome: 'failed', errorClass: 'rejected' }],
    ['a renamed field (drift)', 'drift', { outcome: 'retry', errorClass: 'server_error' }],
  ];
  it.each(cases)('%s', async (_name, mode, expected) => {
    // drift only shows on a reply we parse: make the search find a contact first
    if (mode === 'drift') sim.seedContact({ email: HOMEOWNER.email, phone: '+14165550142', tags: [] });
    sim.setMode(mode);
    const store = new FakeStore();
    store.add(makeRequest());
    const client = createGhlClient({ env: simEnv(sim), timeoutMs: 150 });

    const result = await runGhlJobsWith({}, { store, client, log: quiet });

    expect(store.finished[0]?.settle).toEqual(expected);
    expect(result.claimed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed + result.waiting).toBe(1); // settled, counted, never thrown
  });

  it('no token configured: the job fails at once as config_missing and nothing is sent (AC-009.3, AC-017.10)', async () => {
    const store = new FakeStore();
    store.add(makeRequest());
    const client = createGhlClient({ env: simEnv(sim, { GHL_PRIVATE_INTEGRATION_TOKEN: undefined }) });

    const result = await runGhlJobsWith({}, { store, client, log: quiet });

    expect(result).toEqual({ claimed: 1, succeeded: 0, waiting: 0, failed: 1 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'failed', errorClass: 'config_missing' });
    expect(sim.calls()).toHaveLength(0);
  });

  it('an outage does not stop the run: the next job is still claimed and settled', async () => {
    sim.setMode('500');
    const store = new FakeStore();
    store.add(makeRequest());
    store.add(makeRequest({ email: 'second@example.test', phone: '9055550111' }));

    const result = await runGhlJobsWith({}, { store, client: createGhlClient({ env: simEnv(sim) }), log: quiet });

    expect(result).toEqual({ claimed: 2, succeeded: 0, waiting: 2, failed: 0 });
  });
});

describe('leases (S0 SEC-7)', () => {
  it('each job is settled with the lease of its own claim', async () => {
    const store = new FakeStore();
    const a = store.add(makeRequest({ email: 'a@example.test', phone: '4165550001' }));
    const b = store.add(makeRequest({ email: 'b@example.test', phone: '4165550002' }));
    expect(a.lease_id).not.toBe(b.lease_id);

    await runGhlJobsWith({}, { store, client: createGhlClient({ env: simEnv(sim) }), log: quiet });

    expect(store.finished.map((f) => [f.job.id, f.job.lease_id])).toEqual([
      [a.id, a.lease_id],
      [b.id, b.lease_id],
    ]);
  });

  it('claims one job at a time: every claim is its own call, passing the scope through', async () => {
    const store = new FakeStore();
    const request = makeRequest();
    store.add(request);
    store.add(makeRequest({ email: 'other@example.test', phone: '4165550003' }));

    await runGhlJobsWith({ requestId: request.id }, { store, client: createGhlClient({ env: simEnv(sim) }), log: quiet });

    // one job of that request, then an empty claim ends the run; the other request's job is untouched
    expect(store.claims).toEqual([{ requestId: request.id }, { requestId: request.id }]);
    expect(store.queue).toHaveLength(1);
  });

  it('a result the database ignores (lease re-claimed, or job superseded) is logged as lease_lost and not counted', async () => {
    const entries: GhlLogEntry[] = [];
    const store = new FakeStore();
    store.add(makeRequest({ email: 'a@example.test', phone: '4165550001' }));
    store.add(makeRequest({ email: 'b@example.test', phone: '4165550002' }));
    let n = 0;
    // 1st: another runner re-claimed the job (the row comes back still leased); 2nd: a status change superseded it
    store.settleOverride = () => (++n === 1 ? { state: 'waiting', lease_id: 'someone-elses-lease' } : { state: 'superseded', lease_id: null });

    const result = await runGhlJobsWith({}, { store, client: createGhlClient({ env: simEnv(sim) }), log: (e) => entries.push(e) });

    expect(result).toEqual({ claimed: 2, succeeded: 0, waiting: 0, failed: 0 });
    expect(entries.filter((e) => e.outcome === 'lease_lost')).toHaveLength(2);
  });

  it('a job that is superseded while GHL is slow is ignored without error', async () => {
    const store = new FakeStore();
    store.add(makeRequest());
    store.settleOverride = () => ({ state: 'superseded', lease_id: null });
    await expect(runGhlJobsWith({}, { store, client: createGhlClient({ env: simEnv(sim) }), log: quiet })).resolves.toMatchObject({ claimed: 1, succeeded: 0 });
  });
});

describe('time budget: stop with less than 60 s of the 300 s left', () => {
  const setup = (advances: number[]) => {
    let clock = 1_000_000;
    const store = new FakeStore();
    for (let i = 0; i < 4; i += 1) store.add(makeRequest({ email: `j${i}@example.test`, phone: `41655500${10 + i}` }));
    let i = 0;
    store.afterFinish = () => {
      clock += advances[i] ?? 0;
      i += 1;
    };
    return { store, now: () => clock };
  };

  it('keeps claiming while at least 60 s are left and stops as soon as fewer are', async () => {
    // after job 1: 100 s used (200 s left) -> go on; after job 2: 245 s used (55 s left) -> stop
    const { store, now } = setup([100_000, 145_000, 0, 0]);
    const entries: GhlLogEntry[] = [];
    const result = await runGhlJobsWith({}, { store, client: createGhlClient({ env: simEnv(sim) }), now, log: (e) => entries.push(e) });
    expect(result.claimed).toBe(2);
    expect(store.queue).toHaveLength(2); // never claimed, so never leased
    expect(entries.some((e) => e.outcome === 'budget_reached')).toBe(true);
  });

  it('exactly 60 s left is still enough; 59.999 s is not', async () => {
    expect(RUN_BUDGET_MS - RUN_RESERVE_MS).toBe(240_000);
    const exact = setup([240_000, 0, 0, 0]);
    const first = await runGhlJobsWith({}, { store: exact.store, client: createGhlClient({ env: simEnv(sim) }), now: exact.now, log: quiet });
    expect(first.claimed).toBe(4);

    const over = setup([240_001, 0, 0, 0]);
    const second = await runGhlJobsWith({}, { store: over.store, client: createGhlClient({ env: simEnv(sim) }), now: over.now, log: quiet });
    expect(second.claimed).toBe(1);
  });

  it('never claims at all when the run starts with the reserve already gone', async () => {
    const store = new FakeStore();
    store.add(makeRequest());
    const result = await runGhlJobsWith({}, { store, client: forbiddenClient(), budgetMs: 59_000, log: quiet });
    expect(result.claimed).toBe(0);
    expect(store.claims).toHaveLength(0);
  });
});

describe('limit and scope', () => {
  it('limit caps the number of claims; 0 claims nothing', async () => {
    const store = new FakeStore();
    for (let i = 0; i < 5; i += 1) store.add(makeRequest({ email: `l${i}@example.test`, phone: `41655501${10 + i}` }));
    const client: GhlClient = createGhlClient({ env: simEnv(sim) });
    expect((await runGhlJobsWith({ limit: 2 }, { store, client, log: quiet })).claimed).toBe(2);
    expect(store.queue).toHaveLength(3);
    expect((await runGhlJobsWith({ limit: 0 }, { store, client: forbiddenClient(), log: quiet })).claimed).toBe(0);
    expect((await runGhlJobsWith({ limit: Number.NaN }, { store, client: forbiddenClient(), log: quiet })).claimed).toBe(0);
  });

  it('a request or job id that is not a uuid claims nothing', async () => {
    const store = new FakeStore();
    store.add(makeRequest());
    expect(await runGhlJobsWith({ requestId: "x' or 1=1" }, { store, client: forbiddenClient(), log: quiet })).toEqual({ claimed: 0, succeeded: 0, waiting: 0, failed: 0 });
    expect((await runGhlJobsWith({ jobId: 'nope' }, { store, client: forbiddenClient(), log: quiet })).claimed).toBe(0);
    expect(store.claims).toHaveLength(0);
  });

  it('with nothing due the run claims once and ends with zero counts and no GHL call', async () => {
    const store = new FakeStore();
    expect(await runGhlJobsWith({}, { store, client: forbiddenClient(), log: quiet })).toEqual({ claimed: 0, succeeded: 0, waiting: 0, failed: 0 });
  });
});

describe('a bug or a broken database never loops or leaves a lease behind unseen', () => {
  it('an unexpected exception settles the job as one failed attempt (server_error) and the run goes on', async () => {
    const store = new FakeStore();
    store.add(makeRequest({ email: 'bug@example.test', phone: '4165550201' }));
    store.add(makeRequest({ email: 'fine@example.test', phone: '4165550202' }));
    const real = createGhlClient({ env: simEnv(sim) });
    let calls = 0;
    const client: GhlClient = {
      ...real,
      findDuplicateContact: async (input) => {
        calls += 1;
        if (calls === 1) throw new TypeError('boom with person@example.test inside');
        return real.findDuplicateContact(input);
      },
    };
    const output = captureOutput();
    let result;
    try {
      result = await runGhlJobsWith({}, { store, client, log: logGhl });
    } finally {
      output.stop();
    }
    expect(result).toEqual({ claimed: 2, succeeded: 1, waiting: 1, failed: 0 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'retry', errorClass: 'server_error' });
    expect(output.text()).not.toContain('boom');
    expect(output.text()).not.toContain('person@example.test');
  });

  it('a database failure stops the run with a sanitised error (operation and SQLSTATE only)', async () => {
    const store = new FakeStore();
    store.add(makeRequest());
    store.failOn = 'loadRequest';
    const error = await runGhlJobsWith({}, { store, client: forbiddenClient(), log: quiet }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GhlStoreError);
    expect((error as GhlStoreError).code).toBe('57P01');
    expect(store.finished).toHaveLength(0);
  });
});

describe('redaction: logs carry ids and classes only', () => {
  it('a successful create, a failed attempt and a lost lease log no name, phone, email, address, token or contact id', async () => {
    const output = captureOutput();
    try {
      const store = new FakeStore();
      store.add(makeRequest());
      store.add(makeRequest({ email: 'second.person@example.test', phone: '4165550301', name: 'Second Person' }));
      store.add(makeRequest({ email: 'third.person@example.test', phone: '4165550302', name: 'Third Person' }));
      let n = 0;
      store.settleOverride = (_job, outcome) => (++n === 3 ? { state: 'waiting', lease_id: 'other' } : { state: outcome === 'succeeded' ? 'succeeded' : 'waiting', lease_id: null });
      sim.queueModes(['ok', 'ok', 'ok', '500', '500', 'ok']); // job 1 succeeds, then a mix of failures and successes
      await runGhlJobsWith({}, { store, client: createGhlClient({ env: simEnv(sim) }), log: logGhl });
    } finally {
      output.stop();
    }
    const text = output.text();
    expect(text.length).toBeGreaterThan(0);
    for (const value of [sim.token, HOMEOWNER.name, 'Quillfeather', HOMEOWNER.email, HOMEOWNER.phone, '+14165550142', HOMEOWNER.address, 'second.person', 'third.person', 'simcontact', sim.url]) {
      expect(text).not.toContain(value);
    }
    // every line is one JSON object whose keys are on the allow-list
    const allowed = new Set(['route', 'level', 'outcome', 'error_class', 'code', 'job_id', 'attempt', 'quote_request_id']);
    for (const line of output.lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) expect(allowed.has(key)).toBe(true);
    }
  });

  it('the log emitter drops any field that is not on the allow-list', () => {
    const output = captureOutput();
    try {
      logGhl({ outcome: 'succeeded', job_id: 'j1', email: 'leak@example.test', body: '{"name":"x"}', token: 'secret' } as unknown as GhlLogEntry);
    } finally {
      output.stop();
    }
    expect(JSON.parse(output.lines[0] ?? '{}')).toEqual({ route: 'ghl-sync', level: 'info', outcome: 'succeeded', job_id: 'j1' });
  });
});
