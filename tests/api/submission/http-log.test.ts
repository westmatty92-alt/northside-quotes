// @vitest-environment node
// src/lib/server/http.ts and log.ts: problem+json, PostgREST error mapping, { error_class, code }-only logging (SEC-5,
// SECURITY_MODEL invariant 11). No database: the wrapper is exercised with handlers that throw.
import { describe, expect, it } from 'vitest';
import { EnvConfigError } from '@/lib/server/env';
import {
  ProblemError,
  UNPARSEABLE,
  dbProblem,
  errorFields,
  json,
  methodNotAllowed,
  readJsonBody,
  unavailable,
  withApi,
} from '@/lib/server/http';
import { buildLogLine } from '@/lib/server/log';
import { captureOutput, expectProblem, jsonRequest } from '../../helpers/api';

const PERSONAL = ['Dana Whitfield', '9055550142', 'dana@example.test', '14 Barton St W'];

describe('log.ts: an allow-list of fields, well-formed values only', () => {
  it('writes the allowed fields and drops everything else', () => {
    const line = JSON.parse(
      buildLogLine('error', {
        request_id: 'iad1::abc-123',
        route: 'POST /api/quote-requests',
        method: 'POST',
        status: 500,
        duration_ms: 12.4,
        user_id: '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10',
        quote_request_id: '0b7e4d2c-1a3f-4c8e-9d6b-5e2f1a0c7b94',
        outcome: 'internal_error',
        error_class: 'postgrest',
        code: '23514',
        job_id: 'job-1',
        attempt: 2,
        name: 'Dana Whitfield',
        email: 'dana@example.test',
        phone: '9055550142',
        message: 'new row violates check constraint',
        details: 'Failing row contains (Dana Whitfield, 9055550142)',
        hint: 'a hint',
        error: new Error('boom'),
        body: { name: 'Dana' },
        authorization: 'Bearer secret',
      }),
    ) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(
      ['attempt', 'code', 'duration_ms', 'error_class', 'job_id', 'level', 'method', 'outcome', 'quote_request_id', 'request_id', 'route', 'status', 'user_id'],
    );
    expect(line.duration_ms).toBe(12);
  });

  it('drops a value that does not look like its field, so personal data cannot ride in an allowed field', () => {
    const line = JSON.parse(
      buildLogLine('warn', {
        route: 'GET /api/quote-requests?q=Dana%20Whitfield',
        error_class: 'Dana Whitfield rejected',
        code: 'dana@example.test',
        outcome: 'x'.repeat(65),
        request_id: 'has space',
        method: 'post',
        status: 'not a number',
      }),
    ) as Record<string, unknown>;
    expect(line).toEqual({ level: 'warn' });
  });
});

describe('errorFields: kind and SQLSTATE, never message, details or hint', () => {
  it('reads only a safe name and a safe code from whatever was thrown', () => {
    const dbError = { code: '23514', message: 'new row violates check constraint', details: `Failing row contains (${PERSONAL.join(', ')})`, hint: 'h' };
    expect(errorFields(dbError)).toEqual({ error_class: 'object', code: '23514' });
    expect(errorFields(new TypeError(`boom ${PERSONAL[0]}`))).toEqual({ error_class: 'TypeError', code: 'none' });
    expect(errorFields(Object.assign(new Error('x'), { code: 'has a space' }))).toEqual({ error_class: 'Error', code: 'none' });
    expect(errorFields('a string')).toEqual({ error_class: 'string', code: 'none' });
    expect(JSON.stringify(errorFields(dbError))).not.toContain('Failing row');
  });
});

describe('dbProblem: PostgREST errors by SQLSTATE, with our own text', () => {
  it.each([
    ['PT401', 401, 'session_expired'],
    ['PT404', 404, 'not_found'],
    ['PT409', 409, 'stale_version'],
    ['PT422', 422, 'validation_failed'],
    ['', 503, 'service_unavailable'], // supabase-js gives code '' when the network failed
    ['08006', 503, 'service_unavailable'],
    ['57014', 503, 'service_unavailable'],
    ['PGRST002', 503, 'service_unavailable'],
    ['42883', 500, 'internal_error'],
    ['PGRST301', 500, 'internal_error'],
  ])('%s -> %i %s', (code, status, problemCode) => {
    const problem = dbProblem({ code, message: `secret text ${PERSONAL[0]}` });
    expect(problem.status).toBe(status);
    expect(problem.code).toBe(problemCode);
    expect(errorFields(problem).error_class).toBe('postgrest');
    expect(JSON.stringify(errorFields(problem))).not.toContain(PERSONAL[0]);
  });

  it('23514 -> 422 with the field its constraint protects and our own message, never the database text', () => {
    const problem = dbProblem({ code: '23514', message: 'new row for relation "quote_requests" violates check constraint "quote_requests_phone_check"' });
    expect(problem.status).toBe(422);
    expect(problem.errors).toEqual([{ field: 'phone', message: 'Enter a 10-digit phone number' }]);
    expect(dbProblem({ code: '23514', message: 'violates check constraint "some_other_check"' }).errors).toBeUndefined();
    expect(dbProblem({ code: '23514' }).errors).toBeUndefined();
  });

  it('an unavailable dependency is a 503 that logs its class and code only', () => {
    const problem = unavailable('storage', 'list');
    expect(problem.status).toBe(503);
    expect(errorFields(problem)).toEqual({ error_class: 'storage', code: 'list' });
  });
});

