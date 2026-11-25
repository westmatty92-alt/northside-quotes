// @vitest-environment node
// BUG-QA2-1 (QA2 probes PRB-06 and PRB-06b): an unknown path answers 404 on EVERY method and header combination, never the
// app's HTML with a 200. Run against this checkout's real production server (tests/helpers/next-server.ts), because the answer
// comes from the framework's routing in front of the handlers, which an in-process handler call never meets. The server runs
// with the STAGING Supabase variables; one throwaway staff user signs in so the "GET with a staff token" case uses a real token.
//   AC-004.10, FR-27, SECURITY_MODEL invariant 21: no password, reset or sign-up path exists (404), on any method
//   contract: an unknown /api path is a 404 problem+json (code not_found); a listed path with an unlisted method stays a 405
//   a page path that does not exist gets Next's 404 status on every method
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/auth/sign-in/route';
import { expectProblem } from '../../helpers/api';
import { sessionOf, signInRequest } from '../../helpers/auth';
import { startNextServer, type NextServer } from '../../helpers/next-server';
import { setupStaging } from '../../helpers/staging';

const staging = setupStaging();

let server: NextServer;
let staffToken = '';

beforeAll(async () => {
  const staff = await staging.createUser({ staff: true, displayName: 'Unknown paths test staff' });
  const signedIn = await POST(signInRequest({ email: staff.email, password: staff.password }, staging.address()), undefined);
  expect(signedIn.status).toBe(200);
  staffToken = sessionOf(signedIn).access_token;
  server = await startNextServer();
}, 300_000);

afterAll(async () => {
  await server?.stop();
});

type Variant = { name: string; method: string; headers: () => Record<string, string>; body?: string };

/** The request shapes QA2 sent (PRB-06 and PRB-06b), plus PATCH and OPTIONS. */
const VARIANTS: Variant[] = [
  { name: 'GET', method: 'GET', headers: () => ({}) },
  { name: 'GET with Accept: application/json', method: 'GET', headers: () => ({ accept: 'application/json' }) },
  { name: 'GET with a cookie', method: 'GET', headers: () => ({ cookie: 'sb-x-auth-token=base64-AAAA' }) },
  { name: 'GET with an Authorization header', method: 'GET', headers: () => ({ authorization: 'Bearer x' }) },
  { name: 'GET with a staff token', method: 'GET', headers: () => ({ authorization: `Bearer ${staffToken}` }) },
  { name: 'HEAD', method: 'HEAD', headers: () => ({}) },
  { name: 'POST without a body', method: 'POST', headers: () => ({}) },
  { name: 'POST with a JSON body', method: 'POST', headers: () => ({ 'content-type': 'application/json' }), body: '{"a":1}' },
  { name: 'POST with a staff token', method: 'POST', headers: () => ({ authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' }), body: '{}' },
  { name: 'PUT without a body', method: 'PUT', headers: () => ({}) },
  { name: 'PUT with a JSON body', method: 'PUT', headers: () => ({ 'content-type': 'application/json' }), body: '{"a":1}' },
  { name: 'PATCH with a JSON body', method: 'PATCH', headers: () => ({ 'content-type': 'application/json' }), body: '{"a":1}' },
  { name: 'DELETE', method: 'DELETE', headers: () => ({}) },
  { name: 'OPTIONS', method: 'OPTIONS', headers: () => ({}) },
];

function send(path: string, variant: Variant): Promise<Response> {
  return fetch(`${server.url}${path}`, { method: variant.method, headers: variant.headers(), body: variant.body, redirect: 'manual' });
}

const UNKNOWN_API = [
  '/api',
  '/api/does-not-exist',
  '/api/auth/does-not-exist',
  '/api/password',
  '/api/reset-password',
  '/api/auth/forgot-password',
  '/api/auth/reset',
  '/api/auth/sign-up',
  '/api/auth/magic-link',
  '/api/staff/password',
  '/api/inbox',
  '/api/quote-requests/3d6f0a52-8b1e-4c7a-9f20-6e5d4c3b2a19/does-not-exist',
];

const UNKNOWN_PAGES = ['/does-not-exist', '/forgot-password', '/reset-password', '/change-password', '/sign-up', '/register', '/account/password', '/inbox'];

describe('an unknown /api path is a 404 problem+json on every method', () => {
  for (const path of UNKNOWN_API) {
    describe(path, () => {
      it.each(VARIANTS.map((v) => [v.name, v] as const))('%s', async (_name, variant) => {
        const res = await send(path, variant);
        if (variant.method === 'HEAD') {
          expect(res.status).toBe(404);
          expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/html/);
          return;
        }
        await expectProblem(res, 404, 'not_found');
      });
    });
  }
});

describe('an unknown page path gets the 404 status on every method, never 200', () => {
  for (const path of UNKNOWN_PAGES) {
    describe(path, () => {
      it.each(VARIANTS.map((v) => [v.name, v] as const))('%s', async (_name, variant) => {
        const res = await send(path, variant);
        expect(res.status).toBe(404);
      });
    });
  }
});

describe('known /api routes keep their answers', () => {
  const LISTED: Array<[string, string]> = [
    ['/api/auth/sign-in', 'POST'],
    ['/api/staff/me', 'GET'],
    ['/api/health', 'GET'],
    ['/api/weekly-counts/current', 'GET'],
  ];
  const WRITES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  for (const [path, listed] of LISTED) {
    for (const method of WRITES.filter((m) => m !== listed)) {
      it(`${method} ${path} is still 405 with Allow: ${listed}`, async () => {
        const res = await fetch(`${server.url}${path}`, { method, headers: { authorization: 'Bearer x' } });
        await expectProblem(res, 405, 'method_not_allowed');
        expect(res.headers.get('allow')).toBe(listed);
      });
    }
  }

  it('GET /api/health is still 200', async () => {
    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
  });

  it('GET /api/staff/me with a real staff token is still 200', async () => {
    const res = await fetch(`${server.url}/api/staff/me`, { headers: { authorization: `Bearer ${staffToken}` } });
    expect(res.status).toBe(200);
  });

  it('GET /api/staff/me without a session is still 401', async () => {
    const res = await fetch(`${server.url}/api/staff/me`);
    await expectProblem(res, 401, 'session_expired');
  });

  it('the pages still answer: /sign-in is 200 and a signed-out /requests redirects to sign-in', async () => {
    const signIn = await fetch(`${server.url}/sign-in`);
    expect(signIn.status).toBe(200);
    const requests = await fetch(`${server.url}/requests`, { redirect: 'manual' });
    expect(requests.status).toBe(307);
    expect(new URL(requests.headers.get('location') ?? '', server.url).pathname).toBe('/sign-in');
  });
});
