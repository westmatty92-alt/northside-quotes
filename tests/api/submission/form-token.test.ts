// @vitest-environment node
// src/lib/server/form-token.ts: the signed X-Form-Token (SECURITY_MODEL "The public formToken scheme"). No database.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvConfigError } from '@/lib/server/env';
import { FORM_TOKEN_MAX_AGE_MS, FORM_TOKEN_MIN_AGE_MS, issueFormToken, verifyFormToken } from '@/lib/server/form-token';

const SECRET = 'form-token-test-secret-0123456789abcdef';
const T0 = 1_800_000_000_000;

beforeEach(() => {
  vi.stubEnv('APP_SIGNING_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const forge = (issuedAt: number, nonce: string, secret = SECRET) =>
  `v1.${issuedAt}.${nonce}.${createHmac('sha256', secret).update(`form-token|v1|${issuedAt}|${nonce}`).digest('base64url')}`;

describe('issueFormToken / verifyFormToken', () => {
  it('issues v1.{issued_at}.{nonce}.{signature} and verifies it with the nonce it carries', () => {
    const token = issueFormToken(T0);
    expect(token).toMatch(/^v1\.1800000000000\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const verdict = verifyFormToken(token, T0 + 10_000);
    expect(verdict).toEqual({ ok: true, nonce: token.split('.')[2], issuedAtMs: T0 });
  });

  it('every token has its own nonce (one token per page load)', () => {
    expect(issueFormToken(T0).split('.')[2]).not.toBe(issueFormToken(T0).split('.')[2]);
  });

  it('time trap: younger than 3 s is too_young, exactly 3 s is accepted', () => {
    const token = issueFormToken(T0);
    expect(verifyFormToken(token, T0)).toEqual({ ok: false, reason: 'too_young' });
    expect(verifyFormToken(token, T0 + FORM_TOKEN_MIN_AGE_MS - 1)).toEqual({ ok: false, reason: 'too_young' });
    expect(verifyFormToken(token, T0 + FORM_TOKEN_MIN_AGE_MS).ok).toBe(true);
  });

  it('a signed token issued in the future (clock skew) is too_young, never accepted', () => {
    expect(verifyFormToken(issueFormToken(T0 + 60_000), T0)).toEqual({ ok: false, reason: 'too_young' });
  });

  it('expires after 24 h: exactly 24 h is accepted, one millisecond later is expired', () => {
    const token = issueFormToken(T0);
    expect(verifyFormToken(token, T0 + FORM_TOKEN_MAX_AGE_MS).ok).toBe(true);
    expect(verifyFormToken(token, T0 + FORM_TOKEN_MAX_AGE_MS + 1)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a tampered signature, nonce, issue time or version as invalid', () => {
    const [v, issuedAt, nonce, signature] = issueFormToken(T0).split('.') as [string, string, string, string];
    const flip = signature.startsWith('A') ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    const other = '11111111-1111-4111-8111-111111111111';
    for (const token of [
      `${v}.${issuedAt}.${nonce}.${flip}`,
      `${v}.${issuedAt}.${other}.${signature}`,
      `${v}.${Number(issuedAt) + 1}.${nonce}.${signature}`,
      `v2.${issuedAt}.${nonce}.${signature}`,
    ]) {
      expect(verifyFormToken(token, T0 + 10_000)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('refuses a token signed with another secret, and malformed shapes, as invalid', () => {
    const nonce = '22222222-2222-4222-8222-222222222222';
    expect(verifyFormToken(forge(T0, nonce, 'another-secret-another-secret-0123456789'), T0 + 10_000)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyFormToken(forge(T0, nonce), T0 + 10_000).ok).toBe(true); // the forge helper itself is right
    for (const token of ['', 'v1', 'v1..', 'v1.1.2.3', `${forge(T0, nonce)}.extra`, 'not a token', `v1.${T0}.${nonce}.short`, `v1.12e5.${nonce}.${'a'.repeat(43)}`]) {
      expect(verifyFormToken(token, T0 + 10_000)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('judges age only after the signature: an unsigned token never learns whether it was too young or too old', () => {
    const nonce = '33333333-3333-4333-8333-333333333333';
    const bad = forge(T0, nonce, 'wrong-secret-wrong-secret-0123456789ab');
    expect(verifyFormToken(bad, T0)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyFormToken(bad, T0 + FORM_TOKEN_MAX_AGE_MS + 1)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('SEC-4: with APP_SIGNING_SECRET unset, empty or short both functions throw EnvConfigError before looking at the token', () => {
    const token = issueFormToken(T0);
    for (const value of [undefined, '', 'x'.repeat(31)]) {
      vi.stubEnv('APP_SIGNING_SECRET', value);
      expect(() => issueFormToken(T0)).toThrow(EnvConfigError);
      expect(() => verifyFormToken(token, T0 + 10_000)).toThrow(EnvConfigError);
      expect(() => verifyFormToken('', T0 + 10_000)).toThrow(EnvConfigError);
    }
  });
});
