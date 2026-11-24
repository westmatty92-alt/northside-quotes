// @vitest-environment node
// POST /api/auth/sign-in (operation signIn), against the STAGING Supabase project (never skipped: missing variables fail the file).
//   AC-004.1, AC-004.2 staff sign in (200, session cookies, event once, attempt marked succeeded)
//   AC-004.4          wrong password and unknown email give one 401 body
//   AC-004.5          5 failures for one email, then the 6th is refused even with the right password
//   AC-004.11         5 emails x 4 failures from one address, the 21st is refused, another address signs in
//   AC-004.12         an email with no account is counted and refused exactly like a real one
//   AC-004.13         counters unreadable, or signing secret short: 503 sign_in_unavailable and Supabase Auth is not called
//   AC-004.6, AC-004.10 / FR-27: see no-account-routes.test.ts
// Failed sign-ins for THROWAWAY emails (ending @be2-stub.test, or a throwaway user's own) are answered locally in the way
// Supabase Auth answers a wrong password (tests/helpers/auth-calls.ts), so the hosted project's own per-address limit is not
// spent; every sign-in for a real staff account goes to the real Auth server. The real staff emails are never failed more than
// once, and every counter row, event and user a test creates is deleted in afterAll.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/auth/sign-in/route';
import { SignInResponse } from '@/lib/api/generated/staff-auth/staff-auth.zod';
import { getAdminClient } from '@/lib/server/admin';
import { hmacHex } from '@/lib/server/env';
import { addressHash } from '@/lib/server/services/network';
import { captureOutput, expectProblem } from '../../helpers/api';
import { sessionOf, setCookies, signInRequest } from '../../helpers/auth';
import { spyOnAuth, type AuthAnswer, type AuthSpy } from '../../helpers/auth-calls';
import { setupStaging } from '../../helpers/staging';
import { staffAccounts } from '../../helpers/staging-env';

const staging = setupStaging();
staging.needStaffPasswords();

const STUB = '@be2-stub.test';
const PAUSED_TITLE = 'Too many sign-in attempts. Try again in a few minutes.';
const UNAVAILABLE_TITLE = 'Sign-in is unavailable. Try again in a few minutes.';

let spy: AuthSpy | undefined;
let ghostCounter = 0;
const runTag = Math.random().toString(36).slice(2, 8);
const userIds: Record<string, string> = {};

/** Start watching Auth; `standIn` picks the sign-ins answered locally. */
function watchAuth(standIn?: (email: string) => AuthAnswer | boolean): AuthSpy {
  spy = spyOnAuth(standIn);
  return spy;
}
const isGhost = (email: string) => email.endsWith(STUB);

/** A throwaway email that has no account (tracked, so its counter rows are deleted). */
function ghost(): string {
  ghostCounter += 1;
  const email = `be2.${runTag}.${ghostCounter}${STUB}`;
  staging.trackEmail(email);
  return email;
}

const send = (body: unknown, address: string | null = staging.address(), headers: Record<string, string> = {}) =>
  POST(signInRequest(body, address, headers), undefined);

/** The attempts recorded for an email, newer than `before` (a snapshot from attemptIds; the real staff emails are used by several tests). */
async function attemptsFor(email: string, before: Set<string> = new Set()) {
  const { data, error } = await staging
    .db()
    .from('sign_in_attempts')
    .select('id, succeeded, ip_hash')
    .eq('email_hash', hmacHex(`email|v1|${email.trim().toLowerCase()}`));
  expect(error).toBeNull();
  return (data ?? []).filter((row) => !before.has(row.id)).map(({ succeeded, ip_hash }) => ({ succeeded, ip_hash }));
}

/** A snapshot of the attempt ids an email has now. */
async function attemptIds(email: string): Promise<Set<string>> {
  const { data, error } = await staging
    .db()
    .from('sign_in_attempts')
    .select('id')
    .eq('email_hash', hmacHex(`email|v1|${email.trim().toLowerCase()}`));
  expect(error).toBeNull();
  return new Set((data ?? []).map((row) => row.id));
}

async function pausesFor(key: string) {
  const { data, error } = await staging.db().from('sign_in_pauses').select('scope, paused_until').eq('key_hash', key);
  expect(error).toBeNull();
  return data ?? [];
}

const minutesFromNow = (iso: string) => (new Date(iso).getTime() - Date.now()) / 60_000;

