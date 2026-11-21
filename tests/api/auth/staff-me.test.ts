// @vitest-environment node
// GET /api/staff/me (operation getCurrentStaff) and the guard behind it, requireStaff, against the STAGING Supabase project.
//   AC-004.2   the owner and the helper are both staff
//   AC-004.7   an expired session is refused (a session older than 7 days, a signed-out one)
//   AC-004.8   no bearer token: 401 and nothing else
// Access tokens come from signing in directly with the publishable key (the same token the browser client holds); the sign-in
// route has its own tests. Throwaway users (with and without a staff row) are created through the Auth admin API and deleted
// in afterAll. Missing variables fail the file; nothing skips.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/staff/me/route';
import { GetCurrentStaffResponse } from '@/lib/api/generated/staff-auth/staff-auth.zod';
import { expectProblem } from '../../helpers/api';
import { meRequest } from '../../helpers/auth';
import { psql, setupStaging } from '../../helpers/staging';
import { staffAccounts } from '../../helpers/staging-env';

const staging = setupStaging();
staging.needStaffPasswords();

const tokens: Record<'owner' | 'helper', string> = { owner: '', helper: '' };
const ids: Record<'owner' | 'helper', string> = { owner: '', helper: '' };

async function tokenFor(email: string, password: string): Promise<{ token: string; userId: string }> {
  const { data, error } = await staging.anon().auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return { token: data.session?.access_token ?? '', userId: data.user?.id ?? '' };
}

beforeAll(async () => {
  const accounts = staffAccounts();
  for (const who of ['owner', 'helper'] as const) {
    const signed = await tokenFor(accounts[who].email, accounts[who].password);
    tokens[who] = signed.token;
    ids[who] = signed.userId;
    expect(tokens[who]).not.toBe('');
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // end the two real staff sessions this file opened (runs before the shared cleanup: hooks run in reverse order)
  for (const who of ['owner', 'helper'] as const) {
    if (tokens[who] !== '') await staging.db().auth.admin.signOut(tokens[who], 'local');
  }
});

describe('AC-004.2: both staff accounts are recognised', () => {
  for (const who of ['owner', 'helper'] as const) {
    it(`${who}: 200 with exactly user_id and display_name, as the contract says`, async () => {
      const res = await GET(meRequest({ token: tokens[who] }), undefined);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('x-request-id')).toBeTruthy();
      expect(res.headers.get('cache-control')).toContain('no-store');
      const body: unknown = await res.json();
      const staff = GetCurrentStaffResponse.parse(body);
      expect(Object.keys(body as object).sort()).toEqual(['display_name', 'user_id']);
      expect(staff.user_id).toBe(ids[who]);
      const row = await staging.db().from('staff').select('display_name').eq('user_id', ids[who]).single();
      expect(staff.display_name).toBe(row.data?.display_name);
    });
  }

  it('the two staff members have different display names (the top bar says who is signed in)', async () => {
    const owner = (await (await GET(meRequest({ token: tokens.owner }), undefined)).json()) as { display_name: string };
    const helper = (await (await GET(meRequest({ token: tokens.helper }), undefined)).json()) as { display_name: string };
    expect(owner.display_name).not.toBe(helper.display_name);
  });
});

describe('AC-004.8: no valid staff session is one 401 session_expired', () => {
  const bodies: unknown[] = [];

  it.each([
    ['no Authorization header', () => meRequest()],
    ['an empty bearer token', () => meRequest({ authorization: 'Bearer ' })],
    ['a different scheme', () => meRequest({ authorization: 'Basic b3duZXI6cGFzc3dvcmQ=' })],
    ['a token that is not a token', () => meRequest({ token: 'not-a-jwt' })],
    ['a token with a bad signature', () => meRequest({ token: `${tokens.owner.slice(0, -4)}AAAA` })],
    ['a token of 5,000 characters', () => meRequest({ token: 'a'.repeat(5000) })],
    ['a token with characters no token has', () => meRequest({ authorization: 'Bearer abc def;drop' })],
    ['only the session cookie (cookies never authenticate an API call)', () => meRequest({ cookie: `sb-staging-auth-token=${tokens.owner}` })],
  ])('%s', async (_name, build) => {
    const res = await GET(build(), undefined);
    bodies.push(await expectProblem(res.clone(), 401, 'session_expired'));
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(JSON.stringify(await res.json())).not.toMatch(/staff|token|jwt|expired at/i);
  });

  it('all of the refusals above have the same body, so nothing says why', () => {
    expect(bodies.length).toBeGreaterThanOrEqual(8);
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });
});

describe('a signed-in user who is not staff, a removed staff member, an old session, a signed-out session', () => {
  it('a user with no staff row is 401 session_expired', async () => {
    const user = await staging.createUser();
    const { token } = await tokenFor(user.email, user.password);
    await expectProblem(await GET(meRequest({ token }), undefined), 401, 'session_expired');
  });

  it('a staff member is 200, and 401 the moment the staff row is removed', async () => {
    const user = await staging.createUser({ staff: true, displayName: 'Temp staff' });
    const { token } = await tokenFor(user.email, user.password);
    const ok = await GET(meRequest({ token }), undefined);
    expect(ok.status).toBe(200);
    expect(GetCurrentStaffResponse.parse(await ok.json())).toEqual({ user_id: user.id, display_name: 'Temp staff' });

    psql(`delete from public.staff where user_id = '${user.id}'`);
    await expectProblem(await GET(meRequest({ token }), undefined), 401, 'session_expired');
  });

  it('AC-004.7: a session older than 7 days is refused (6 days is still fine), though its token has not expired', async () => {
    const user = await staging.createUser({ staff: true });
    const { token } = await tokenFor(user.email, user.password);

    psql(`update auth.sessions set created_at = now() - interval '6 days' where user_id = '${user.id}'`);
    expect((await GET(meRequest({ token }), undefined)).status).toBe(200);

    psql(`update auth.sessions set created_at = now() - interval '8 days' where user_id = '${user.id}'`);
    await expectProblem(await GET(meRequest({ token }), undefined), 401, 'session_expired');
  });

  it('AC-004.9: after sign-out the same token is refused', async () => {
    const user = await staging.createUser({ staff: true });
    const client = staging.anon();
    const signed = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    const token = signed.data.session?.access_token ?? '';
    expect((await GET(meRequest({ token }), undefined)).status).toBe(200);
    expect((await client.auth.signOut()).error).toBeNull();
    await expectProblem(await GET(meRequest({ token }), undefined), 401, 'session_expired');
  });
});

describe('Supabase unreachable is not "signed out"', () => {
  it('an Auth outage while the token is checked is a 500 internal_error (the contract lists no 503 here), not a 401', async () => {
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw).pathname === '/auth/v1/user') {
        return new Response(JSON.stringify({ code: 503, msg: 'down' }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      return real(input, init);
    });
    await expectProblem(await GET(meRequest({ token: tokens.owner }), undefined), 500, 'internal_error');
  });
});

describe('methods', () => {
  it('every method but GET is a 405 problem with Allow: GET', async () => {
    const res = await POST(new Request('http://localhost/api/staff/me', { method: 'POST' }), undefined);
    await expectProblem(res, 405, 'method_not_allowed');
    expect(res.headers.get('allow')).toBe('GET');
  });
});
