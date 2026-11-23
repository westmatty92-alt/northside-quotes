// @vitest-environment node
// POST /api/quote-requests/{request_id}/ghl-copy-retries (retryGhlCopy, US-014), called in-process. Offline: the staff guard, the
// database client and the GHL runner are scripted, so this file proves the ROUTE's rules on their own: who may call it, which
// database answers become which problem, that a refused retry never reaches the runner (so never GoHighLevel), what the runner is
// asked to do, and what is answered and logged. The same route against the staging database, a real staff session and the GHL
// simulator is tests/integrations/routes/db.test.ts.
//
// Proves: AC-014.4 (an unticked request: 409 not_retryable, the runner is never called), AC-014.3 (a retry of a copy that is not
// failed, including one already running: 409), SECURITY_MODEL "API authentication" (401 before anything else), the contract's
// 401, 404, 409 and 500 (a 503 or 422 from the database becomes a 500), invariant 11 (problem+json from our text, the log line
// carries { error_class, code } only), and "one attempt for this one job" (runGhlJobsWith({ jobId, limit: 1 })).
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PATCH, POST, PUT, maxDuration } from '@/app/api/quote-requests/[request_id]/ghl-copy-retries/route';
import { RetryGhlCopyResponse } from '@/lib/api/generated/go-high-level/go-high-level.zod';
import { ProblemError } from '@/lib/server/http';
import { GhlStoreError } from '@/lib/server/integrations/ghl/runner';
import { captureOutput, expectProblem, jsonRequest } from '../../helpers/api';

const mocks = vi.hoisted(() => ({ requireStaff: vi.fn(), runGhlJobsWith: vi.fn() }));
vi.mock('@/lib/server/auth/require-staff', () => ({ requireStaff: mocks.requireStaff }));
// Only the runner function is replaced: GhlStoreError (a real class) and the constants stay real.
vi.mock('@/lib/server/integrations/ghl/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/integrations/ghl/runner')>()),
  runGhlJobsWith: mocks.runGhlJobsWith,
}));

const REQUEST = randomUUID();
const JOB = randomUUID();
const STAFF_TOKEN = `fake.${randomUUID()}.token`; // never a real token
const PERSONAL = 'zora.quillfeather@example.test at 77 Marigold Crescent';

type Reply = { data?: unknown; error?: { code?: string; message?: string } | null };

/** A database client that answers the one RPC and the one read the route makes, and remembers how it was asked. */
function fakeDb(script: { rpc: Reply; jobs?: Reply }) {
  const filters: Array<[string, unknown]> = [];
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    }),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: script.jobs?.data ?? [], error: script.jobs?.error ?? null })),
  };
  const db = {
    rpc: vi.fn(() => Promise.resolve({ data: script.rpc.data ?? null, error: script.rpc.error ?? null })),
    from: vi.fn(() => chain),
  };
  return { db, chain, filters };
}

function signedInAs(db: unknown) {
  mocks.requireStaff.mockResolvedValue({ userId: randomUUID(), displayName: 'Owner', accessToken: STAFF_TOKEN, db });
}

const post = (id: string = REQUEST) =>
  POST(jsonRequest(`/api/quote-requests/${id}/ghl-copy-retries`, { headers: { authorization: `Bearer ${STAFF_TOKEN}` } }), {
    params: Promise.resolve({ request_id: id }),
  });

const AT = '2026-11-19T16:00:02.000Z';