beforeAll(async () => {
  // creates the admin client before any test wraps fetch (a client keeps the fetch it was built with)
  const users = await staging.db().auth.admin.listUsers({ perPage: 1000 });
  expect(users.error).toBeNull();
  for (const user of users.data?.users ?? []) if (user.email) userIds[user.email] = user.id;
  expect(userIds[staffAccounts().owner.email]).toBeDefined();
  expect(userIds[staffAccounts().helper.email]).toBeDefined();
});

afterEach(() => {
  spy?.restore();
  spy = undefined;
  vi.restoreAllMocks();
});

/** Real staff sessions this file opens; afterAll ends them (it runs before the shared cleanup: hooks run in reverse order). */
const openSessions: string[] = [];
const keepSession = (res: Response) => {
  openSessions.push(sessionOf(res).access_token);
};
afterAll(async () => {
  for (const token of openSessions) await staging.db().auth.admin.signOut(token, 'local');
});

describe('AC-004.1 and AC-004.2: the owner and the helper sign in', () => {
  for (const who of ['owner', 'helper'] as const) {
    it(`${who}: 200 with the contract body, session cookies, one staff_signed_in event, the attempt marked succeeded`, async () => {
      const account = staffAccounts()[who];
      const userId = userIds[account.email] ?? '';
      staging.trackEmail(account.email);
      const events = await staging.watchSignInEvents(userId);
      const before = await attemptIds(account.email);
      const auth = watchAuth();

      const address = staging.address();
      const res = await send({ email: account.email, password: account.password }, address);
      expect(res.status).toBe(200);
      keepSession(res);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('x-request-id')).toBeTruthy();
      expect(res.headers.get('cache-control')).toContain('no-store');
      expect(res.headers.get('retry-after')).toBeNull();

      const body: unknown = await res.json();
      const staff = SignInResponse.parse(body); // contract: user_id and display_name, nothing else
      expect(Object.keys(body as object).sort()).toEqual(['display_name', 'user_id']);
      expect(staff.user_id).toBe(userId);
      const row = await staging.db().from('staff').select('display_name').eq('user_id', userId).single();
      expect(staff.display_name).toBe(row.data?.display_name);

      // the session cookies a browser needs: Secure, SameSite=Lax, readable by script (not HttpOnly), site-wide
      const cookies = setCookies(res).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
      expect(cookies.length).toBeGreaterThan(0);
      for (const cookie of cookies) {
        expect(cookie.attributes).toContain('secure');
        expect(cookie.attributes).toContain('samesite=lax');
        expect(cookie.attributes).toContain('path=/');
        expect(cookie.attributes).not.toContain('httponly');
      }

      // Supabase Auth was called once, with the staff email as typed
      expect(auth.tokenCalls()).toHaveLength(1);

      // mark_sign_in_succeeded ran: the one attempt is not a failure any more
      expect(await attemptsFor(account.email, before)).toEqual([{ succeeded: true, ip_hash: addressHash(address) }]);

      // staff_signed_in: exactly one, internal user id only
      const written = await events();
      expect(written).toHaveLength(1);
      const event = await staging.db().from('events').select('name, user_id, properties, request_id').eq('id', written[0] ?? '').single();
      expect(event.data).toEqual({ name: 'staff_signed_in', user_id: userId, properties: { user_id: userId }, request_id: null });
    });
  }

  it('a sign-in that is refused fires no staff_signed_in event and sets no cookie', async () => {
    const owner = staffAccounts().owner;
    staging.trackEmail(owner.email);
    const events = await staging.watchSignInEvents(userIds[owner.email] ?? '');
    watchAuth((email) => email === owner.email); // stand in: this is the one wrong-password attempt the real owner email gets
    const res = await send({ email: owner.email, password: 'wrong-password-for-the-test' });
    await expectProblem(res, 401, 'invalid_credentials');
    expect(setCookies(res)).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });
});

