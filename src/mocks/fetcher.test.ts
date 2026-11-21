// The Orval mutator (src/lib/api/fetcher.ts): headers pass through, 2xx resolve as { data, status, headers },
// every non-2xx throws ApiProblem. Lives beside the mocks because it runs against the msw server.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiNetworkError, ApiProblem, apiFetch, isApiProblem, toProblem } from '@/lib/api/fetcher';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ORIGIN = 'http://localhost';

describe('apiFetch', () => {
  it('passes the caller headers through (the form token), whatever shape they come in', async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.post(`${ORIGIN}/api/x`, ({ request }) => {
        seen.push(request.headers.get('X-Form-Token'), request.headers.get('Content-Type'), request.headers.get('Accept'));
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    await apiFetch(`${ORIGIN}/api/x`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Form-Token': 'tok' } });
    await apiFetch(`${ORIGIN}/api/x`, { method: 'POST', headers: new Headers({ 'X-Form-Token': 'tok2' }) });
    await apiFetch(`${ORIGIN}/api/x`, { method: 'POST', headers: [['X-Form-Token', 'tok3']] });
    expect(seen.filter((_, index) => index % 3 === 0)).toEqual(['tok', 'tok2', 'tok3']);
    expect(seen[1]).toBe('application/json');
    expect(seen[2]).toContain('application/json');
  });

  it('resolves { data, status, headers } for a 2xx', async () => {
    server.use(http.get(`${ORIGIN}/api/x`, () => HttpResponse.json({ a: 1 }, { status: 200, headers: { 'X-Thing': 'y' } })));
    const result = await apiFetch<{ data: unknown; status: number; headers: Headers }>(`${ORIGIN}/api/x`);
    expect(result.data).toEqual({ a: 1 });
    expect(result.status).toBe(200);
    expect(result.headers.get('X-Thing')).toBe('y');
  });

  it('resolves null data for a 204', async () => {
    server.use(http.delete(`${ORIGIN}/api/x`, () => new HttpResponse(null, { status: 204 })));
    const result = await apiFetch<{ data: unknown; status: number }>(`${ORIGIN}/api/x`, { method: 'DELETE' });
    expect(result).toMatchObject({ data: null, status: 204 });
  });

  it.each([400, 401, 404, 409, 422, 429, 500, 503])('throws ApiProblem for a %s problem+json, with the parsed body and code', async (status) => {
    const body = { type: 'about:blank', title: 'Nope', status, code: 'internal_error', errors: [{ field: 'phone', message: 'bad' }] };
    server.use(
      http.post(`${ORIGIN}/api/x`, () =>
        HttpResponse.json(body, { status, headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '300' } }),
      ),
    );
    const error = await apiFetch(`${ORIGIN}/api/x`, { method: 'POST' }).catch((e: unknown) => e);
    expect(isApiProblem(error)).toBe(true);
    expect(error).toBeInstanceOf(ApiProblem);
    if (!(error instanceof ApiProblem)) return;
    expect(error.status).toBe(status);
    expect(error.code).toBe('internal_error');
    expect(error.message).toBe('Nope');
    expect(error.problem?.errors).toEqual([{ field: 'phone', message: 'bad' }]);
    expect(error.headers.get('Retry-After')).toBe('300');
    expect(error.body).toEqual(body);
  });

  it('throws ApiProblem for a 5xx that is not problem+json, and keeps the raw body', async () => {
    server.use(
      http.get(`${ORIGIN}/api/x`, () => new HttpResponse('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })),
    );
    const error = await apiFetch(`${ORIGIN}/api/x`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblem);
    expect(error).toMatchObject({ status: 502, problem: null, body: '<html>Bad gateway</html>', code: null });
  });

  it('keeps a 409 body whole so `current` and other additions can be read', async () => {
    const body = { type: 'about:blank', title: 'x', status: 409, code: 'stale_version', current: { version: 4 } };
    server.use(http.put(`${ORIGIN}/api/x`, () => HttpResponse.json(body, { status: 409 })));
    const error = await apiFetch(`${ORIGIN}/api/x`, { method: 'PUT' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, body: { current: { version: 4 } } });
  });

  it('throws ApiNetworkError when no answer arrives', async () => {
    server.use(http.get(`${ORIGIN}/api/x`, () => HttpResponse.error()));
    await expect(apiFetch(`${ORIGIN}/api/x`)).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it('hands an abort back as the abort it is', async () => {
    const controller = new AbortController();
    server.use(
      http.get(`${ORIGIN}/api/x`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({});
      }),
    );
    const pending = apiFetch(`${ORIGIN}/api/x`, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.not.toBeInstanceOf(ApiNetworkError);
  });
});

describe('toProblem', () => {
  it('accepts a contract problem and nothing else', () => {
    expect(toProblem({ type: 'about:blank', title: 't', status: 409, code: 'form_already_used' })).toMatchObject({ code: 'form_already_used' });
    expect(toProblem({ type: 'about:blank', title: 't', status: 200, code: 'form_already_used' })).toBeNull();
    expect(toProblem({ type: 'about:blank', title: 't', status: 409, code: 'made_up' })).toBeNull();
    expect(toProblem('text')).toBeNull();
    expect(toProblem(null)).toBeNull();
  });
});
