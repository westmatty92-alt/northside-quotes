// @vitest-environment node
// src/lib/server/services/network.ts: the network address and its hash (SECURITY_MODEL "Network address", S0 SEC-3).
// The /64 cut and the hash input are pinned here, as the model requires. No database.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvConfigError } from '@/lib/server/env';
import { addressHash, addressHashInput, addressKey, clientAddress } from '@/lib/server/services/network';

const SECRET = 'network-test-secret-0123456789abcdefgh';

beforeEach(() => {
  vi.stubEnv('APP_SIGNING_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('addressKey: IPv4 whole, IPv6 by its /64', () => {
  it('uses an IPv4 address whole', () => {
    expect(addressKey('203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey('  198.51.100.7 ')).toBe('198.51.100.7');
  });

  it('cuts an IPv6 address to its first four hextets after expanding "::", lower-cased, leading zeros dropped', () => {
    expect(addressKey('2001:db8:85a3:1:2:8a2e:370:7334')).toBe('2001:db8:85a3:1');
    expect(addressKey('2001:0DB8::1')).toBe('2001:db8:0:0');
    expect(addressKey('2001:db8:1:2::')).toBe('2001:db8:1:2');
    expect(addressKey('::1')).toBe('0:0:0:0');
    expect(addressKey('[2001:db8:0:5::9]')).toBe('2001:db8:0:5');
    expect(addressKey('fe80::1%eth0')).toBe('fe80:0:0:0');
  });

  it('counts every address of one /64 as one client, and another /64 as another', () => {
    expect(addressKey('2001:db8:aaaa:1::1')).toBe(addressKey('2001:db8:aaaa:1:ffff:ffff:ffff:ffff'));
    expect(addressKey('2001:db8:aaaa:1::1')).not.toBe(addressKey('2001:db8:aaaa:2::1'));
  });

  it('treats an IPv4-mapped IPv6 address as that IPv4 address', () => {
    expect(addressKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey('::ffff:cb00:7109')).toBe('203.0.113.9');
  });

  it('is null for a missing value or something that is not an address', () => {
    for (const value of [null, undefined, '', '   ', 'unknown', 'localhost', '999.1.1.1', '1.2.3', '2001:db8::zz']) {
      expect(addressKey(value)).toBeNull();
    }
  });
});

describe('clientAddress: x-real-ip, then the first x-forwarded-for entry', () => {
  it('prefers x-real-ip', () => {
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('203.0.113.9');
  });
  it('falls back to the first x-forwarded-for entry', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
  });
  it('is null when neither header is present', () => {
    expect(clientAddress(new Headers())).toBeNull();
    expect(clientAddress(new Headers({ 'x-real-ip': '  ' }))).toBeNull();
  });
});

describe('addressHash: HMAC-SHA256 of "ip|v1|<address or /64 prefix>" with APP_SIGNING_SECRET', () => {
  it('hashes exactly the documented input', () => {
    expect(addressHashInput('203.0.113.9')).toBe('ip|v1|203.0.113.9');
    expect(addressHashInput('2001:db8:85a3:1:2:8a2e:370:7334')).toBe('ip|v1|2001:db8:85a3:1');
    expect(addressHashInput(null)).toBe('ip|v1|unknown');
    expect(addressHashInput('garbage')).toBe('ip|v1|unknown');
    const expected = createHmac('sha256', SECRET).update('ip|v1|203.0.113.9').digest('hex');
    expect(addressHash('203.0.113.9')).toBe(expected);
    expect(addressHash('203.0.113.9')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives address-less callers one shared "unknown" hash, and one /64 one shared hash', () => {
    expect(addressHash(null)).toBe(createHmac('sha256', SECRET).update('ip|v1|unknown').digest('hex'));
    expect(addressHash('2001:db8:1:1::5')).toBe(addressHash('2001:db8:1:1:9::7'));
    expect(addressHash('203.0.113.9')).not.toBe(addressHash('203.0.113.10'));
  });

  it('depends on the secret, and throws without a valid one (the address is never stored raw)', () => {
    const before = addressHash('203.0.113.9');
    vi.stubEnv('APP_SIGNING_SECRET', 'a-different-secret-0123456789abcdefghij');
    expect(addressHash('203.0.113.9')).not.toBe(before);
    vi.stubEnv('APP_SIGNING_SECRET', 'short');
    expect(() => addressHash('203.0.113.9')).toThrow(EnvConfigError);
  });
});
