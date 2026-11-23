// @vitest-environment node
// createQuoteRequest when the dependencies misbehave. The service-role client is replaced by a scripted fake, so these tests need
// no database and can force errors staging never produces: a 23514 that carries the failing row (S0 SEC-5), a 23505 race on
// submission_key, an unreachable database (AC-001.8), a failing spam counter (invariant 20), a Storage failure.
// Only fake personal data appears here, and every assertion is that none of it comes back out.
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createPost } from '@/app/api/quote-requests/route';
import { issueFormToken } from '@/lib/server/form-token';
import { addressHash } from '@/lib/server/services/network';
import { captureOutput, expectProblem, jsonRequest } from '../../helpers/api';

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  config: { broken: false },
}));

vi.mock('@/lib/server/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/admin')>();
  return {
    ...actual,
    getAdminClient: () => {
      if (fake.config.broken) throw new actual.AdminClientConfigError();
      return { rpc: fake.rpc, storage: { from: () => ({ list: fake.list, remove: fake.remove }) } };
    },
  };
});

const SIGNING = randomBytes(32).toString('hex');
const IP = '198.51.100.23';
const PERSONAL = { name: 'Quillfeather Zora', phone: '416-555-0188', email: 'zora.quillfeather@example.test', address: '77 Marigold Crescent, Hamilton' };
const LEAK = ['Quillfeather', 'Zora', '4165550188', 'zora.quillfeather', 'Marigold'];
const REQUEST_ID = '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';

/** What PostgREST returns for a check violation: the failing row is in `details` (SECURITY_MODEL invariant 11). */
const checkViolation = (constraint: string) => ({
  code: '23514',
  message: `new row for relation "quote_requests" violates check constraint "${constraint}"`,
  details: `Failing row contains (${REQUEST_ID}, ${PERSONAL.name}, 4165550188, ${PERSONAL.email}, ${PERSONAL.address}, The tap drips)`,
  hint: null,
});

const created = { outcome: 'created', request_id: REQUEST_ID, state: 'pending', reference: null, photo_count: 0, created_at: '2026-11-20T15:00:00.123456+00:00' };

function body(overrides: Record<string, unknown> = {}) {
  return { ...PERSONAL, problem: 'The test tap drips constantly under the sink', urgency: 'soon', ...overrides };
}

async function post(payload: unknown, options: { token?: string; ip?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'x-form-token': options.token ?? issueFormToken(Date.now() - 10_000) };
  const ip = options.ip === undefined ? IP : options.ip;
  if (ip !== null) headers['x-real-ip'] = ip;
  return createPost(jsonRequest('/api/quote-requests', { headers, body: payload }), undefined);
}

/** Script rpc by function name: `start` and `spam` are results ({ data, error }) or functions that return/throw them. */
function script(handlers: { start?: unknown; spam?: unknown }) {
  fake.rpc.mockImplementation(async (name: string) => {
    const handler = name === 'start_quote_request' ? handlers.start : handlers.spam;
    const value = typeof handler === 'function' ? await (handler as () => unknown)() : handler;
    return value ?? { data: { logged: true }, error: null };
  });
}

