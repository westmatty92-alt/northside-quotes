// @vitest-environment node
// The submission rate limit: 5 accepted submissions per network address per 10 minutes, counted and recorded atomically
// (AC-003.4, AC-003.5, AC-003.7; SECURITY_MODEL invariant 16, "Network address"). Against the STAGING Supabase project.
// Each test uses its own random address, so runs never collide; every row is tracked and deleted in afterAll.
import { describe, expect, it } from 'vitest';
import { POST as createPost } from '@/app/api/quote-requests/route';
import { addressHash } from '@/lib/server/services/network';
import { expectProblem, jsonRequest } from '../../helpers/api';
import { setupStaging } from '../../helpers/staging';

const staging = setupStaging();

async function create(body: unknown, ip: string | null, token = staging.token()): Promise<Response> {
  const headers: Record<string, string> = { 'x-form-token': token };
  if (ip !== null) headers['x-real-ip'] = ip;
  const res = await createPost(jsonRequest('/api/quote-requests', { headers, body }), undefined);
  if (res.ok) staging.trackRequest(((await res.clone().json()) as { request_id: string }).request_id);
  return res;
}

async function counters(ip: string) {
  const hash = addressHash(ip);
  const hits = await staging.db().from('rate_limit_hits').select('id').eq('ip_hash', hash);
  const windows = await staging.db().from('spam_refusal_windows').select('reason, refusals, event_id').eq('ip_hash', hash);
  expect(hits.error).toBeNull();
  expect(windows.error).toBeNull();
  return { hits: hits.data ?? [], windows: windows.data ?? [] };
}

describe('AC-003.4: 5 accepted per address in 10 minutes, the 6th is refused', () => {
  it('accepts the first 5 and refuses the 6th with 429, Retry-After and the contract body; the refusal is one capped event', async () => {
    const ip = staging.address();
    for (let i = 0; i < 5; i += 1) expect((await create(staging.body(), ip)).status).toBe(201);

    const sixth = await create(staging.body(), ip);
    const problem = await expectProblem(sixth, 429, 'rate_limited');
    expect(problem.title).toBe('Too many requests. Please try again in a few minutes.');
    const retryAfter = Number(sixth.headers.get('retry-after'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(600);

    const { hits, windows } = await counters(ip);
    expect(hits).toHaveLength(5);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ reason: 'rate_limited', refusals: 1 });
  });

  it('a replay of an accepted token takes no slot, so it still works with the address at its limit', async () => {
    const ip = staging.address();
    const first = staging.token();
    const body = staging.body();
    expect((await create(body, ip, first)).status).toBe(201);
    for (let i = 0; i < 4; i += 1) expect((await create(staging.body(), ip)).status).toBe(201);
    expect((await create(staging.body(), ip)).status).toBe(429); // the address is full
    const replay = await create(body, ip, first);
    expect(replay.status).toBe(200);
    expect((await counters(ip)).hits).toHaveLength(5);
  });

  it('another address is not affected by a full one', async () => {
    const full = staging.address();
    for (let i = 0; i < 5; i += 1) await create(staging.body(), full);
    expect((await create(staging.body(), full)).status).toBe(429);
    expect((await create(staging.body(), staging.address())).status).toBe(201);
  });

  it('S0 SEC-3: 20 parallel creates from one address accept exactly 5, refuse 15, and record 5 hits and one event with count 15', async () => {
    const ip = staging.address();
    const results = await Promise.all(Array.from({ length: 20 }, () => create(staging.body(), ip)));
    const accepted = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status === 429);
    expect(accepted).toHaveLength(5);
    expect(refused).toHaveLength(15);
    expect(results).toHaveLength(accepted.length + refused.length);
    for (const res of refused) expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);

    const { hits, windows } = await counters(ip);
    expect(hits).toHaveLength(5);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ reason: 'rate_limited', refusals: 15 });
    const event = await staging.db().from('events').select('properties').eq('id', windows[0]!.event_id).single();
    expect(event.data?.properties).toEqual({ reason: 'rate_limited', count: 15 });
  });

  it('an IPv6 address counts by its /64: five addresses in one /64 fill it, a sixth in the same /64 is refused, another /64 is not', async () => {
    const prefix = `2001:db8:${(Math.floor(Math.random() * 0xffff) + 1).toString(16)}:${(Math.floor(Math.random() * 0xffff) + 1).toString(16)}`;
    const other = `2001:db8:${(Math.floor(Math.random() * 0xffff) + 1).toString(16)}:${(Math.floor(Math.random() * 0xffff) + 1).toString(16)}`;
    staging.trackAddress(`${prefix}::1`);
    staging.trackAddress(`${other}::1`);
    for (let i = 1; i <= 5; i += 1) expect((await create(staging.body(), `${prefix}::${i}`)).status).toBe(201);
    expect((await create(staging.body(), `${prefix}:abcd:1:2:3`)).status).toBe(429);
    expect((await create(staging.body(), `${other}::9`)).status).toBe(201);
  });
});

describe('AC-003.5: a counter that cannot be used never blocks a homeowner', () => {
  it('with no network address at all, every valid submission is accepted (no slot is taken, nothing is counted)', async () => {
    const results = [];
    for (let i = 0; i < 7; i += 1) results.push((await create(staging.body(), null)).status);
    expect(results).toEqual([201, 201, 201, 201, 201, 201, 201]);
  });

  it('the honeypot and the 3-second checks still apply when there is no address', async () => {
    await expectProblem(await create(staging.body({ website: 'bot' }), null), 400, 'submission_refused');
    await expectProblem(await create(staging.body(), null, staging.token(100)), 400, 'submission_refused');
    // their events share the one "unknown address" window per reason; remove them with this file's other rows
    staging.trackAddress('not an address');
  });

  it('the database call itself accepts a request whose address hash cannot be counted (the counter errors inside start_quote_request)', async () => {
    // A malformed hash makes the rate-limit insert fail its check constraint inside the function; the request is still created.
    const { data, error } = await staging.db().rpc('start_quote_request', {
      p_submission_key: crypto.randomUUID(),
      p_name: 'Rehearsal Tester',
      p_phone: '4165550123',
      p_email: 'be1.counter@example.test',
      p_address: '14 Test Street, Hamilton ON',
      p_problem: 'The test tap drips constantly under the sink',
      p_urgency: 'soon',
      p_photo_count: 0,
      p_ip_hash: 'not-a-hash',
      p_marketing_consent: false,
    });
    expect(error).toBeNull();
    const outcome = data as { outcome: string; request_id: string };
    expect(outcome.outcome).toBe('created');
    staging.trackRequest(outcome.request_id);
  });
});