describe('AC-004.4: wrong password and unknown email are one answer', () => {
  it('both are 401 invalid_credentials with identical bodies, no cookie, and each counts as one failed attempt', async () => {
    const owner = staffAccounts().owner;
    staging.trackEmail(owner.email);
    const unknown = ghost();
    const before = await attemptIds(owner.email);
    const auth = watchAuth(); // real Auth for both: this is what the browser would meet

    const wrong = await send({ email: owner.email, password: 'wrong-password-for-the-test' });
    const noAccount = await send({ email: unknown, password: 'wrong-password-for-the-test' });
    const wrongBody = await expectProblem(wrong.clone(), 401, 'invalid_credentials');
    const noAccountBody = await expectProblem(noAccount.clone(), 401, 'invalid_credentials');
    expect(noAccountBody).toEqual(wrongBody);
    expect(wrongBody.title).toBe('Email or password is incorrect');
    expect(wrong.headers.get('retry-after')).toBeNull();
    expect(setCookies(wrong)).toHaveLength(0);
    expect(setCookies(noAccount)).toHaveLength(0);
    expect(auth.tokenCalls()).toHaveLength(2);

    expect((await attemptsFor(owner.email, before)).map((a) => a.succeeded)).toEqual([false]);
    expect((await attemptsFor(unknown)).map((a) => a.succeeded)).toEqual([false]);
  });

  it('a signed-in user who is not staff gets the same 401, is signed out again, and is not marked as succeeded', async () => {
    const user = await staging.createUser(); // a real Auth user with no staff row
    const events = await staging.watchSignInEvents(user.id);
    const auth = watchAuth();

    const res = await send({ email: user.email, password: user.password });
    const body = await expectProblem(res.clone(), 401, 'invalid_credentials');
    expect(body.title).toBe('Email or password is incorrect');
    expect(setCookies(res)).toHaveLength(0); // no session reaches the browser
    expect(auth.tokenCalls()).toHaveLength(1);
    expect(auth.logoutCalls()).toHaveLength(1); // the session Auth created is ended
    expect((await attemptsFor(user.email)).map((a) => a.succeeded)).toEqual([false]); // mark_sign_in_succeeded not called
    expect(await events()).toHaveLength(0);
  });
});

describe('AC-004.5: 5 failures for one email pause that email, even for the right password', () => {
  it('the 5th failure is answered 401, the 6th attempt is 429 sign_in_paused with no Retry-After, and Auth is not called for it', async () => {
    const email = ghost();
    const auth = watchAuth(isGhost);
    for (let i = 1; i <= 5; i += 1) await expectProblem(await send({ email, password: `wrong-${i}` }), 401, 'invalid_credentials');

    const sixth = await send({ email, password: 'the-right-password-would-be-here' });
    const problem = await expectProblem(sixth.clone(), 429, 'sign_in_paused');
    expect(problem.title).toBe(PAUSED_TITLE);
    expect(sixth.headers.get('retry-after')).toBeNull();
    expect(setCookies(sixth)).toHaveLength(0);
    expect(auth.tokenCalls()).toHaveLength(5);

    // the pause is the email pause: about 5 minutes from the 5th failure; the refused attempt was not counted
    const pauses = await pausesFor(hmacHex(`email|v1|${email}`));
    expect(pauses).toHaveLength(1);
    expect(pauses[0]?.scope).toBe('email');
    expect(minutesFromNow(pauses[0]?.paused_until ?? '')).toBeGreaterThan(3);
    expect(minutesFromNow(pauses[0]?.paused_until ?? '')).toBeLessThanOrEqual(5.5);
    expect(await attemptsFor(email)).toHaveLength(5);
  });

  it('another email from the same address is not paused by it', async () => {
    const address = staging.address();
    const paused = ghost();
    watchAuth(isGhost);
    for (let i = 0; i < 5; i += 1) await send({ email: paused, password: 'wrong' }, address);
    await expectProblem(await send({ email: paused, password: 'wrong' }, address), 429, 'sign_in_paused');
    await expectProblem(await send({ email: ghost(), password: 'wrong' }, address), 401, 'invalid_credentials');
  });

  it('S0 QA: 20 parallel failures for one email reach Supabase Auth exactly 5 times; the other 15 are 429', async () => {
    const email = ghost();
    const auth = watchAuth(isGhost);
    const address = staging.address();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => send({ email, password: `wrong-${i}` }, address)));
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(15);
    expect(auth.tokenCalls()).toHaveLength(5);
    expect(await attemptsFor(email)).toHaveLength(5);
  });
});