beforeEach(() => {
  vi.stubEnv('APP_SIGNING_SECRET', SIGNING);
  fake.rpc.mockReset();
  fake.list.mockReset().mockResolvedValue({ data: [], error: null });
  fake.remove.mockReset().mockResolvedValue({ data: [], error: null });
  fake.config.broken = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('S0 SEC-5: a forced 23514 on create leaks no name, phone or email into the log line or the response', () => {
  it('answers 422 with our own message for the field, and nothing from the database error appears anywhere', async () => {
    script({ start: { data: null, error: checkViolation('quote_requests_problem_check') } });
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await post(body());
    });
    const text = await (res as Response).clone().text();
    const problem = await expectProblem(res as Response, 422, 'validation_failed');
    expect(problem.errors).toEqual([{ field: 'problem', message: 'Describe the problem in 10 to 2,000 characters' }]);
    for (const value of LEAK) {
      expect(text).not.toContain(value);
      expect(output).not.toContain(value);
    }
    expect(text).not.toMatch(/Failing row|violates|check constraint|quote_requests/);
    expect(output).not.toMatch(/Failing row|violates|check constraint|quote_requests|relation/);

    const lines = output.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'warn', status: 422, outcome: 'validation_failed', error_class: 'postgrest', code: '23514' });
    expect(Object.keys(lines[0]!).sort()).toEqual(['code', 'duration_ms', 'error_class', 'level', 'method', 'outcome', 'request_id', 'route', 'status']);
  });

  it('a 23514 whose constraint is not one of ours is still a 422, with no field text invented', async () => {
    script({ start: { data: null, error: checkViolation('some_other_check') } });
    const res = await post(body());
    const problem = await expectProblem(res, 422, 'validation_failed');
    expect(problem.errors).toBeUndefined();
  });

  it('an unknown database error is a generic 500 that logs only its class and code', async () => {
    script({ start: { data: null, error: { code: 'XX000', message: `boom ${PERSONAL.email}`, details: PERSONAL.name, hint: PERSONAL.address } } });
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await post(body());
    });
    const problem = await expectProblem(res as Response, 500, 'internal_error');
    expect(problem.title).toBe('Something went wrong');
    for (const text of [output, JSON.stringify(problem)]) for (const value of LEAK) expect(text).not.toContain(value);
    expect(JSON.parse(output.split('\n').filter(Boolean)[0]!)).toMatchObject({ level: 'error', status: 500, error_class: 'postgrest', code: 'XX000' });
  });

  it('a malformed answer from the database function is a generic 500 and logs no value', async () => {
    script({ start: { data: { outcome: 'surprise', note: PERSONAL.email }, error: null } });
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await post(body());
    });
    await expectProblem(res as Response, 500, 'internal_error');
    for (const value of LEAK) expect(output).not.toContain(value);
    expect(output).not.toContain('surprise');
  });
});

describe('AC-001.8: the database cannot be reached', () => {
  it.each([
    ['a network failure (supabase-js gives an empty code)', { code: '', message: 'TypeError: fetch failed', details: null, hint: null }],
    ['a connection error', { code: '08006', message: 'connection failure', details: null, hint: null }],
    ['a statement timeout', { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null }],
    ['PostgREST without a database', { code: 'PGRST002', message: 'Could not query the database for the schema cache', details: null, hint: null }],
  ])('%s gives 503 service_unavailable with the designed text', async (_label, error) => {
    script({ start: { data: null, error } });
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await post(body());
    });
    const problem = await expectProblem(res as Response, 503, 'service_unavailable');
    expect(problem.title).toBe("We couldn't send your request. Please try again.");
    for (const value of LEAK) expect(output).not.toContain(value);
  });

  it('a service-role client that is not configured is a 503, not a crash', async () => {
    fake.config.broken = true;
    const res = await post(body());
    await expectProblem(res, 503, 'service_unavailable');
  });
});

describe('SEC-2: a 23505 on submission_key is answered as the replay, never a 500', () => {
  it('retries the call once and returns what the second call says (200 replayed)', async () => {
    let calls = 0;
    script({
      start: () => {
        calls += 1;
        return calls === 1
          ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "quote_requests_submission_key_key"', details: `Key (submission_key)=(x) already exists.`, hint: null } }
          : { data: { ...created, outcome: 'replayed' }, error: null };
      },
    });
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ request_id: REQUEST_ID, submission_state: 'pending', reference: null });
    expect(calls).toBe(2);
  });

  it('a second 23505 is a generic 500', async () => {
    script({ start: { data: null, error: { code: '23505', message: 'duplicate key', details: PERSONAL.email, hint: null } } });
    const res = await post(body());
    await expectProblem(res, 500, 'internal_error');
    expect(fake.rpc.mock.calls.filter(([name]) => name === 'start_quote_request')).toHaveLength(2);
  });
});

describe('what start_quote_request is called with', () => {
  it('trims the email, passes only a JSON true as consent, 10 digits for the phone, the photo count, and the address hash (never the address)', async () => {
    script({ start: { data: created, error: null } });
    await post(body({ email: `  ${PERSONAL.email}  `, marketing_consent: 'true', phone: '+1 (416) 555-0188', photos: [{ position: 1, content_type: 'image/jpeg', size_bytes: 10 }] }));
    const [, args] = fake.rpc.mock.calls.find(([name]) => name === 'start_quote_request')!;
    expect(args).toMatchObject({
      p_email: PERSONAL.email,
      p_phone: '4165550188',
      p_marketing_consent: false,
      p_photo_count: 1,
      p_ip_hash: addressHash(IP),
    });
    expect(JSON.stringify(args)).not.toContain(IP);

    fake.rpc.mockClear();
    script({ start: { data: created, error: null } });
    await post(body({ marketing_consent: true }));
    expect(fake.rpc.mock.calls.find(([name]) => name === 'start_quote_request')![1]).toMatchObject({ p_marketing_consent: true });
  });

  it('passes no address hash when no address is known, so the database accepts the request (AC-003.5)', async () => {
    script({ start: { data: created, error: null } });
    await post(body(), { ip: null });
    expect(fake.rpc.mock.calls.find(([name]) => name === 'start_quote_request')![1]).toMatchObject({ p_ip_hash: null });
  });
});

