// @vitest-environment node
// BUG-QA2-2 (QA probe PRB-74b): a text field holding an unpaired UTF-16 surrogate is a 422 that names the field, never a 500.
//
// Root cause, shown by the "reaches the database" case below: JSON.parse accepts "\ud800" and returns a string that is not
// well-formed Unicode; zod accepts it; supabase-js sends it as the JSON escape "\ud800"; PostgREST cannot decode a lone
// surrogate and refuses the whole call with PGRST102 ("Empty or invalid json") before Postgres sees it; the service had no
// mapping for that code, so it became a 500. The fix refuses the text in the service, before the database call.
//
// Runs against the STAGING Supabase project, in-process. Every row is tracked and deleted in afterAll (tests/helpers/staging.ts).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { POST as createPost } from '@/app/api/quote-requests/route';
import { POST as submitPost } from '@/app/api/quote-requests/[request_id]/submission/route';
import { CreateQuoteRequestResponse } from '@/lib/api/generated/public-form/public-form.zod';
import { captureOutput, expectProblem, jsonRequest } from '../../helpers/api';
import { setupStaging } from '../../helpers/staging';

const staging = setupStaging();

const SURROGATE_PLACEHOLDER = '@@SURROGATE@@';

/** The unpaired surrogates QA sent, and the other shapes of the same fault. Each is the six-character JSON escape, as in the probe. */
const BAD_ESCAPES = [
  ['a lone high surrogate', '\\ud800'],
  ['a lone low surrogate', '\\udc00'],
  ['a high surrogate then an ordinary character', '\\ud83d,'],
  ['a low surrogate then a high one (reversed pair)', '\\udc00\\ud800'],
  ['a high surrogate at the very end', '\\ud83d'],
] as const;

type Sent = { res: Response; stored: () => Promise<number> };

/** A valid value for each text field with the placeholder where the bad character goes (the rest of the value stays valid). */
const FIELD_VALUES: Record<string, string> = {
  name: `Zo${SURROGATE_PLACEHOLDER}e Probe`,
  address: `14 Barton St W ${SURROGATE_PLACEHOLDER}, Hamilton ON`,
  problem: `The tap drips ${SURROGATE_PLACEHOLDER} and the cabinet is wet`,
  email: `dana${SURROGATE_PLACEHOLDER}@example.test`,
  phone: `905-555${SURROGATE_PLACEHOLDER}0142`,
};

/**
 * POST the exact JSON text a client would send: the field's value carries the escape typed out, like QA's curl. `stored()`
 * counts the rows this call would have made: by its unique email, or by a unique name when the email is the bad field (the
 * bad email itself cannot be put in a query).
 */
async function createRaw(field: string, escape: string, options: { token?: string; ip?: string; keep?: Record<string, unknown> } = {}): Promise<Sent> {
  const name = `Probe ${randomUUID()}`;
  const body = staging.body({ name, ...options.keep, [field]: FIELD_VALUES[field] ?? `${SURROGATE_PLACEHOLDER} text long enough for any field` });
  const text = JSON.stringify(body).replace(SURROGATE_PLACEHOLDER, escape);
  const res = await createPost(
    jsonRequest('/api/quote-requests', { headers: { 'x-form-token': options.token ?? staging.token(), 'x-real-ip': options.ip ?? staging.address() }, rawBody: text }),
    undefined,
  );
  if (res.ok) staging.trackRequest(((await res.clone().json()) as { request_id: string }).request_id);
  return { res, stored: () => (field === 'email' ? countWhere('name', name) : countWhere('email', String(body.email))) };
}

async function create(body: unknown, options: { token?: string; ip?: string } = {}): Promise<Response> {
  const res = await createPost(
    jsonRequest('/api/quote-requests', { headers: { 'x-form-token': options.token ?? staging.token(), 'x-real-ip': options.ip ?? staging.address() }, body }),
    undefined,
  );
  if (res.ok) staging.trackRequest(((await res.clone().json()) as { request_id: string }).request_id);
  return res;
}

async function countWhere(column: 'email' | 'name', value: string): Promise<number> {
  const { data, error } = await staging.db().from('quote_requests').select('id').eq(column, value);
  expect(error).toBeNull();
  return (data ?? []).length;
}

const countByEmail = (email: string) => countWhere('email', email);