beforeEach(() => {
  mocks.requireStaff.mockReset();
  mocks.runGhlJobsWith.mockReset().mockResolvedValue({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a retry that runs: one attempt for the one re-armed job, and the copy state after it', () => {
  it('copied: 200 with the copy state and retried true; the runner is asked for exactly that job and nothing else', async () => {
    const { db, filters } = fakeDb({ rpc: { data: JOB }, jobs: { data: [{ state: 'succeeded', last_attempt_at: AT }] } });
    signedInAs(db);

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(RetryGhlCopyResponse.parse(await res.json())).toEqual({ copy: { state: 'copied', at: AT }, retried: true });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('request_ghl_copy_retry', { p_request_id: REQUEST });
    expect(mocks.runGhlJobsWith).toHaveBeenCalledExactlyOnceWith({ jobId: JOB, limit: 1 }); // no requestId: never "all due jobs"
    expect(filters).toEqual([['request_id', REQUEST], ['kind', 'contact_copy']]);
    expect(mocks.requireStaff).toHaveBeenCalledOnce();
  });

  it('failed again: 200 with state failed, the time of the attempt and retried true (the screen says "The retry did not work")', async () => {
    signedInAs(fakeDb({ rpc: { data: JOB }, jobs: { data: [{ state: 'failed', last_attempt_at: AT }] } }).db);
    mocks.runGhlJobsWith.mockResolvedValue({ claimed: 1, succeeded: 0, waiting: 0, failed: 1 });

    const res = await post();

    expect(res.status).toBe(200);
    expect(RetryGhlCopyResponse.parse(await res.json())).toEqual({ copy: { state: 'failed', at: AT }, retried: true });
  });

  it('another runner took the re-armed job first: 200, retried false, and the state it is in now (waiting)', async () => {
    signedInAs(fakeDb({ rpc: { data: JOB }, jobs: { data: [{ state: 'waiting', last_attempt_at: null }] } }).db);
    mocks.runGhlJobsWith.mockResolvedValue({ claimed: 0, succeeded: 0, waiting: 0, failed: 0 });

    const res = await post();

    expect(res.status).toBe(200);
    expect(RetryGhlCopyResponse.parse(await res.json())).toEqual({ copy: { state: 'waiting', at: null }, retried: false });
  });

  it('answers only the contract\'s two fields', async () => {
    signedInAs(fakeDb({ rpc: { data: JOB }, jobs: { data: [{ state: 'succeeded', last_attempt_at: AT }] } }).db);
    const raw = (await (await post()).json()) as object;
    expect(Object.keys(raw).sort()).toEqual(['copy', 'retried']);
  });

  it('is configured for an attempt of up to three 10-second GHL calls', () => {
    expect(maxDuration).toBe(60);
  });
});

describe('a retry that is refused makes no GHL call (AC-014.4, AC-014.3)', () => {
  it('PT409 (no offers consent, or the copy is not failed, or an attempt is already running) -> 409 not_retryable, the runner never runs', async () => {
    const { db } = fakeDb({ rpc: { error: { code: 'PT409', message: 'no offers consent: this request is never copied' } } });
    signedInAs(db);
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await post();
    });

    const problem = await expectProblem(res as Response, 409, 'not_retryable'); // not stale_version, which is what PT409 means elsewhere
    expect(problem.title).toBe('This copy cannot be retried.');
    expect(mocks.runGhlJobsWith).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
    expect(output).not.toContain('never copied'); // the database's text is never logged
    expect(JSON.parse(output.split('\n').filter(Boolean)[0]!)).toMatchObject({ level: 'warn', status: 409, error_class: 'postgrest', code: 'PT409' });
  });

  it('the answer carries nothing of the request: no name, phone, email or address, whatever the database said', async () => {
    signedInAs(fakeDb({ rpc: { error: { code: 'PT409', message: PERSONAL } } }).db);
    const res = await post();
    expect(await res.text()).not.toMatch(/zora|marigold|example\.test/i);
  });
});

describe('who may call it, and which request it names', () => {
  it('no valid staff session -> 401 session_expired from the guard, before the database or the runner is touched', async () => {
    const { db } = fakeDb({ rpc: { data: JOB } });
    mocks.requireStaff.mockRejectedValue(new ProblemError(401, 'session_expired', { errorClass: 'no_bearer_token', logCode: 'none' }));

    const res = await POST(jsonRequest(`/api/quote-requests/${REQUEST}/ghl-copy-retries`), { params: Promise.resolve({ request_id: REQUEST }) });

    await expectProblem(res, 401, 'session_expired');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(mocks.runGhlJobsWith).not.toHaveBeenCalled();
  });

  it('the guard is called with the incoming request (the bearer token is the only credential)', async () => {
    signedInAs(fakeDb({ rpc: { data: JOB }, jobs: { data: [{ state: 'succeeded', last_attempt_at: AT }] } }).db);
    await post();
    const [passed] = mocks.requireStaff.mock.calls[0] as [Request];
    expect(passed.headers.get('authorization')).toBe(`Bearer ${STAFF_TOKEN}`);
  });

  it('PT401 from the database (the session ended meanwhile) -> 401 session_expired, no runner', async () => {
    signedInAs(fakeDb({ rpc: { error: { code: 'PT401' } } }).db);
    await expectProblem(await post(), 401, 'session_expired');
    expect(mocks.runGhlJobsWith).not.toHaveBeenCalled();
  });

  it('PT404 (an unknown request, or one still pending) -> 404 not_found, no runner', async () => {
    signedInAs(fakeDb({ rpc: { error: { code: 'PT404' } } }).db);
    await expectProblem(await post(), 404, 'not_found');
    expect(mocks.runGhlJobsWith).not.toHaveBeenCalled();
  });

  it.each(['not-a-uuid', '123', `${REQUEST}x`, '%20', '../quote'])('an id that is not a uuid (%s) -> 404 not_found without asking the database', async (id) => {
    const { db } = fakeDb({ rpc: { data: JOB } });
    signedInAs(db);
    await expectProblem(await post(id), 404, 'not_found');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(mocks.runGhlJobsWith).not.toHaveBeenCalled();
  });

  it('any other method is a 405 problem with Allow: POST, and the guard is not even called', async () => {
    for (const [name, handler] of [['GET', GET], ['PUT', PUT], ['PATCH', PATCH], ['DELETE', DELETE]] as const) {
      const res = await handler(jsonRequest(`/api/quote-requests/${REQUEST}/ghl-copy-retries`, { method: name }), { params: Promise.resolve({ request_id: REQUEST }) });
      await expectProblem(res, 405, 'method_not_allowed');
      expect(res.headers.get('allow')).toBe('POST');
    }
    expect(mocks.requireStaff).not.toHaveBeenCalled();
    expect(mocks.runGhlJobsWith).not.toHaveBeenCalled();
  });
});

