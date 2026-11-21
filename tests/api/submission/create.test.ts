// @vitest-environment node
// POST /api/quote-requests (createQuoteRequest) against the STAGING Supabase project, called in-process.
// Every row this file creates is tracked and deleted in afterAll (tests/helpers/staging.ts), which also proves the cleanup.
// Acceptance criteria: AC-001.1 to .7, .14 to .17, AC-003.2, .3, .7 (US-001, US-003). The 429 and parallel cases are in rate-limit.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { POST as createPost } from '@/app/api/quote-requests/route';
import { CreateQuoteRequestResponse } from '@/lib/api/generated/public-form/public-form.zod';
import { addressHash } from '@/lib/server/services/network';
import { captureOutput, expectProblem, jsonRequest, jpegBytes } from '../../helpers/api';
import { setupStaging } from '../../helpers/staging';

const staging = setupStaging();

type CreateOptions = { token?: string | null; ip?: string | null; rawBody?: string };

/** POST the body as the homeowner's browser would; tracks the request id for cleanup. */
async function create(body: unknown, options: CreateOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = options.token === undefined ? staging.token() : options.token;
  if (token !== null) headers['x-form-token'] = token;
  const ip = options.ip === undefined ? staging.address() : options.ip;
  if (ip !== null) headers['x-real-ip'] = ip;
  const res = await createPost(jsonRequest('/api/quote-requests', { headers, ...(options.rawBody === undefined ? { body } : { rawBody: options.rawBody }) }), undefined);
  if (res.ok) {
    const id = ((await res.clone().json()) as { request_id?: string }).request_id;
    if (id) staging.trackRequest(id);
  }
  return res;
}

async function stored(id: string) {
  const { data, error } = await staging.db().from('quote_requests').select('*').eq('id', id).single();
  expect(error).toBeNull();
  return data!;
}

async function countByEmail(email: string): Promise<number> {
  const { data, error } = await staging.db().from('quote_requests').select('id').eq('email', email);
  expect(error).toBeNull();
  return (data ?? []).length;
}

describe('createQuoteRequest: a new pending request (AC-001.1, AC-001.15)', () => {
  it('answers 201 with the contract shape, the upload targets and a 60-minute window; stores a pending request staff cannot see', async () => {
    const body = staging.body({
      phone: '+1 (416) 555-0123',
      photos: [
        { position: 1, content_type: 'image/jpeg', size_bytes: 2_097_152 },
        { position: 2, content_type: 'image/png', size_bytes: 1_048_576 },
      ],
    });
    const res = await create(body);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json');
    const started = CreateQuoteRequestResponse.parse(await res.json());
    expect(started.submission_state).toBe('pending');
    expect(started.reference).toBeNull();
    expect(started.photo_uploads).toEqual([
      { position: 1, bucket: 'quote-photos', path: `${started.request_id}/photo-1`, content_type: 'image/jpeg' },
      { position: 2, bucket: 'quote-photos', path: `${started.request_id}/photo-2`, content_type: 'image/png' },
    ]);

    const row = await stored(started.request_id);
    expect(row).toMatchObject({ state: 'pending', reference: null, submitted_at: null, status: 'new', photo_count: 2, phone: '4165550123', marketing_consent: false, marketing_consent_at: null });
    expect(new Date(started.upload_expires_at!).getTime()).toBe(new Date(row.created_at).getTime() + 60 * 60 * 1000);
  });

  it('AC-001.14: only the JSON value true is stored as consent yes', async () => {
    const res = await create(staging.body({ marketing_consent: true }));
    expect(res.status).toBe(201);
    const row = await stored(CreateQuoteRequestResponse.parse(await res.json()).request_id);
    expect(row.marketing_consent).toBe(true);
  });

  it.each([
    ['"maybe"', 'maybe'],
    ['1', 1],
    ['0', 0],
    ['null', null],
    ['"true" as text', 'true'],
    ['"yes"', 'yes'],
    ['false', false],
    ['an object', { yes: true }],
    ['an array', [true]],
  ])('AC-001.17: marketing_consent %s is stored as false with no 422', async (_label, value) => {
    const res = await create(staging.body({ marketing_consent: value }));
    expect(res.status).toBe(201);
    const row = await stored(CreateQuoteRequestResponse.parse(await res.json()).request_id);
    expect(row.marketing_consent).toBe(false);
    expect(row.marketing_consent_at).toBeNull();
  });

  it('AC-001.17: a body with no marketing_consent key at all is stored as false with no 422', async () => {
    const { marketing_consent: _omitted, ...withoutConsent } = staging.body();
    void _omitted;
    const res = await create(withoutConsent);
    expect(res.status).toBe(201);
    expect((await stored(CreateQuoteRequestResponse.parse(await res.json()).request_id)).marketing_consent).toBe(false);
  });

  it('trims the email before validating and storing it', async () => {
    const email = `  be1.trim.${Date.now()}@example.test  `;
    const res = await create(staging.body({ email }));
    expect(res.status).toBe(201);
    expect((await stored(CreateQuoteRequestResponse.parse(await res.json()).request_id)).email).toBe(email.trim());
  });

  it.each([
    ['905-555-0142', '9055550142'],
    ['(905) 555 0142', '9055550142'],
    ['905.555.0142', '9055550142'],
    ['+1 905 555 0142', '9055550142'],
    ['+19055550142', '9055550142'],
  ])('normalises the phone "%s" to 10 digits', async (typed, digits) => {
    const res = await create(staging.body({ phone: typed }));
    expect(res.status).toBe(201);
    expect((await stored(CreateQuoteRequestResponse.parse(await res.json()).request_id)).phone).toBe(digits);
  });

  it('AC-001.5: a name with script text is stored exactly as typed (it is rendered as text, never as HTML)', async () => {
    const name = `Zoë O'Brien <script>alert(1)</script>`;
    const res = await create(staging.body({ name }));
    expect(res.status).toBe(201);
    expect((await stored(CreateQuoteRequestResponse.parse(await res.json()).request_id)).name).toBe(name);
  });

  it('AC-001.7: the same phone sending twice with two page loads makes two requests', async () => {
    const first = CreateQuoteRequestResponse.parse(await (await create(staging.body({ phone: '4165550177' }))).json());
    const second = CreateQuoteRequestResponse.parse(await (await create(staging.body({ phone: '4165550177' }))).json());
    expect(first.request_id).not.toBe(second.request_id);
  });
});