describe('withApi: problem+json for everything, one log line, an x-request-id on every response', () => {
  it('turns an unexpected error into a generic 500 and logs only { error_class, code }', async () => {
    const handler = withApi('POST /api/test', () => Promise.reject(Object.assign(new TypeError(`boom ${PERSONAL.join(' ')}`), { code: '23514', details: PERSONAL.join(' ') })));
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await handler(jsonRequest('/api/test', { headers: { 'x-vercel-id': 'iad1::req-1' } }), undefined);
    });
    const body = await expectProblem(res as Response, 500, 'internal_error');
    expect(body.title).toBe('Something went wrong');
    expect((res as Response).headers.get('x-request-id')).toBe('iad1::req-1');
    const lines = output.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'error', request_id: 'iad1::req-1', route: 'POST /api/test', method: 'POST', status: 500, outcome: 'internal_error', error_class: 'TypeError', code: '23514' });
    for (const text of [output, JSON.stringify(body)]) for (const personal of PERSONAL) expect(text).not.toContain(personal);
  });

  it('answers a missing or short signing secret with 503 service_unavailable (invariant 15)', async () => {
    const handler = withApi('POST /api/test', () => Promise.reject(new EnvConfigError('APP_SIGNING_SECRET')));
    let res: Response | undefined;
    await captureOutput(async () => {
      res = await handler(jsonRequest('/api/test'), undefined);
    });
    const body = await expectProblem(res as Response, 503, 'service_unavailable');
    expect(JSON.stringify(body)).not.toContain('APP_SIGNING_SECRET');
  });

  it('maps a ProblemError to its status, code, headers and field errors, and passes a success through', async () => {
    const failing = withApi('POST /api/test', () =>
      Promise.reject(new ProblemError(429, 'rate_limited', { headers: { 'Retry-After': '42' } })),
    );
    let res: Response | undefined;
    await captureOutput(async () => {
      res = await failing(jsonRequest('/api/test'), undefined);
    });
    await expectProblem(res as Response, 429, 'rate_limited');
    expect((res as Response).headers.get('retry-after')).toBe('42');

    const invalid = withApi('POST /api/test', () =>
      Promise.reject(new ProblemError(422, 'validation_failed', { errors: [{ field: 'phone', message: 'Enter a 10-digit phone number' }] })),
    );
    await captureOutput(async () => {
      res = await invalid(jsonRequest('/api/test'), undefined);
    });
    const body = await expectProblem(res as Response, 422, 'validation_failed');
    expect(body.errors).toEqual([{ field: 'phone', message: 'Enter a 10-digit phone number' }]);

    const fine = withApi('GET /api/test', async (_req, ctx) => json(ctx, { ok: true }, 201));
    await captureOutput(async () => {
      res = await fine(jsonRequest('/api/test', { method: 'GET' }), undefined);
    });
    expect((res as Response).status).toBe(201);
    expect((res as Response).headers.get('content-type')).toBe('application/json');
    expect((res as Response).headers.get('x-request-id')).toBeTruthy();
    expect(await (res as Response).json()).toEqual({ ok: true });
  });

  it('ignores a malformed x-vercel-id and makes its own request id', async () => {
    const handler = withApi('GET /api/test', async (_req, ctx) => json(ctx, {}));
    let res: Response | undefined;
    await captureOutput(async () => {
      res = await handler(jsonRequest('/api/test', { method: 'GET', headers: { 'x-vercel-id': 'bad id with spaces' } }), undefined);
    });
    expect((res as Response).headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('methodNotAllowed gives 405 method_not_allowed with an Allow header', async () => {
    const handler = methodNotAllowed('/api/test', ['GET', 'POST']);
    let res: Response | undefined;
    await captureOutput(async () => {
      res = await handler(jsonRequest('/api/test', { method: 'DELETE' }), undefined);
    });
    await expectProblem(res as Response, 405, 'method_not_allowed');
    expect((res as Response).headers.get('allow')).toBe('GET, POST');
  });
});

describe('readJsonBody', () => {
  it('parses JSON, and answers UNPARSEABLE for non-JSON, an empty body and an oversize body, without throwing', async () => {
    expect(await readJsonBody(jsonRequest('/api/test', { body: { a: 1 } }))).toEqual({ a: 1 });
    expect(await readJsonBody(jsonRequest('/api/test', { rawBody: '{not json' }))).toBe(UNPARSEABLE);
    expect(await readJsonBody(jsonRequest('/api/test', { rawBody: '' }))).toBe(UNPARSEABLE);
    expect(await readJsonBody(jsonRequest('/api/test', { method: 'POST' }))).toBe(UNPARSEABLE);
    expect(await readJsonBody(jsonRequest('/api/test', { rawBody: JSON.stringify({ big: 'x'.repeat(70_000) }) }))).toBe(UNPARSEABLE);
    expect(await readJsonBody(jsonRequest('/api/test', { rawBody: '{}', headers: { 'content-length': '999999' } }))).toBe(UNPARSEABLE);
  });
});
