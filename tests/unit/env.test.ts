// @vitest-environment node
// src/lib/server/env.ts: the only reader of APP_SIGNING_SECRET and CRON_SECRET (SECURITY_MODEL invariants 12 and 15, S0 SEC-4).
// No database, no network. Proves: unset, empty and short secrets fail closed with an error that names the variable and never
// the value; the cron check says no for `Bearer undefined`, `Bearer ` and no header; a matching header works only with a good secret.
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvConfigError, MIN_SECRET_LENGTH, appSigningSecret, cronSecret, hmacHex, isCronRequest } from '@/lib/server/env';

const GOOD = 'g'.repeat(MIN_SECRET_LENGTH);
const SHORT = 's'.repeat(MIN_SECRET_LENGTH - 1);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('APP_SIGNING_SECRET and CRON_SECRET (invariant 15)', () => {
  it('accepts a secret of at least 32 characters and reads it on every call (lazy, no value cached)', () => {
    vi.stubEnv('APP_SIGNING_SECRET', GOOD);
    expect(appSigningSecret()).toBe(GOOD);
    vi.stubEnv('APP_SIGNING_SECRET', 'h'.repeat(40));
    expect(appSigningSecret()).toBe('h'.repeat(40));
    vi.stubEnv('CRON_SECRET', GOOD);
    expect(cronSecret()).toBe(GOOD);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['31 characters', SHORT],
  ])('refuses a secret that is %s, naming the variable and never the value', (_label, value) => {
    vi.stubEnv('APP_SIGNING_SECRET', value);
    vi.stubEnv('CRON_SECRET', value);
    for (const [read, name] of [
      [appSigningSecret, 'APP_SIGNING_SECRET'],
      [cronSecret, 'CRON_SECRET'],
    ] as const) {
      let caught: unknown;
      try {
        read();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnvConfigError);
      expect((caught as EnvConfigError).variable).toBe(name);
      expect((caught as EnvConfigError).message).toContain(name);
      if (value) expect((caught as EnvConfigError).message).not.toContain(value);
    }
  });

  it('hmacHex is HMAC-SHA256 with the signing secret, 64 hex characters, and throws without a valid secret', () => {
    vi.stubEnv('APP_SIGNING_SECRET', GOOD);
    const expected = createHmac('sha256', GOOD).update('ip|v1|203.0.113.9').digest('hex');
    expect(hmacHex('ip|v1|203.0.113.9')).toBe(expected);
    expect(hmacHex('ip|v1|203.0.113.9')).toMatch(/^[0-9a-f]{64}$/);
    vi.stubEnv('APP_SIGNING_SECRET', SHORT);
    expect(() => hmacHex('anything')).toThrow(EnvConfigError);
  });
});

describe('isCronRequest (invariant 12): Bearer CRON_SECRET, constant time, fails closed', () => {
  it('is true only for exactly "Bearer <secret>" with a good secret', () => {
    vi.stubEnv('CRON_SECRET', GOOD);
    expect(isCronRequest(`Bearer ${GOOD}`)).toBe(true);
    expect(isCronRequest(`Bearer ${'x'.repeat(MIN_SECRET_LENGTH)}`)).toBe(false); // same length, wrong value
    expect(isCronRequest(`Bearer ${GOOD}x`)).toBe(false); // longer
    expect(isCronRequest(`Bearer ${GOOD.slice(1)}`)).toBe(false); // shorter
    expect(isCronRequest(GOOD)).toBe(false); // no scheme
    expect(isCronRequest(`bearer ${GOOD}`)).toBe(false);
    expect(isCronRequest(`Bearer  ${GOOD}`)).toBe(false);
    expect(isCronRequest(`Basic ${GOOD}`)).toBe(false);
    expect(isCronRequest(null)).toBe(false);
    expect(isCronRequest(undefined)).toBe(false);
    expect(isCronRequest('')).toBe(false);
  });

  it('S0 SEC-4: with CRON_SECRET unset, "Bearer undefined", "Bearer " and no header all fail', () => {
    vi.stubEnv('CRON_SECRET', undefined);
    expect(isCronRequest('Bearer undefined')).toBe(false);
    expect(isCronRequest('Bearer ')).toBe(false);
    expect(isCronRequest('Bearer')).toBe(false);
    expect(isCronRequest(null)).toBe(false);
  });

  it('an empty or short CRON_SECRET matches nothing, not even its own value', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(isCronRequest('Bearer ')).toBe(false);
    vi.stubEnv('CRON_SECRET', SHORT);
    expect(isCronRequest(`Bearer ${SHORT}`)).toBe(false);
  });
});