describe('createQuoteRequest: validation is a 422 that names each field', () => {
  it('AC-001.2: empty required fields are each named, and nothing is stored', async () => {
    const res = await create({ name: '', phone: '', email: '', address: '', problem: '', urgency: '' });
    const problem = await expectProblem(res, 422, 'validation_failed');
    expect(problem.errors?.map((e) => e.field).sort()).toEqual(['address', 'email', 'name', 'phone', 'problem', 'urgency']);
    expect(problem.errors?.every((e) => e.message.length > 0)).toBe(true);
  });

  it('AC-001.2: a body with the six required fields missing entirely is a 422 too', async () => {
    const problem = await expectProblem(await create({}), 422, 'validation_failed');
    expect(problem.errors?.map((e) => e.field).sort()).toEqual(['address', 'email', 'name', 'phone', 'problem', 'urgency']);
  });

  it.each([
    ['9 characters', 'a'.repeat(9), 422],
    ['10 characters', 'a'.repeat(10), 201],
    ['2,000 characters', 'a'.repeat(2000), 201],
    ['2,001 characters', 'a'.repeat(2001), 422],
  ])('AC-001.3: a problem of %s is %i', async (_label, problem, status) => {
    const res = await create(staging.body({ problem }));
    expect(res.status).toBe(status);
    if (status === 422) {
      const body = await expectProblem(res, 422, 'validation_failed');
      expect(body.errors).toEqual([{ field: 'problem', message: 'Describe the problem in 10 to 2,000 characters' }]);
    }
  });

  it('AC-001.4: the phone "12345" and the email "dana@" are each refused beside their field, and nothing else is named', async () => {
    const phone = await expectProblem(await create(staging.body({ phone: '12345' })), 422, 'validation_failed');
    expect(phone.errors).toEqual([{ field: 'phone', message: 'Enter a 10-digit phone number' }]);
    const email = await expectProblem(await create(staging.body({ email: 'dana@' })), 422, 'validation_failed');
    expect(email.errors?.map((e) => e.field)).toEqual(['email']);
  });

  it('AC-001.16: a ticked offers box with an empty email is refused on email only (nothing stored)', async () => {
    const body = staging.body({ marketing_consent: true, email: '' });
    const problem = await expectProblem(await create(body), 422, 'validation_failed');
    expect(problem.errors?.map((e) => e.field)).toEqual(['email']);
  });

  it('names a field the contract does not have, instead of storing it (mass assignment)', async () => {
    const problem = await expectProblem(await create(staging.body({ estimated_minutes: 30, status: 'won' })), 422, 'validation_failed');
    expect(problem.errors?.map((e) => e.field).sort()).toEqual(['estimated_minutes', 'status']);
  });

  it.each([
    ['4 photos', [1, 2, 3, 4].map((position) => ({ position, content_type: 'image/jpeg', size_bytes: 1000 })), 'photos'],
    ['positions that do not start at 1', [{ position: 2, content_type: 'image/jpeg', size_bytes: 1000 }], 'photos[1]'],
    ['a repeated position', [1, 1].map((position) => ({ position, content_type: 'image/jpeg', size_bytes: 1000 })), 'photos[2]'],
    ['5,242,881 bytes', [{ position: 1, content_type: 'image/jpeg', size_bytes: 5_242_881 }], 'photos[1]'],
    ['a GIF', [{ position: 1, content_type: 'image/gif', size_bytes: 1000 }], 'photos[1]'],
  ])('AC-002.2 to AC-002.4: a photo plan with %s is a 422 on %s', async (_label, photos, field) => {
    const problem = await expectProblem(await create(staging.body({ photos })), 422, 'validation_failed');
    expect(problem.errors?.map((e) => e.field)).toContain(field);
    expect(problem.errors?.every((e) => e.field === 'photos' || /^photos\[[1-9]\d*\]$/.test(e.field))).toBe(true);
  });

  it('AC-002.3: a planned photo of exactly 5,242,880 bytes is accepted', async () => {
    const res = await create(staging.body({ photos: [{ position: 1, content_type: 'image/webp', size_bytes: 5_242_880 }] }));
    expect(res.status).toBe(201);
  });

  it('a body that is not JSON, or not an object, is a 400 bad_request (with a good token)', async () => {
    await expectProblem(await create(undefined, { rawBody: '{"name": ' }), 400, 'bad_request');
    await expectProblem(await create(undefined, { rawBody: '' }), 400, 'bad_request');
    await expectProblem(await create(['not', 'an', 'object']), 400, 'bad_request');
    await expectProblem(await create('a string'), 400, 'bad_request');
    await expectProblem(await create(null), 400, 'bad_request');
  });

  it('any other method is a 405 problem with an Allow header', async () => {
    const { DELETE } = await import('@/app/api/quote-requests/route');
    const res = await DELETE(jsonRequest('/api/quote-requests', { method: 'DELETE' }), undefined);
    await expectProblem(res, 405, 'method_not_allowed');
    expect(res.headers.get('allow')).toBe('GET, POST');
  });
});