describe('AC-004.11: 20 failures from one address pause the address; another address is not affected', () => {
  it('5 emails x 4 failures, then a 21st attempt with the owner credentials is 429; the same credentials from another address are 200', async () => {
    const owner = staffAccounts().owner;
    staging.trackEmail(owner.email);
    const events = await staging.watchSignInEvents(userIds[owner.email] ?? '');
    const before = await attemptIds(owner.email);
    const auth = watchAuth(isGhost);
    const addressA = staging.address();
    const addressB = staging.address();

    const emails = Array.from({ length: 5 }, () => ghost());
    for (const email of emails) {
      for (let i = 1; i <= 4; i += 1) await expectProblem(await send({ email, password: `wrong-${i}` }, addressA), 401, 'invalid_credentials');
    }
    // no single email reached 5
    for (const email of emails) expect(await pausesFor(hmacHex(`email|v1|${email}`))).toHaveLength(0);
    expect(auth.tokenCalls()).toHaveLength(20);

    const refused = await send({ email: owner.email, password: owner.password }, addressA);
    const problem = await expectProblem(refused.clone(), 429, 'sign_in_paused');
    expect(problem.title).toBe(PAUSED_TITLE);
    expect(refused.headers.get('retry-after')).toBeNull();
    expect(setCookies(refused)).toHaveLength(0);
    expect(auth.tokenCalls()).toHaveLength(20); // the owner's credentials never reached Auth from the paused address
    const pauses = await pausesFor(addressHash(addressA));
    expect(pauses).toHaveLength(1);
    expect(pauses[0]?.scope).toBe('ip');
    expect(minutesFromNow(pauses[0]?.paused_until ?? '')).toBeGreaterThan(13);
    expect(minutesFromNow(pauses[0]?.paused_until ?? '')).toBeLessThanOrEqual(15.5);
    expect(await attemptsFor(owner.email, before)).toHaveLength(0); // a refused attempt is not recorded

    const ok = await send({ email: owner.email, password: owner.password }, addressB);
    expect(ok.status).toBe(200);
    keepSession(ok);
    SignInResponse.parse(await ok.json());
    expect(auth.tokenCalls()).toHaveLength(21);
    expect(await attemptsFor(owner.email, before)).toEqual([{ succeeded: true, ip_hash: addressHash(addressB) }]);
    expect(await events()).toHaveLength(1);
  });

  it('the refusal body is the same for the address limit and the email limit, and for a real and an unknown email', async () => {
    const real = await staging.createUser();
    const unknown = ghost();
    const address = staging.address();
    watchAuth((email) => isGhost(email) || email === real.email);

    // email limit on the real (non-staff) account and on the unknown email
    for (const email of [real.email, unknown]) for (let i = 0; i < 5; i += 1) await send({ email, password: 'wrong' }, address);
    const realPaused = await send({ email: real.email, password: real.password }, address);
    const unknownPaused = await send({ email: unknown, password: 'wrong' }, address);
    const realBody = await expectProblem(realPaused, 429, 'sign_in_paused');
    const unknownBody = await expectProblem(unknownPaused, 429, 'sign_in_paused');
    expect(unknownBody).toEqual(realBody);
    expect(realPaused.headers.get('retry-after')).toBeNull();
    expect(unknownPaused.headers.get('retry-after')).toBeNull();
  });
});

describe('AC-004.12: an email with no account is counted and paused like any other', () => {
  it('5 failures for an unknown email, then the 6th is 429 sign_in_paused; the message does not say whether there is an account', async () => {
    const unknown = ghost();
    watchAuth(isGhost);
    for (let i = 0; i < 5; i += 1) await expectProblem(await send({ email: unknown, password: 'wrong' }), 401, 'invalid_credentials');
    const sixth = await send({ email: unknown, password: 'wrong' });
    const body = await expectProblem(sixth, 429, 'sign_in_paused');
    expect(body.title).toBe(PAUSED_TITLE);
    expect(JSON.stringify(body)).not.toMatch(/account|exist|unknown|registered/i);
    expect(await pausesFor(hmacHex(`email|v1|${unknown}`))).toHaveLength(1);
  });
});