describe('FR-8 / SEC-14: spam refusals are recorded, errors are ignored, the refusal is identical either way', () => {
  const refuse = async () => (await post(body({ website: 'bot' })));

  it('records a honeypot refusal once with the address hash and the reason, and refuses', async () => {
    script({});
    const res = await refuse();
    await expectProblem(res, 400, 'submission_refused');
    const spam = fake.rpc.mock.calls.filter(([name]) => name === 'record_spam_refusal');
    expect(spam).toEqual([['record_spam_refusal', { p_ip_hash: addressHash(IP), p_reason: 'honeypot' }]]);
    expect(fake.rpc.mock.calls.some(([name]) => name === 'start_quote_request')).toBe(false); // nothing is created
  });

  it('records the time trap as too_fast and the rate limit as rate_limited', async () => {
    script({});
    await post(body(), { token: issueFormToken(Date.now() - 100) });
    script({ start: { data: { outcome: 'rate_limited', retry_after_seconds: 321 }, error: null } });
    const limited = await post(body());
    await expectProblem(limited, 429, 'rate_limited');
    expect(limited.headers.get('retry-after')).toBe('321');
    const reasons = fake.rpc.mock.calls.filter(([name]) => name === 'record_spam_refusal').map(([, args]) => (args as { p_reason: string }).p_reason);
    expect(reasons).toEqual(['too_fast', 'rate_limited']);
  });

  it.each([
    ['an error result', { data: null, error: { code: '40001', message: `serialization ${PERSONAL.email}`, details: PERSONAL.name, hint: null } }],
    ['a thrown network error', () => Promise.reject(Object.assign(new TypeError(`fetch failed ${PERSONAL.email}`), { code: 'ECONNRESET' }))],
  ])('when recording the refusal fails with %s, the refusal is byte-identical and only { error_class, code } is logged', async (_label, spam) => {
    script({});
    const ok = await refuse();
    const okText = await ok.text();

    script({ spam });
    let failing: Response | undefined;
    const output = await captureOutput(async () => {
      failing = await refuse();
    });
    expect(failing!.status).toBe(400);
    expect(await failing!.text()).toBe(okText);
    for (const value of LEAK) expect(output).not.toContain(value);
    const lines = output.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.find((l) => l.outcome === 'spam_refusal_not_recorded')).toMatchObject({ level: 'warn' });
    for (const line of lines) expect(Object.keys(line).every((k) => ['level', 'request_id', 'route', 'method', 'status', 'duration_ms', 'outcome', 'error_class', 'code'].includes(k))).toBe(true);
  });
});

describe('a changed answer for a pending request clears its uploads, and a Storage failure is a 503', () => {
  it('lists the request folder and removes its photos before answering 200', async () => {
    script({ start: { data: { ...created, outcome: 'updated' }, error: null } });
    fake.list.mockResolvedValue({ data: [{ name: 'photo-1' }, { name: 'photo-2' }, { name: '.emptyFolderPlaceholder' }], error: null });
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(fake.list).toHaveBeenCalledWith(REQUEST_ID, expect.anything());
    expect(fake.remove).toHaveBeenCalledWith([`${REQUEST_ID}/photo-1`, `${REQUEST_ID}/photo-2`]);
  });

  it('answers 503 when Storage cannot list or remove them (the retry then replays the request, never a 500)', async () => {
    script({ start: { data: { ...created, outcome: 'updated' }, error: null } });
    fake.list.mockResolvedValue({ data: null, error: { message: 'storage down' } });
    await expectProblem(await post(body()), 503, 'service_unavailable');

    fake.list.mockResolvedValue({ data: [{ name: 'photo-1' }], error: null });
    fake.remove.mockResolvedValue({ data: null, error: { message: 'storage down' } });
    await expectProblem(await post(body()), 503, 'service_unavailable');
  });
});