describe('createQuoteRequest: one token, one request (US-001, S0 SEC-2, AC-001.6)', () => {
  it('the same token and the same answers again is a 200 with the same request, never a second one', async () => {
    const token = staging.token();
    const ip = staging.address();
    const body = staging.body({ photos: [{ position: 1, content_type: 'image/png', size_bytes: 500 }] });
    const first = await create(body, { token, ip });
    expect(first.status).toBe(201);
    const a = CreateQuoteRequestResponse.parse(await first.json());
    const second = await create(body, { token, ip });
    expect(second.status).toBe(200);
    const b = CreateQuoteRequestResponse.parse(await second.json());
    expect(b.request_id).toBe(a.request_id);
    expect(b.submission_state).toBe('pending');
    expect(b.photo_uploads).toEqual(a.photo_uploads);
    expect(await countByEmail(body.email as string)).toBe(1);
  });

  it('two taps at the same moment resolve to one request: one 201 and one 200 for the same id', async () => {
    const token = staging.token();
    const ip = staging.address();
    const body = staging.body();
    const [one, two] = await Promise.all([create(body, { token, ip }), create(body, { token, ip })]);
    expect([one.status, two.status].sort()).toEqual([200, 201]);
    const ids = [CreateQuoteRequestResponse.parse(await one.json()).request_id, CreateQuoteRequestResponse.parse(await two.json()).request_id];
    expect(ids[0]).toBe(ids[1]);
    expect(await countByEmail(body.email as string)).toBe(1);
  });

  it('the same token with changed answers updates the pending request (200) and clears its uploaded photos', async () => {
    const token = staging.token();
    const ip = staging.address();
    const plan = [{ position: 1, content_type: 'image/jpeg', size_bytes: 600 }];
    const first = CreateQuoteRequestResponse.parse(await (await create(staging.body({ photos: plan }), { token, ip })).json());
    const upload = await staging.anon().storage.from('quote-photos').upload(`${first.request_id}/photo-1`, jpegBytes(), { contentType: 'image/jpeg', upsert: false });
    expect(upload.error).toBeNull();
    expect((await staging.db().storage.from('quote-photos').list(first.request_id)).data).toHaveLength(1);

    const changed = staging.body({ photos: plan, problem: 'A different description of the leaking tap problem' });
    const res = await create(changed, { token, ip });
    expect(res.status).toBe(200);
    const second = CreateQuoteRequestResponse.parse(await res.json());
    expect(second.request_id).toBe(first.request_id);
    expect(second.submission_state).toBe('pending');
    expect((await stored(first.request_id)).problem).toBe('A different description of the leaking tap problem');
    expect((await staging.db().storage.from('quote-photos').list(first.request_id)).data).toHaveLength(0);
  });
});