describe('invariant 11: every other failure is a 500 problem with no detail; the log carries { error_class, code } only', () => {
  it.each([
    ['an unreachable database (supabase-js gives an empty code)', ''],
    ['a connection failure (08006)', '08006'],
    ['an overloaded database (53300)', '53300'],
    ['a validation code the contract does not list for this operation (PT422)', 'PT422'],
    ['a permission error (42501)', '42501'],
  ])('%s -> 500 internal_error (this operation lists no 503 or 422)', async (_label, code) => {
    signedInAs(fakeDb({ rpc: { error: { code, message: PERSONAL } } }).db);
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await post();
    });

    const problem = await expectProblem(res as Response, 500, 'internal_error');
    expect(JSON.stringify(problem)).not.toMatch(/zora|marigold|example\.test/i);
    expect(output).not.toMatch(/zora|marigold|example\.test/i);
    expect(JSON.parse(output.split('\n').filter(Boolean)[0]!)).toMatchObject({ level: 'error', status: 500, error_class: 'postgrest' });
    expect(mocks.runGhlJobsWith).not.toHaveBeenCalled();
  });

  it('a reply that is not a job id is a 500, and no attempt runs', async () => {
    for (const data of [null, 42, 'not-a-uuid', {}]) {
      mocks.runGhlJobsWith.mockClear();
      signedInAs(fakeDb({ rpc: { data } }).db);
      await expectProblem(await post(), 500, 'internal_error');
      expect(mocks.runGhlJobsWith).not.toHaveBeenCalled();
    }
  });

  it('the database failing inside the run (GhlStoreError) -> 500; the log names the class and the SQLSTATE, never the message', async () => {
    signedInAs(fakeDb({ rpc: { data: JOB } }).db);
    mocks.runGhlJobsWith.mockRejectedValue(new GhlStoreError('claim', '57P01'));
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await post();
    });

    const problem = await expectProblem(res as Response, 500, 'internal_error');
    expect(problem.title).toBe('Something went wrong');
    expect(output).not.toContain('GHL job store failed');
    const line = JSON.parse(output.split('\n').filter(Boolean)[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'error', route: 'POST /api/quote-requests/[request_id]/ghl-copy-retries', status: 500, error_class: 'GhlStoreError', code: '57P01' });
    expect(Object.keys(line).sort()).toEqual(['code', 'duration_ms', 'error_class', 'level', 'method', 'outcome', 'request_id', 'route', 'status']);
  });

  it('any other error thrown by the run is a 500 whose message (with personal data in it) is never answered or logged', async () => {
    signedInAs(fakeDb({ rpc: { data: JOB } }).db);
    mocks.runGhlJobsWith.mockRejectedValue(new Error(`boom ${PERSONAL}`));
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await post();
    });
    await expectProblem(res as Response, 500, 'internal_error');
    expect(output).not.toMatch(/zora|marigold|boom|example\.test/i);
  });

  it('failing to read the copy state back is a 500 too', async () => {
    signedInAs(fakeDb({ rpc: { data: JOB }, jobs: { error: { code: '08006', message: PERSONAL } } }).db);
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await post();
    });
    await expectProblem(res as Response, 500, 'internal_error');
    expect(output).not.toMatch(/zora|marigold|example\.test/i);
  });

  it('a successful retry logs no token, no personal data and no database text', async () => {
    signedInAs(fakeDb({ rpc: { data: JOB }, jobs: { data: [{ state: 'succeeded', last_attempt_at: AT }] } }).db);
    const output = await captureOutput(async () => {
      await post();
    });
    expect(output).not.toContain(STAFF_TOKEN);
    expect(output).not.toContain(JOB); // job ids belong in the runner's own line, not here
    expect(JSON.parse(output.split('\n').filter(Boolean)[0]!)).toMatchObject({ level: 'info', status: 200, outcome: 'ok' });
  });
});