describe('AC-004.13: sign-in fails closed', () => {
  const dbError = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout for owner@northside.test' }, status: 500, statusText: 'Internal Server Error', count: null };

  it('a database error on the limit call gives 503 sign_in_unavailable; Auth is not called; no cookie, no event, nothing leaked', async () => {
    const owner = staffAccounts().owner;
    const events = await staging.watchSignInEvents(userIds[owner.email] ?? '');
    const auth = watchAuth();
    const address = staging.address();
    const rpc = vi.spyOn(getAdminClient(), 'rpc').mockResolvedValue(dbError as never);

    let res!: Response;
    const output = await captureOutput(async () => {
      res = await send({ email: owner.email, password: owner.password }, address);
    });
    const problem = await expectProblem(res.clone(), 503, 'sign_in_unavailable');
    expect(problem.title).toBe(UNAVAILABLE_TITLE);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(setCookies(res)).toHaveLength(0);
    expect(auth.calls).toHaveLength(0); // Supabase Auth was never called
    expect(await events()).toHaveLength(0);

    // the call was take_sign_in_attempt with the two hashes per SECURITY_MODEL, and only that
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('take_sign_in_attempt', {
      p_email_hash: hmacHex(`email|v1|${owner.email}`),
      p_ip_hash: addressHash(address),
    });

    // nothing from the database, the email or the password in the answer or the log
    const everything = `${JSON.stringify(problem)}\n${output}`;
    expect(everything).not.toContain('canceling statement');
    expect(everything).not.toContain(owner.email);
    expect(everything).not.toContain(owner.password);
    expect(output).toContain('"outcome":"sign_in_unavailable"');
    expect(output).toContain('"code":"57014"');
  });

  it('a limit call that throws, or that answers something unexpected, is also 503 and Auth is not called', async () => {
    const owner = staffAccounts().owner;
    const auth = watchAuth();
    const rpc = vi.spyOn(getAdminClient(), 'rpc');

    rpc.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expectProblem(await send({ email: owner.email, password: owner.password }), 503, 'sign_in_unavailable');
    for (const data of [null, {}, { allowed: 'yes' }, { allowed: true }, { allowed: true, attempt_id: '' }]) {
      rpc.mockResolvedValueOnce({ data, error: null, status: 200, statusText: 'OK', count: null } as never);
      await expectProblem(await send({ email: owner.email, password: owner.password }), 503, 'sign_in_unavailable');
    }
    expect(auth.calls).toHaveLength(0);
  });

  it('a real database failure (a service-role key the database refuses) is 503 too, with no Auth call', async () => {
    const owner = staffAccounts().owner;
    const auth = watchAuth();
    const original = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    try {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'not-the-real-key');
      vi.resetModules(); // a fresh admin client, built with that key
      const fresh = await import('@/app/api/auth/sign-in/route');
      const res = await fresh.POST(signInRequest({ email: owner.email, password: owner.password }, staging.address()), undefined);
      await expectProblem(res, 503, 'sign_in_unavailable');
      expect(auth.calls).toHaveLength(0);
    } finally {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', original);
    }
  });

  it('an unset or too-short APP_SIGNING_SECRET is 503 sign_in_unavailable before anything is counted; Auth is not called', async () => {
    const owner = staffAccounts().owner;
    const auth = watchAuth();
    const rpc = vi.spyOn(getAdminClient(), 'rpc');
    try {
      for (const secret of ['x'.repeat(31), '']) {
        vi.stubEnv('APP_SIGNING_SECRET', secret);
        const res = await send({ email: owner.email, password: owner.password });
        const problem = await expectProblem(res, 503, 'sign_in_unavailable');
        expect(problem.title).toBe(UNAVAILABLE_TITLE);
        expect(setCookies(res)).toHaveLength(0);
      }
      vi.stubEnv('APP_SIGNING_SECRET', undefined);
      await expectProblem(await send({ email: owner.email, password: owner.password }), 503, 'sign_in_unavailable');
    } finally {
      vi.stubEnv('APP_SIGNING_SECRET', staging.secrets.signing);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(auth.calls).toHaveLength(0);
  });
});

describe('Supabase Auth trouble is not a wrong password', () => {
  it("Auth's own rate limit shows as the same 429 pause, and an Auth outage as 503 sign_in_unavailable; neither sets a cookie", async () => {
    const limited = ghost();
    const down = ghost();
    watchAuth((email) => (email === limited ? 'rate_limited' : email === down ? 'server_error' : false));
    const pausedRes = await send({ email: limited, password: 'x' });
    await expectProblem(pausedRes.clone(), 429, 'sign_in_paused');
    expect(pausedRes.headers.get('retry-after')).toBeNull();
    const outage = await send({ email: down, password: 'x' });
    await expectProblem(outage.clone(), 503, 'sign_in_unavailable');
    expect(setCookies(pausedRes)).toHaveLength(0);
    expect(setCookies(outage)).toHaveLength(0);
  });
});