describe('createQuoteRequest: the form token and the spam checks', () => {
  it('a missing, tampered or foreign token is a 401 form_token_invalid and stores nothing', async () => {
    const good = staging.token();
    const parts = good.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]!.startsWith('A') ? 'B' : 'A'}${parts[3]!.slice(1)}`;
    for (const token of [null, '', 'garbage', tampered, `${parts[0]}.${Number(parts[1]) - 1}.${parts[2]}.${parts[3]}`]) {
      const body = staging.body();
      await expectProblem(await create(body, { token }), 401, 'form_token_invalid');
      expect(await countByEmail(body.email as string)).toBe(0);
    }
  });

  it('a token older than 24 hours is a 400 form_expired', async () => {
    const body = staging.body();
    await expectProblem(await create(body, { token: staging.token(24 * 60 * 60 * 1000 + 5_000) }), 400, 'form_expired');
    expect(await countByEmail(body.email as string)).toBe(0);
  });

  it('AC-003.3: a token under 3 seconds old is refused, and the same form 4 seconds later is accepted', async () => {
    const ip = staging.address();
    const body = staging.body();
    const refused = await expectProblem(await create(body, { token: staging.token(500), ip }), 400, 'submission_refused');
    expect(refused.title).toBe("We couldn't send your request. Please try again.");
    expect(await countByEmail(body.email as string)).toBe(0);
    expect((await create(body, { token: staging.token(4_000), ip })).status).toBe(201);
  });

  it('AC-003.2: the honeypot gives a refusal byte-identical to the time trap, stores nothing, and never says which check failed', async () => {
    const ip = staging.address();
    const filled = staging.body({ website: 'https://spam.example' });
    const honeypot = await create(filled, { ip });
    const tooFast = await create(staging.body(), { token: staging.token(300), ip });
    expect(honeypot.status).toBe(400);
    expect(tooFast.status).toBe(400);
    const [a, b] = [await honeypot.text(), await tooFast.text()];
    expect(a).toBe(b);
    expect(JSON.parse(a)).toEqual({ type: 'about:blank', title: "We couldn't send your request. Please try again.", status: 400, code: 'submission_refused' });
    expect(honeypot.headers.get('content-type')).toBe(tooFast.headers.get('content-type'));
    expect(await countByEmail(filled.email as string)).toBe(0);
  });

  it('anything but empty in the honeypot is refused (never a 422); an empty or null one is not', async () => {
    for (const website of ['x', ' ', 123, true, { a: 1 }]) {
      await expectProblem(await create(staging.body({ website })), 400, 'submission_refused');
    }
    expect((await create(staging.body({ website: '' }))).status).toBe(201);
    expect((await create(staging.body({ website: null }))).status).toBe(201);
  });

  it('AC-003.7: 30 honeypot refusals from one address in a window make exactly one event with count 30 and no address in it', async () => {
    const ip = staging.address();
    const results = await Promise.all(Array.from({ length: 30 }, () => create(staging.body({ website: 'bot' }), { ip })));
    expect(results.every((r) => r.status === 400)).toBe(true);

    const hash = addressHash(ip);
    const windows = await staging.db().from('spam_refusal_windows').select('reason, refusals, event_id').eq('ip_hash', hash);
    expect(windows.data).toHaveLength(1);
    expect(windows.data![0]).toMatchObject({ reason: 'honeypot', refusals: 30 });
    const event = await staging.db().from('events').select('name, request_id, user_id, properties').eq('id', windows.data![0]!.event_id).single();
    expect(event.data).toMatchObject({ name: 'spam_submission_blocked', request_id: null, user_id: null, properties: { reason: 'honeypot', count: 30 } });
    expect(Object.keys(event.data!.properties as object).sort()).toEqual(['count', 'reason']);
    const text = JSON.stringify(event.data);
    expect(text).not.toContain(ip);
    expect(text).not.toContain(hash);
  });

  it('a time-trap refusal and a honeypot refusal from one address are two events, one per reason', async () => {
    const ip = staging.address();
    await create(staging.body(), { token: staging.token(200), ip });
    await create(staging.body(), { token: staging.token(200), ip });
    await create(staging.body({ website: 'bot' }), { ip });
    const windows = await staging.db().from('spam_refusal_windows').select('reason, refusals').eq('ip_hash', addressHash(ip));
    expect([...(windows.data ?? [])].sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([
      { reason: 'honeypot', refusals: 1 },
      { reason: 'too_fast', refusals: 2 },
    ]);
  });
});

describe('createQuoteRequest: a missing or short signing secret fails closed (invariant 15, S0 SEC-4)', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['31 characters', 'x'.repeat(31)],
  ])('APP_SIGNING_SECRET %s gives 503 service_unavailable and stores nothing', async (_label, value) => {
    const token = staging.token(); // issued while the secret is still good
    const body = staging.body();
    vi.stubEnv('APP_SIGNING_SECRET', value);
    try {
      const problem = await expectProblem(await create(body, { token }), 503, 'service_unavailable');
      expect(JSON.stringify(problem)).not.toContain('APP_SIGNING_SECRET');
    } finally {
      vi.stubEnv('APP_SIGNING_SECRET', staging.secrets.signing);
    }
    expect(await countByEmail(body.email as string)).toBe(0);
  });
});

describe('createQuoteRequest: a refused submission leaks nothing (S0 SEC-5, SECURITY_MODEL invariant 11)', () => {
  // The table's check constraints and the contract's validation agree (zod counts characters the way Postgres does), so a real
  // 23514 cannot be provoked through the contract. The forced 23514 (an injected PostgREST error that carries the failing row)
  // is tests/api/submission/create-failures.test.ts. Here: the real refusal paths write neither answers nor personal data anywhere.
  it('a 422 response and its log line hold none of the submitted name, phone, email or address', async () => {
    const personal = { name: 'Quillfeather Zora', phone: '416-555-0188', email: 'zora.quillfeather@example.test', address: '77 Marigold Crescent, Hamilton' };
    const body = staging.body({ ...personal, problem: '😀😀😀😀😀' }); // 5 characters: refused as too short
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await create(body);
    });
    const text = await (res as Response).clone().text();
    const problem = await expectProblem(res as Response, 422, 'validation_failed');
    expect(problem.errors).toEqual([{ field: 'problem', message: 'Describe the problem in 10 to 2,000 characters' }]);
    for (const value of ['Quillfeather', 'Zora', '4165550188', '416-555-0188', personal.email, 'Marigold', '😀']) {
      expect(text).not.toContain(value);
      expect(output).not.toContain(value);
    }
    const logged = output.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 'warn', route: 'POST /api/quote-requests', status: 422, outcome: 'validation_failed' });
    expect(await countByEmail(personal.email)).toBe(0);
  });

  it('a NUL character, which Postgres text cannot hold, is a 422 on its field and never reaches the database as a 500', async () => {
    for (const field of ['name', 'address', 'problem']) {
      const value = field === 'name' ? 'Dana\u0000 Whitfield' : `${field} text with a NUL \u0000 inside it`;
      const problem = await expectProblem(await create(staging.body({ [field]: value })), 422, 'validation_failed');
      expect(problem.errors?.map((e) => e.field)).toEqual([field]);
    }
    const email = await expectProblem(await create(staging.body({ email: 'dana\u0000@example.test' })), 422, 'validation_failed');
    expect(email.errors?.map((e) => e.field)).toEqual(['email']);
  });

  it('every response and log line names a request id, and the id in the header is the one in the log', async () => {
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await createPost(jsonRequest('/api/quote-requests', { headers: { 'x-form-token': staging.token(), 'x-vercel-id': 'iad1::abc-123' }, rawBody: 'not json' }), undefined);
    });
    expect((res as Response).headers.get('x-request-id')).toBe('iad1::abc-123');
    expect(JSON.parse(output.split('\n').filter(Boolean)[0]!)).toMatchObject({ request_id: 'iad1::abc-123', status: 400 });
  });
});
