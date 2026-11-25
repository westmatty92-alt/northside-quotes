// @vitest-environment node
// src/proxy.ts: signed-out redirects, the `next` allow-list, the per-request CSP nonce (AC-004.3, AC-004.14, FR-26,
// SECURITY_MODEL invariants 13 and 22, S0 SEC-15). Offline: the session refresh is replaced by a stand-in that says who is
// signed in; the real refresh against staging is in tests/api/auth/proxy-session.test.ts.
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null, fail: false }));
vi.mock('@/lib/server/session', async () => {
  const { NextResponse } = await import('next/server');
  return {
    refreshSession: vi.fn(async (_request: unknown, extra: Record<string, string> = {}) => {
      if (session.fail) throw new Error('Supabase is down');
      return { response: NextResponse.next({ request: { headers: new Headers(extra) } }), userId: session.userId };
    }),
  };
});

import { config, proxy } from '@/proxy';
import { refreshSession } from '@/lib/server/session';

const ID = '3d6f0a52-8b1e-4c7a-9f20-6e5d4c3b2a19';
const ORIGIN = 'http://localhost';
const SIGNED_IN_COOKIE = 'sb-test-auth-token=present';

function visit(pathAndQuery: string, cookie?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${pathAndQuery}`, { headers: cookie === undefined ? {} : { cookie } });
}
const nonceOf = (res: Response) => /'nonce-([^']+)'/.exec(res.headers.get('content-security-policy') ?? '')?.[1];
const location = (res: Response) => res.headers.get('location') ?? '';
/** Where a redirect goes, as path + query on this origin; fails if it leaves the origin. */
function target(res: Response): string {
  const url = new URL(location(res));
  expect(url.origin).toBe(ORIGIN);
  return `${url.pathname}${url.search}`;
}

beforeEach(() => {
  session.userId = null;
  session.fail = false;
  vi.mocked(refreshSession).mockClear();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefgh.supabase.co');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('signed-out visits to the staff pages go to /sign-in?next=<path> (AC-004.3, AC-004.14)', () => {
  it.each([
    ['/requests', '/sign-in?next=/requests'],
    ['/pipeline', '/sign-in?next=/pipeline'],
    [`/requests/${ID}`, `/sign-in?next=/requests/${ID}`],
    [`/pipeline/${ID}`, `/sign-in?next=/pipeline/${ID}`],
    ['/requests/', '/sign-in?next=/requests'],
    ['/requests?status=new&q=smith', '/sign-in?next=/requests'], // the search text never travels in the address
    ['/pipeline?x=1#top', '/sign-in?next=/pipeline'],
  ])('%s -> %s (a temporary redirect)', async (path, expected) => {
    const res = await proxy(visit(path));
    expect(res.status).toBe(307);
    expect(target(res)).toBe(expected);
  });

  it('the redirect still carries the policy and a nonce', async () => {
    const res = await proxy(visit('/pipeline'));
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self' 'nonce-");
    expect(nonceOf(res)).toBeTruthy();
  });

  it('a request with a session cookie that Supabase does not accept is signed out too', async () => {
    session.userId = null;
    const res = await proxy(visit('/pipeline', SIGNED_IN_COOKIE));
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(target(res)).toBe('/sign-in?next=/pipeline');
  });

  it('when the session cannot be checked at all (Supabase down or not configured) a staff page still redirects, and public pages still load', async () => {
    session.fail = true;
    expect(target(await proxy(visit('/requests', SIGNED_IN_COOKIE)))).toBe('/sign-in?next=/requests');
    const home = await proxy(visit('/', SIGNED_IN_COOKIE));
    expect(home.status).toBe(200);
    expect(home.headers.get('location')).toBeNull();
  });
});

describe('pages that need no session', () => {
  it.each(['/', '/sign-in', '/sign-in?next=/pipeline', '/request-sent'])('%s passes through with a policy', async (path) => {
    const res = await proxy(visit(path));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(nonceOf(res)).toBeTruthy();
  });

  it('a visitor with no Supabase cookie costs no Supabase call', async () => {
    await proxy(visit('/'));
    await proxy(visit('/sign-in'));
    expect(refreshSession).not.toHaveBeenCalled();
  });
});

describe('a signed-in visit', () => {
  beforeEach(() => {
    session.userId = ID;
  });

  it.each(['/requests', '/pipeline', `/requests/${ID}`, `/pipeline/${ID}`])('%s is served', async (path) => {
    const res = await proxy(visit(path, SIGNED_IN_COOKIE));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it.each([
    ['/pipeline', '/pipeline'],
    ['/requests', '/requests'],
    [`/requests/${ID}`, `/requests/${ID}`],
    [`/pipeline/${ID}`, `/pipeline/${ID}`],
  ])('/sign-in?next=%s goes on to %s (a staff member who is already signed in, FR-26)', async (next, expected) => {
    expect(target(await proxy(visit(`/sign-in?next=${encodeURIComponent(next)}`, SIGNED_IN_COOKIE)))).toBe(expected);
    expect(target(await proxy(visit(`/sign-in?next=${next}`, SIGNED_IN_COOKIE)))).toBe(expected); // as typed, unencoded
  });

  it('/sign-in with no next goes to /requests', async () => {
    expect(target(await proxy(visit('/sign-in', SIGNED_IN_COOKIE)))).toBe('/requests');
  });

  // invariant 22 and AC-004.14's neighbours: the three values the build brief names, and the cases around them
  describe.each([
    ['https://evil.example', 'next=https%3A%2F%2Fevil.example', 'next=https://evil.example'],
    ['//evil.example', 'next=%2F%2Fevil.example', 'next=//evil.example'],
    ['/%2F%2Fevil.example', 'next=%2F%252F%252Fevil.example', 'next=/%2F%2Fevil.example'],
    ['///evil.example', 'next=%2F%2F%2Fevil.example', 'next=///evil.example'],
    ['/\\evil.example', 'next=%2F%5Cevil.example', 'next=/%5Cevil.example'],
    ['javascript:alert(1)', 'next=javascript%3Aalert(1)', 'next=javascript:alert(1)'],
    ['/requests?x=1', 'next=%2Frequests%3Fx%3D1', 'next=/requests?x=1'],
    ['/requests/not-an-id', 'next=%2Frequests%2Fnot-an-id', 'next=/requests/not-an-id'],
    ['/inbox', 'next=%2Finbox', 'next=/inbox'],
    ['nothing', 'next=', 'next'],
  ])('next=%s', (_label, encoded, raw) => {
    it('lands on /requests, whether the value is encoded or typed as it is', async () => {
      for (const query of [encoded, raw]) {
        const res = await proxy(visit(`/sign-in?${query}`, SIGNED_IN_COOKIE));
        expect(res.status).toBe(307);
        expect(target(res)).toBe('/requests');
      }
    });
  });
});

describe('S0 SEC-15, invariant 13: a fresh nonce and the policy on every page response', () => {
  it('two requests get different nonces, in the policy and in the headers forwarded to the page', async () => {
    const first = await proxy(visit('/'));
    const second = await proxy(visit('/'));
    const [a, b] = [nonceOf(first), nonceOf(second)];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    // forwarded to the page as request headers, so Next.js renders its scripts with the same nonce
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(a);
    expect(second.headers.get('x-middleware-request-x-nonce')).toBe(b);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(first.headers.get('content-security-policy'));
  });

  it('every nonce over 200 requests is different, including the redirects and the signed-in pages', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      session.userId = null;
      for (const res of [await proxy(visit('/')), await proxy(visit('/requests')), await proxy(visit('/sign-in'))]) seen.add(nonceOf(res) ?? '');
      session.userId = ID;
      seen.add(nonceOf(await proxy(visit('/requests', SIGNED_IN_COOKIE))) ?? '');
    }
    expect(seen.size).toBe(200);
    expect(seen.has('')).toBe(false);
  });

  it('the policy is the one in the security model, naming this request\'s nonce and the Supabase origin', async () => {
    const res = await proxy(visit('/'));
    const nonce = nonceOf(res);
    expect(res.headers.get('content-security-policy')).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data: https://abcdefgh.supabase.co",
        "connect-src 'self' https://abcdefgh.supabase.co",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
      ].join('; '),
    );
  });
});

describe('the matcher', () => {
  const pattern = new RegExp(`^${config.matcher[0]}$`);
  it.each(['/', '/requests', '/pipeline', `/requests/${ID}`, '/sign-in', '/request-sent'])('runs on the page %s', (path) => {
    expect(pattern.test(path)).toBe(true);
  });
  // BUG-QA2-1: /api is matched too, so that an /api path no route serves is answered 404 by the proxy on every method
  it.each(['/api/health', '/api/auth/sign-in', '/api/staff/me', '/api/does-not-exist', '/api/password', '/does-not-exist'])('runs on %s', (path) => {
    expect(pattern.test(path)).toBe(true);
  });
  it.each(['/_next/static/chunks/app.js', '/_next/image', '/favicon.ico'])('does not run on %s', (path) => {
    expect(pattern.test(path)).toBe(false);
  });
});

// BUG-QA2-1 (QA2 PRB-06, PRB-06b), AC-004.10, FR-27: a path the app does not serve is a 404 on every method. The hosting
// platform answered 200 with HTML for POST, PUT, DELETE and a GET with an Authorization header; the proxy answers first.
// (The same requests against a real server are in tests/api/auth/unknown-paths.test.ts.)
describe('a path the app does not serve is answered 404 by the proxy', () => {
  const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
  const call = (path: string, method: string, headers: Record<string, string> = {}) =>
    proxy(new NextRequest(`${ORIGIN}${path}`, { method, headers }));

  describe.each(['/api', '/api/does-not-exist', '/api/auth/does-not-exist', '/api/password', '/api/reset-password', '/api/auth/forgot-password', '/api/inbox', '/api/quote-requests/abc/nothing'])(
    'the /api path %s',
    (path) => {
      it.each(METHODS)('%s: 404 problem+json, code not_found, nothing else in the body', async (method) => {
        const variants: Array<Record<string, string>> = [{}, { authorization: 'Bearer x' }, { cookie: SIGNED_IN_COOKIE }];
        for (const headers of variants) {
          const res = await call(path, method, headers);
          expect(res.status).toBe(404);
          expect(res.headers.get('content-type')).toBe('application/problem+json');
          expect(res.headers.get('x-request-id')).toBeTruthy();
          expect(res.headers.get('x-middleware-next')).toBeNull();
          if (method !== 'HEAD') expect(await res.json()).toEqual({ type: 'about:blank', title: 'Not found', status: 404, code: 'not_found' });
        }
      });
    },
  );

  describe.each(['/does-not-exist', '/forgot-password', '/reset-password', '/change-password', '/sign-up', '/register', '/account/password', '/inbox', `/requests/${ID}/extra`])(
    'the page path %s',
    (path) => {
      it.each(METHODS)('%s: 404 HTML with the policy, never passed on', async (method) => {
        const variants: Array<Record<string, string>> = [{}, { authorization: 'Bearer x' }];
        for (const headers of variants) {
          const res = await call(path, method, headers);
          expect(res.status).toBe(404);
          expect(res.headers.get('content-type')).toMatch(/^text\/html/);
          expect(res.headers.get('x-middleware-next')).toBeNull();
          expect(nonceOf(res)).toBeTruthy();
        }
      });
    },
  );

  it('an unknown page costs no Supabase call, even with a session cookie', async () => {
    await call('/forgot-password', 'GET', { cookie: SIGNED_IN_COOKIE });
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it.each(['/_next/data/x.json', '/__nextjs_original-stack-frames', '/_next/webpack-hmr'])('the framework address %s is left to Next.js', async (path) => {
    const res = await call(path, 'GET');
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it.each([
    ['/api/health', 'GET'],
    ['/api/auth/sign-in', 'POST'],
    ['/api/auth/sign-in', 'GET'], // a method the route does not list is the route's own 405
    ['/api/staff/me', 'GET'],
    [`/api/quote-requests/${ID}/photos`, 'POST'],
    [`/api/quote-requests/${ID}/status-changes`, 'POST'],
    ['/api/weekly-counts/current', 'GET'],
    ['/api/jobs/housekeeping/', 'GET'],
  ])('the known route %s (%s) is passed straight on, with no nonce and no policy', async (path, method) => {
    const res = await call(path, method);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it.each(['/', '/sign-in', '/request-sent', '/requests', '/pipeline', `/requests/${ID}`, `/pipeline/${ID}`])('the known page %s is not turned into a 404', async (path) => {
    session.userId = ID;
    const res = await call(path, 'GET', { cookie: SIGNED_IN_COOKIE });
    expect(res.status).not.toBe(404);
  });
});
