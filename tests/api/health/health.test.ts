// @vitest-environment node
// GET /api/health (getHealth): cheap, public, no dependency checks. Needs no database and no secrets, and proves it by running with none.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/health/route';
import { GetHealthResponse } from '@/lib/api/generated/system/system.zod';
import { expectProblem, jsonRequest } from '../../helpers/api';

afterEach(() => {
  vi.unstubAllEnvs();
});

const get = () => GET(jsonRequest('/api/health', { method: 'GET' }), undefined);

describe('getHealth', () => {
  it('answers 200 { status: "ok", version } as the contract says, with no session and no token', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const body = GetHealthResponse.parse(await res.json());
    expect(body.status).toBe('ok');
  });

  it('reports the commit SHA on Vercel and "local" elsewhere', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '3f9c2e1d8a7b');
    expect(GetHealthResponse.parse(await (await get()).json()).version).toBe('3f9c2e1d8a7b');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);
    expect(GetHealthResponse.parse(await (await get()).json()).version).toBe('local');
  });

  it('makes no dependency check: it is 200 with no database, no signing secret and no cron secret configured', async () => {
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_SIGNING_SECRET', 'CRON_SECRET']) {
      vi.stubEnv(name, undefined);
    }
    const res = await get();
    expect(res.status).toBe(200);
    GetHealthResponse.parse(await res.json());
  });

  it.each([
    ['POST', POST],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])('%s is a 405 method_not_allowed problem with Allow: GET', async (method, handler) => {
    const res = await handler(jsonRequest('/api/health', { method }), undefined);
    await expectProblem(res, 405, 'method_not_allowed');
    expect(res.headers.get('allow')).toBe('GET');
  });
});