describe('BUG-QA2-2: why it was a 500', () => {
  it('reaches the database only if the service lets it: PostgREST refuses a lone surrogate with PGRST102', async () => {
    const lone = JSON.parse('"Zo\\ud800e"') as string;
    expect(lone.isWellFormed()).toBe(false); // JSON.parse and zod both accept it
    const key = `surrogate-diagnosis-${Date.now()}`;
    const { data, error } = await staging.db().rpc('start_quote_request', {
      p_submission_key: key,
      p_name: lone,
      p_phone: '4165550123',
      p_email: 'surrogate.diagnosis@example.test',
      p_address: '14 Test Street, Hamilton ON',
      p_problem: 'The test tap drips constantly under the sink',
      p_urgency: 'soon',
      p_photo_count: 0,
      p_ip_hash: key,
      p_marketing_consent: false,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe('PGRST102');
  });
});

describe('BUG-QA2-2: createQuoteRequest refuses an unpaired surrogate as a 422 naming the field', () => {
  for (const field of Object.keys(FIELD_VALUES)) {
    it.each(BAD_ESCAPES)(`${field}: %s is a 422 on ${field} only, and nothing is stored`, async (_label, escape) => {
      const sent = await createRaw(field, escape);
      const problem = await expectProblem(sent.res, 422, 'validation_failed');
      expect(problem.errors?.map((e) => e.field)).toEqual([field]);
      expect(problem.errors?.[0]?.message.length).toBeGreaterThan(0);
      expect(await sent.stored()).toBe(0);
    });
  }

  it('every bad field is named, and only those', async () => {
    const body = staging.body();
    const text = JSON.stringify({ ...body, name: `a${SURROGATE_PLACEHOLDER}b`, address: `${SURROGATE_PLACEHOLDER} 14 Main St`, problem: `Leak ${SURROGATE_PLACEHOLDER} under the sink` })
      .split(SURROGATE_PLACEHOLDER)
      .join('\\udc00');
    const res = await createPost(
      jsonRequest('/api/quote-requests', { headers: { 'x-form-token': staging.token(), 'x-real-ip': staging.address() }, rawBody: text }),
      undefined,
    );
    const problem = await expectProblem(res, 422, 'validation_failed');
    expect(problem.errors?.map((e) => e.field).sort()).toEqual(['address', 'name', 'problem']);
    expect(await countByEmail(String(body.email))).toBe(0);
  });

  it('a surrogate and another problem on one field name that field once', async () => {
    const body = staging.body();
    const text = JSON.stringify({ ...body, name: SURROGATE_PLACEHOLDER }).replace(SURROGATE_PLACEHOLDER, '\\ud800'); // one character: also too short
    const res = await createPost(
      jsonRequest('/api/quote-requests', { headers: { 'x-form-token': staging.token(), 'x-real-ip': staging.address() }, rawBody: text }),
      undefined,
    );
    const problem = await expectProblem(res, 422, 'validation_failed');
    expect(problem.errors).toEqual([{ field: 'name', message: 'Enter your name (2 to 100 characters)' }]);
  });

  it('the 422 and its log line hold none of the submitted text', async () => {
    let sent: Sent | undefined;
    const output = await captureOutput(async () => {
      sent = await createRaw('name', 'Quillfeather \\ud800 Zora');
    });
    const text = await sent!.res.clone().text();
    await expectProblem(sent!.res, 422, 'validation_failed');
    for (const value of ['Quillfeather', 'Zora', 'ud800', '�']) {
      expect(text).not.toContain(value);
      expect(output).not.toContain(value);
    }
    expect(output.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)).toEqual([
      expect.objectContaining({ level: 'warn', status: 422, outcome: 'validation_failed' }),
    ]);
  });

  it('a name that holds a valid surrogate pair (an emoji) is still accepted and stored exactly as typed', async () => {
    const name = 'Zoë 😀 O’Brien';
    const problemText = 'Tap drips 💧 constantly and the cabinet is wet';
    const res = await create(staging.body({ name, problem: problemText }));
    expect(res.status).toBe(201);
    const { request_id } = CreateQuoteRequestResponse.parse(await res.json());
    const { data, error } = await staging.db().from('quote_requests').select('name, problem').eq('id', request_id).single();
    expect(error).toBeNull();
    expect(data).toEqual({ name, problem: problemText });
  });

  it('the fields that are not free text are refused too, never a 500: urgency, a photo type, an unknown field, an unknown field value', async () => {
    const lone = '\ud800';
    const urgency = await expectProblem(await create(staging.body({ urgency: `so${lone}on` })), 422, 'validation_failed');
    expect(urgency.errors?.map((e) => e.field)).toEqual(['urgency']);
    const photo = await expectProblem(
      await create(staging.body({ photos: [{ position: 1, content_type: `image/jp${lone}eg`, size_bytes: 1000 }] })),
      422,
      'validation_failed',
    );
    expect(photo.errors?.map((e) => e.field)).toEqual(['photos[1]']);
    const unknownKey = await expectProblem(await create(staging.body({ [`extra${lone}`]: 'x' })), 422, 'validation_failed');
    expect(unknownKey.errors).toHaveLength(1);
    expect(JSON.stringify(unknownKey)).not.toContain(lone);
    const unknownValue = await expectProblem(await create(staging.body({ extra: lone })), 422, 'validation_failed');
    expect(unknownValue.errors?.map((e) => e.field)).toEqual(['extra']);
  });

  it('the honeypot holding a surrogate is the generic refusal, as for any filled honeypot', async () => {
    await expectProblem(await create(staging.body({ website: 'spam\ud800' })), 400, 'submission_refused');
  });
});

describe('BUG-QA2-2: the update path (same token, changed answers) refuses it too and keeps the stored request', () => {
  it.each(['name', 'address', 'problem'])('%s with a lone surrogate on the second call is a 422 and the pending request is unchanged', async (field) => {
    const token = staging.token();
    const ip = staging.address();
    const body = staging.body();
    const first = await create(body, { token, ip });
    expect(first.status).toBe(201);
    const { request_id } = CreateQuoteRequestResponse.parse(await first.json());

    const sent = await createRaw(field, '\\ud800', { token, ip, keep: { name: body.name, email: body.email, phone: body.phone } });
    const problem = await expectProblem(sent.res, 422, 'validation_failed');
    expect(problem.errors?.map((e) => e.field)).toEqual([field]);

    const { data, error } = await staging.db().from('quote_requests').select('name, address, problem, state').eq('id', request_id).single();
    expect(error).toBeNull();
    expect(data).toEqual({ name: body.name, address: body.address, problem: body.problem, state: 'pending' });
  });
});

describe('BUG-QA2-2: submitQuoteRequest has no free text; its one string, the request id, is never a 500', () => {
  it('a request id holding a lone surrogate is a 404', async () => {
    const id = `3f2b8c1e-0000-4000-8000-00000000000\ud800`;
    const res = await submitPost(
      jsonRequest('/api/quote-requests/x/submission', { headers: { 'x-form-token': staging.token(), 'x-real-ip': staging.address() } }),
      { params: Promise.resolve({ request_id: id }) },
    );
    await expectProblem(res, 404, 'not_found');
  });
});
