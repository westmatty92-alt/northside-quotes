// @vitest-environment node
// src/proxy.ts with REAL session cookies, against the STAGING Supabase project: the cookies written by the sign-in route are
// the ones the proxy reads back (@supabase/ssr), the refresh of an old access token reaches the response, and the
// redirects follow what Supabase says, not what a cookie claims. (The redirect and nonce rules are in tests/unit/proxy.)
//   AC-004.3, AC-004.14  signed out: /requests and /pipeline go to sign-in with next; after sign-in they land where they were going
//   FR-26, invariant 22  the allow-list holds for a really signed-in visitor
//   AC-004.9             a visitor with a dead session is sent to sign-in
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/auth/sign-in/route';
import { proxy } from '@/proxy';
import { cookieHeader, sessionOf, setCookies, signInRequest } from '../../helpers/auth';
import { setupStaging } from '../../helpers/staging';

// A throwaway staff user signs in here, not the owner: the owner's staff_signed_in events belong to sign-in.test.ts, which
// counts them, and test files run in parallel.
const staging = setupStaging();

const ORIGIN = 'http://localhost';
let signedInCookies = '';
let signInResponse: Response;

const visit = (path: string, cookie = '') => new NextRequest(`${ORIGIN}${path}`, { headers: cookie === '' ? {} : { cookie } });
const target = (res: Response) => {
  const url = new URL(res.headers.get('location') ?? '');
  expect(url.origin).toBe(ORIGIN);
  return `${url.pathname}${url.search}`;
};

beforeAll(async () => {
  const staff = await staging.createUser({ staff: true, displayName: 'Proxy test staff' }); // its sign-in event is deleted in afterAll
  signInResponse = await POST(signInRequest({ email: staff.email, password: staff.password }, staging.address()), undefined);
  expect(signInResponse.status).toBe(200);
  signedInCookies = cookieHeader(signInResponse);
  expect(signedInCookies).toContain('-auth-token');
});

describe('signed out', () => {
  it('AC-004.3, AC-004.14: /requests and /pipeline (and both detail paths) redirect to /sign-in?next=<path>', async () => {
    const id = '3d6f0a52-8b1e-4c7a-9f20-6e5d4c3b2a19';
    for (const path of ['/requests', '/pipeline', `/requests/${id}`, `/pipeline/${id}`]) {
      const res = await proxy(visit(path));
      expect(res.status).toBe(307);
      expect(target(res)).toBe(`/sign-in?next=${path}`);
    }
  });

  it('garbage in the session cookie is signed out, not an error', async () => {
    const garbage = setCookies(signInResponse)
      .map((c) => `${c.name}=base64-AAAA`)
      .join('; ');
    const res = await proxy(visit('/pipeline', garbage));
    expect(res.status).toBe(307);
    expect(target(res)).toBe('/sign-in?next=/pipeline');
  });
});

describe('signed in with the cookies the sign-in route set', () => {
  it('the staff pages are served, with a policy and a nonce', async () => {
    for (const path of ['/requests', '/pipeline']) {
      const res = await proxy(visit(path, signedInCookies));
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    }
  });

  it('FR-26: /sign-in?next=... goes to a staff path on the allow-list; every other value goes to /requests', async () => {
    const id = '3d6f0a52-8b1e-4c7a-9f20-6e5d4c3b2a19';
    for (const next of ['/pipeline', '/requests', `/pipeline/${id}`]) {
      expect(target(await proxy(visit(`/sign-in?next=${next}`, signedInCookies)))).toBe(next);
    }
    for (const query of ['next=https://evil.example', 'next=//evil.example', 'next=/%2F%2Fevil.example', 'next=%2F%2Fevil.example', '']) {
      expect(target(await proxy(visit(`/sign-in?${query}`, signedInCookies)))).toBe('/requests');
    }
  });

  it('an access token that is past its time is refreshed, and the refreshed cookies reach the response', async () => {
    const session = sessionOf(signInResponse);
    const base = setCookies(signInResponse).find((c) => /-auth-token(\.\d+)?$/.test(c.name))?.name.replace(/\.\d+$/, '') ?? '';
    expect(base).not.toBe('');
    // the same session, but its access token is recorded as expired: @supabase/ssr must use the refresh token
    const stale = { ...session, expires_at: Math.floor(Date.now() / 1000) - 60, expires_in: 0 };
    const cookie = `${base}=base64-${Buffer.from(JSON.stringify(stale)).toString('base64url')}`;

    const res = await proxy(visit('/requests', cookie));
    expect(res.status).toBe(200);
    const refreshed = setCookies(res).filter((c) => c.name.startsWith(base));
    expect(refreshed.length).toBeGreaterThan(0);
    for (const c of refreshed) {
      expect(c.attributes).toContain('secure');
      expect(c.attributes).toContain('samesite=lax');
      expect(c.attributes).not.toContain('httponly');
    }
    expect(sessionOf(res).access_token).not.toBe(session.access_token);
    expect(res.headers.get('cache-control')).toMatch(/no-store|no-cache/); // a response that sets cookies is never cached
    // and the page is told the same session (the request headers it renders with)
    expect(res.headers.get('x-middleware-request-cookie')).toContain(base);
  });
});
