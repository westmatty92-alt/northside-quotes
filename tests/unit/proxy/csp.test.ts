// @vitest-environment node
// SECURITY_MODEL invariant 13 and S0 SEC-15: the policy text and the nonce. Offline.
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce, supabaseOrigin } from '@/lib/server/auth/csp';

describe('newNonce', () => {
  it('is 16 random bytes in base64, and never repeats', () => {
    const nonces = Array.from({ length: 500 }, () => newNonce());
    expect(new Set(nonces).size).toBe(500);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
    }
  });
});

describe('supabaseOrigin', () => {
  it('keeps the origin only', () => {
    expect(supabaseOrigin('https://abcdefgh.supabase.co/rest/v1/?x=1')).toBe('https://abcdefgh.supabase.co');
  });
  it('is null for nothing or for text that is not a URL', () => {
    expect(supabaseOrigin(undefined)).toBeNull();
    expect(supabaseOrigin('')).toBeNull();
    expect(supabaseOrigin('not a url')).toBeNull();
  });
});

describe('contentSecurityPolicy: the text of invariant 13', () => {
  const policy = contentSecurityPolicy({ nonce: 'NONCE123==', supabaseUrl: 'https://abcdefgh.supabase.co' });
  const directives = Object.fromEntries(policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]));

  it('is exactly the policy the security model prints, for production', () => {
    expect(policy).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'nonce-NONCE123==' 'strict-dynamic'",
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

  it('gives scripts the nonce and never unsafe-inline or unsafe-eval in production; only styles get unsafe-inline', () => {
    expect(directives['script-src']).not.toContain('unsafe-inline');
    expect(directives['script-src']).not.toContain('unsafe-eval');
    expect(directives['style-src']).toContain("'unsafe-inline'");
  });

  it("development adds 'unsafe-eval' to script-src and nothing else", () => {
    const dev = contentSecurityPolicy({ nonce: 'NONCE123==', supabaseUrl: 'https://abcdefgh.supabase.co', development: true });
    expect(dev).toContain("script-src 'self' 'nonce-NONCE123==' 'strict-dynamic' 'unsafe-eval'");
    expect(dev.replace(" 'unsafe-eval'", '')).toBe(policy);
  });

  it('without a Supabase URL the policy has no remote origin at all', () => {
    const bare = contentSecurityPolicy({ nonce: 'N==' });
    expect(bare).toContain("img-src 'self' blob: data:;");
    expect(bare).toContain("connect-src 'self';");
    expect(bare).not.toContain('http');
  });
});
