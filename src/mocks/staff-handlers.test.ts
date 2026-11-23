// @vitest-environment jsdom
// The staff mock API answers the way docs/openapi.yaml says: every success body passes the generated Zod schema, the
// problem statuses and codes are the contract's, `mock-1` and `mock-2` open the seeded requests, and each scenario makes
// its state reachable.
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ChangeQuoteRequestStatusResponse,
  GetQuoteRequestResponse,
  ListQuoteRequestPhotosResponse,
  ListQuoteRequestsResponse,
  SaveQuoteResponse,
} from '@/lib/api/generated/inbox/inbox.zod';
import { GetCurrentStaffResponse, SignInResponse } from '@/lib/api/generated/staff-auth/staff-auth.zod';
import { GetCurrentWeeklyCountResponse } from '@/lib/api/generated/weekly-count/weekly-count.zod';
import { RetryGhlCopyResponse } from '@/lib/api/generated/go-high-level/go-high-level.zod';
import { readScenario, SCENARIOS } from '@/mocks/scenarios';
import { signInPreviewFor } from '@/mocks/previews';
import { buildStaffHandlers } from '@/mocks/staff-handlers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const O = 'http://localhost';
const use = (scenario: Parameters<typeof buildStaffHandlers>[0]) => server.use(...buildStaffHandlers(scenario));
const send = (method: string, path: string, body?: unknown) =>
  fetch(`${O}${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('scenarios', () => {
  it('names the staff scenarios and falls back to ok', () => {
    for (const name of ['signed-in', 'empty', 'error', 'session-ended', 'slow', 'stale', 'save-failed', 'paused', 'unavailable']) {
      expect(SCENARIOS).toContain(name);
      expect(readScenario(`?mockScenario=${name}`)).toBe(name);
    }
    expect(readScenario('?mockScenario=signed-out')).toBe('ok');
  });

  it('the sign-in scenarios press "Sign in" once on load; the others leave the form blank', () => {
    expect(signInPreviewFor('error')).toMatchObject({ autoSubmit: true });
    expect(signInPreviewFor('paused')).toMatchObject({ autoSubmit: true });
    expect(signInPreviewFor('unavailable')).toMatchObject({ autoSubmit: true });
    expect(signInPreviewFor('ok')).toBeUndefined();
    expect(signInPreviewFor('signed-in')).toBeUndefined();
  });
});

describe('staff mock API (contract bodies)', () => {
  it('lists eight requests newest first, with a body that passes the contract', async () => {
    use('signed-in');
    const page = ListQuoteRequestsResponse.parse(await (await send('GET', '/api/quote-requests')).json());
    expect(page.data).toHaveLength(8);
    expect(page.next_cursor).toBeNull();
    const times = page.data.map((row) => row.submitted_at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('filters by status, searches by reference, partial name and phone digits, and pages by cursor', async () => {
    use('signed-in');
    const get = async (query: string) => ListQuoteRequestsResponse.parse(await (await send('GET', `/api/quote-requests?${query}`)).json());
    expect((await get('status=quoted')).data.map((row) => row.name)).toEqual(['Priya Raman', 'Tomasz Kowalski']);
    expect((await get('q=nq-4hx')).data.map((row) => row.name)).toEqual(['Marcus Oyelaran']);
    expect((await get('q=whit')).data.map((row) => row.name)).toEqual(['Dana Whitfield']);
    expect((await get('q=(905)%20555-0178')).data.map((row) => row.name)).toEqual(['Marcus Oyelaran']);
    const first = await get('limit=3');
    expect(first.data).toHaveLength(3);
    expect(first.next_cursor).not.toBeNull();
    const second = await get(`limit=3&cursor=${first.next_cursor}`);
    expect(second.data.map((row) => row.id)).not.toContain(first.data[0]?.id);
  });

  it('mock-1 is ticked with three photos and mock-2 is not ticked; both bodies pass the contract', async () => {
    use('signed-in');
    const one = GetQuoteRequestResponse.parse(await (await send('GET', '/api/quote-requests/mock-1')).json());
    expect(one).toMatchObject({ reference: 'NQ-7K3M9P', marketing_consent: true, photo_count: 3 });
    expect(one.photos).toHaveLength(3);
    expect(one.ghl.copy.state).toBe('copied');
    expect(one.ghl.stage_tag).not.toBeNull();
    const two = GetQuoteRequestResponse.parse(await (await send('GET', '/api/quote-requests/mock-2')).json());
    expect(two).toMatchObject({ reference: 'NQ-4HX2RB', marketing_consent: false, marketing_consent_at: null });
    expect(two.ghl).toEqual({ copy: { state: 'not_copied_no_consent', at: null }, stage_tag: null });
  });

  it('an unknown id is a 404 problem+json', async () => {
    use('signed-in');
    const response = await send('GET', '/api/quote-requests/mock-9');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'not_found' });
  });

  it('photos come with 900-second URLs', async () => {
    use('signed-in');
    const list = ListQuoteRequestPhotosResponse.parse(await (await send('GET', '/api/quote-requests/mock-1/photos')).json());
    expect(list.data).toHaveLength(3);
    const seconds = (Date.parse(list.data[0]?.expires_at ?? '') - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(890);
    expect(seconds).toBeLessThanOrEqual(900);
  });

  it('saves a price and note with the right version, bumps the version, and refuses a stale one with 409 stale_version', async () => {
    use('signed-in');
    const saved = SaveQuoteResponse.parse(await (await send('PUT', '/api/quote-requests/mock-1/quote', { price_cents: 45000, note: 'Thursday', version: 1 })).json());
    expect(saved).toMatchObject({ price_cents: 45000, note: 'Thursday', version: 2, status: 'new' });
    expect(saved.last_updated).toMatchObject({ by_display_name: 'Owner' });
    const stale = await send('PUT', '/api/quote-requests/mock-1/quote', { price_cents: 50000, note: null, version: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'stale_version' });
    const bad = await send('PUT', '/api/quote-requests/mock-1/quote', { price_cents: 10_000_000, note: null, version: 2 });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: 'validation_failed', errors: [expect.objectContaining({ field: 'price_cents' })] });
  });

  it('changes a status (201), says "no change" for the same one (200), and moves the weekly Won and Lost', async () => {
    use('signed-in');
    const week = async () => GetCurrentWeeklyCountResponse.parse(await (await send('GET', '/api/weekly-counts/current')).json());
    expect(await week()).toMatchObject({ requests: 4, won: 1, lost: 1, time_zone: 'America/Toronto' });
    const changed = await send('POST', '/api/quote-requests/mock-1/status-changes', { to_status: 'won', version: 1 });
    expect(changed.status).toBe(201);
    expect(ChangeQuoteRequestStatusResponse.parse(await changed.json())).toMatchObject({ changed: true, status: 'won', version: 2 });
    expect(await week()).toMatchObject({ won: 2, lost: 1 });
    const same = await send('POST', '/api/quote-requests/mock-1/status-changes', { to_status: 'won', version: 2 });
    expect(same.status).toBe(200);
    expect(ChangeQuoteRequestStatusResponse.parse(await same.json())).toMatchObject({ changed: false, version: 2 });
    await send('POST', '/api/quote-requests/mock-1/status-changes', { to_status: 'lost', version: 2 });
    expect(await week()).toMatchObject({ won: 1, lost: 2 }); // Won to Lost: Won drops, Lost rises
    const detail = GetQuoteRequestResponse.parse(await (await send('GET', '/api/quote-requests/mock-1')).json());
    expect(detail.ghl.stage_tag).toMatchObject({ state: 'waiting' }); // a ticked request gets a new stage tag push
  });

  it('a status change on a request that was not ticked leaves it with no stage tag', async () => {
    use('signed-in');
    await send('POST', '/api/quote-requests/mock-2/status-changes', { to_status: 'quoted', version: 1 });
    const detail = GetQuoteRequestResponse.parse(await (await send('GET', '/api/quote-requests/mock-2')).json());
    expect(detail.ghl.stage_tag).toBeNull();
    expect(detail.ghl.copy.state).toBe('not_copied_no_consent');
  });

  it('retries a failed copy; a copy that is not failed, or a request that was not ticked, is 409 not_retryable', async () => {
    use('signed-in');
    const retried = RetryGhlCopyResponse.parse(await (await send('POST', '/api/quote-requests/a0000000-0000-4000-8000-000000000003/ghl-copy-retries')).json());
    expect(retried).toMatchObject({ retried: true, copy: { state: 'copied' } });
    for (const id of ['mock-1', 'mock-2']) {
      const refused = await send('POST', `/api/quote-requests/${id}/ghl-copy-retries`);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: 'not_retryable' });
    }
  });

  it('staff/me and sign-in answer with the staff member', async () => {
    use('signed-in');
    expect(GetCurrentStaffResponse.parse(await (await send('GET', '/api/staff/me')).json())).toMatchObject({ display_name: 'Owner' });
    const ok = await send('POST', '/api/auth/sign-in', { email: 'owner@example.com', password: 'whatever' });
    expect(ok.status).toBe(200);
    expect(SignInResponse.parse(await ok.json())).toMatchObject({ display_name: 'Owner' });
    const wrong = await send('POST', '/api/auth/sign-in', { email: 'owner@example.com', password: 'wrong' });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ code: 'invalid_credentials' });
  });
});

describe('scenario states', () => {
  it('empty: no requests and a count of 0, 0, 0', async () => {
    use('empty');
    expect(await (await send('GET', '/api/quote-requests')).json()).toEqual({ data: [], next_cursor: null });
    expect(await (await send('GET', '/api/weekly-counts/current')).json()).toMatchObject({ requests: 0, won: 0, lost: 0 });
  });

  it('error: the list, the count, a request and its photos answer 500; a wrong sign-in answers 401', async () => {
    use('error');
    for (const path of ['/api/quote-requests', '/api/weekly-counts/current', '/api/quote-requests/mock-1', '/api/quote-requests/mock-1/photos']) {
      const response = await send('GET', path);
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: 'internal_error' });
    }
    expect((await send('POST', '/api/auth/sign-in', { email: 'owner@example.com', password: 'x' })).status).toBe(401);
  });

  it('session-ended: every staff call is 401 session_expired', async () => {
    use('session-ended');
    for (const path of ['/api/quote-requests', '/api/staff/me', '/api/weekly-counts/current']) {
      const response = await send('GET', path);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'session_expired' });
    }
  });

  it('stale and save-failed refuse the write only', async () => {
    use('stale');
    expect((await send('PUT', '/api/quote-requests/mock-1/quote', { price_cents: 1, note: null, version: 1 })).status).toBe(409);
    expect((await send('POST', '/api/quote-requests/mock-1/status-changes', { to_status: 'won', version: 1 })).status).toBe(409);
    expect((await send('GET', '/api/quote-requests/mock-1')).status).toBe(200);
    server.resetHandlers();
    use('save-failed');
    expect((await send('PUT', '/api/quote-requests/mock-1/quote', { price_cents: 1, note: null, version: 1 })).status).toBe(500);
    expect((await send('GET', '/api/quote-requests/mock-1')).status).toBe(200);
  });

  it('paused and unavailable refuse sign-in with the contract\'s codes (no Retry-After)', async () => {
    use('paused');
    const paused = await send('POST', '/api/auth/sign-in', { email: 'owner@example.com', password: 'x' });
    expect(paused.status).toBe(429);
    expect(paused.headers.get('Retry-After')).toBeNull();
    expect(await paused.json()).toMatchObject({ code: 'sign_in_paused' });
    server.resetHandlers();
    use('unavailable');
    const unavailable = await send('POST', '/api/auth/sign-in', { email: 'owner@example.com', password: 'x' });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: 'sign_in_unavailable' });
  });
});