describe('the network address and the email that are counted', () => {
  it('no address header at all counts under the hash of ip|v1|unknown', async () => {
    const email = ghost();
    watchAuth(isGhost);
    const unknownHash = hmacHex('ip|v1|unknown');
    staging.trackHash(unknownHash);
    expect((await send({ email, password: 'x' }, null)).status).toBe(401);
    expect(await attemptsFor(email)).toEqual([{ succeeded: false, ip_hash: unknownHash }]);
  });

  it('x-forwarded-for is used when x-real-ip is missing (first entry), and an IPv6 address counts by its /64', async () => {
    const email = ghost();
    watchAuth(isGhost);
    staging.trackAddress('203.0.113.9');
    staging.trackAddress('2001:db8:aa:bb:1::1');
    await send({ email, password: 'x' }, null, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    await send({ email, password: 'x' }, '2001:db8:aa:bb:1::1');
    await send({ email, password: 'x' }, '2001:db8:aa:bb:ffff:2:3:4'); // same /64 as the one above
    const hashes = (await attemptsFor(email)).map((a) => a.ip_hash).sort();
    expect(hashes).toEqual([addressHash('203.0.113.9'), addressHash('2001:db8:aa:bb:1::1'), addressHash('2001:db8:aa:bb:ffff:2:3:4')].sort());
    expect(new Set(hashes).size).toBe(2);
  });

  it('the email is trimmed and lower-cased before it is hashed and before Auth sees it', async () => {
    const owner = staffAccounts().owner;
    staging.trackEmail(owner.email);
    const before = await attemptIds(owner.email);
    const auth = watchAuth((email) => email === owner.email); // answered locally: this must not be a real failed owner sign-in
    const res = await send({ email: `  ${owner.email.toUpperCase()} `, password: 'x' });
    expect(res.status).toBe(401);
    expect(auth.tokenCalls().map((c) => c.email)).toEqual([owner.email]);
    expect(await attemptsFor(owner.email, before)).toHaveLength(1);
  });
});

describe('validation: refused before anything is counted or sent to Auth', () => {
  it.each([
    ['not JSON', undefined, 400],
    ['a JSON array', [], 400],
    ['null', null, 400],
  ])('%s is 400 bad_request', async (_name, body, status) => {
    const auth = watchAuth();
    const rpc = vi.spyOn(getAdminClient(), 'rpc');
    const res =
      body === undefined
        ? await POST(new Request('http://localhost/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }), undefined)
        : await send(body);
    await expectProblem(res, status, 'bad_request');
    expect(rpc).not.toHaveBeenCalled();
    expect(auth.calls).toHaveLength(0);
  });

  it.each([
    ['an email that is not an email', { email: 'not-an-email', password: 'x' }, 'email'],
    ['a missing email', { password: 'x' }, 'email'],
    ['an email over 254 characters', { email: `${'a'.repeat(250)}@example.test`, password: 'x' }, 'email'],
    ['a missing password', { email: 'someone@example.test' }, 'password'],
    ['an empty password', { email: 'someone@example.test', password: '' }, 'password'],
    ['a password over 200 characters', { email: 'someone@example.test', password: 'p'.repeat(201) }, 'password'],
    ['a password that is not text', { email: 'someone@example.test', password: 12345 }, 'password'],
    ['an unknown field', { email: 'someone@example.test', password: 'x', remember_me: true }, 'remember_me'],
  ])('%s is 422 naming the field', async (_name, body, field) => {
    const auth = watchAuth();
    const rpc = vi.spyOn(getAdminClient(), 'rpc');
    const problem = await expectProblem(await send(body), 422, 'validation_failed');
    expect(problem.errors?.map((e) => e.field)).toContain(field);
    expect(JSON.stringify(problem)).not.toContain('someone@example.test');
    expect(rpc).not.toHaveBeenCalled();
    expect(auth.calls).toHaveLength(0);
  });

  it('every other method is a 405 problem with an Allow header', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) {
      const handlers = await import('@/app/api/auth/sign-in/route');
      const res = await handlers[method](new Request('http://localhost/api/auth/sign-in', { method }), undefined);
      await expectProblem(res, 405, 'method_not_allowed');
      expect(res.headers.get('allow')).toBe('POST');
    }
  });
});
