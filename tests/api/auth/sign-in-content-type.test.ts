// @vitest-environment node
// BUG-QA2-3 (QA2 probe PRB-08): POST /api/auth/sign-in reads its body only when the Content-Type is application/json. A
// browser can send text/plain (and a form post) from any other site without a preflight; if the route took those as JSON, a
// stranger's page could make a staff member's browser burn the failed-sign-in quota of its own network address (the 20 per
// address in SECURITY_MODEL). Against the STAGING Supabase project (counters), with throwaway emails only: the real staff
// accounts are never used, and Supabase Auth's answer for the throwaway emails is given locally (tests/helpers/auth-calls.ts).
//   the contract documents application/json only and has no 415, so a wrong type is 400 bad_request (CONTRACT QUESTION, soft)
//   a refused type reads no body, calls no Supabase Auth, counts no attempt and sets no cookie
//   application/json, with or without parameters and in any letter case, still signs in (here: a wrong password, 401)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/auth/sign-in/route';
import { hmacHex } from '@/lib/server/env';
import { addressHash } from '@/lib/server/services/network';
import { expectProblem } from '../../helpers/api';
import { setCookies } from '../../helpers/auth';
import { spyOnAuth, type AuthSpy } from '../../helpers/auth-calls';
import { setupStaging } from '../../helpers/staging';

const staging = setupStaging();

const STUB = '@be2-stub.test';
const runTag = Math.random().toString(36).slice(2, 8);
let counter = 0;
let spy: AuthSpy | undefined;

afterEach(() => {
  spy?.restore();
  spy = undefined;
  vi.restoreAllMocks();
});

/** A throwaway email with no account (tracked, so its counter rows are deleted in afterAll). */
function ghost(): string {
  counter += 1;
  const email = `be2.ct.${runTag}.${counter}${STUB}`;
  staging.trackEmail(email);
  return email;
}

/** The sign-in attempts the database holds for an address and for an email. */
async function attempts(address: string, email: string): Promise<{ byAddress: number; byEmail: number }> {
  const byAddress = await staging.db().from('sign_in_attempts').select('id').eq('ip_hash', addressHash(address));
  const byEmail = await staging.db().from('sign_in_attempts').select('id').eq('email_hash', hmacHex(`email|v1|${email}`));
  expect(byAddress.error).toBeNull();
  expect(byEmail.error).toBeNull();
  return { byAddress: (byAddress.data ?? []).length, byEmail: (byEmail.data ?? []).length };
}

/** The request QA2 sent in PRB-08: the JSON text of a sign-in, with the given Content-Type (or none). */
function signInWith(contentType: string | undefined, address: string, email: string): Request {
  const headers: Record<string, string> = { 'x-real-ip': address };
  if (contentType !== undefined) headers['content-type'] = contentType;
  return new Request('http://localhost/api/auth/sign-in', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password: 'not-a-real-password-for-the-test' }),
  });
}

const REFUSED: Array<[string, string | undefined]> = [
  ['PRB-08: text/plain', 'text/plain'],
  ['text/plain with a charset', 'text/plain;charset=UTF-8'],
  ['no Content-Type at all', undefined],
  ['application/x-www-form-urlencoded', 'application/x-www-form-urlencoded'],
  ['multipart/form-data', 'multipart/form-data; boundary=x'],
  ['application/jsonp (only a prefix of the right one)', 'application/jsonp'],
  ['application/json-patch+json (a different type)', 'application/json-patch+json'],
  ['text/plain that mentions application/json', 'text/plain; x=application/json'],
  ['an empty Content-Type', ''],
];

describe('a Content-Type other than application/json is refused before anything is read or counted', () => {
  it.each(REFUSED)('%s: 400 bad_request, Auth not called, no attempt counted, no cookie', async (_name, contentType) => {
    const email = ghost();
    const address = staging.address();
    spy = spyOnAuth((e) => e === email);

    const res = await POST(signInWith(contentType, address, email), undefined);
    await expectProblem(res, 400, 'bad_request');
    expect(setCookies(res)).toHaveLength(0);
    expect(spy.calls).toHaveLength(0); // nothing reached Supabase Auth
    expect(await attempts(address, email)).toEqual({ byAddress: 0, byEmail: 0 }); // and no failed attempt was recorded
  });
});

describe('application/json still signs in', () => {
  it.each([
    ['application/json', 'application/json'],
    ['with a charset', 'application/json; charset=utf-8'],
    ['in capitals', 'APPLICATION/JSON'],
  ])('%s: the body is read, and a wrong password is the usual 401 and one counted attempt', async (_name, contentType) => {
    const email = ghost();
    const address = staging.address();
    spy = spyOnAuth((e) => e === email);

    const res = await POST(signInWith(contentType, address, email), undefined);
    await expectProblem(res, 401, 'invalid_credentials');
    expect(spy.tokenCalls()).toHaveLength(1);
    expect(await attempts(address, email)).toEqual({ byAddress: 1, byEmail: 1 });
  });
});
