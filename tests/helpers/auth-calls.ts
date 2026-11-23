// tests/helpers/auth-calls.ts: watch (and, for chosen emails, stand in for) the calls the server makes to Supabase Auth.
//
// The sign-in tests must prove that Supabase Auth is, or is not, called, and they need dozens of failed sign-ins (4 x 5, 20
// in parallel) without spending the hosted project's own per-address Auth limit. So `fetch` is wrapped: every call is
// recorded; a password-grant call for an email the test marks as a stand-in gets the answer Auth really gives (a wrong
// password: 400 invalid_credentials; its own limit: 429; an outage: 500) without leaving the process; everything else goes
// to the real Auth server. Only the path and, for the token endpoint, the email (a throwaway one) are kept; no password,
// token or key is recorded.
import { vi } from 'vitest';

export type AuthCall = { path: string; email: string | undefined; stubbed: boolean };

/** What a stand-in answers: Auth's own answers for a wrong password, for its rate limit, and for an outage. */
export type AuthAnswer = 'invalid_credentials' | 'rate_limited' | 'server_error';

export type AuthSpy = {
  calls: AuthCall[];
  /** Calls to the password-grant endpoint (the sign-in itself). */
  tokenCalls: () => AuthCall[];
  /** Calls to the logout endpoint (a refused sign-in ends its session). */
  logoutCalls: () => AuthCall[];
  restore: () => void;
};

const ANSWERS: Record<AuthAnswer, { status: number; body: unknown }> = {
  invalid_credentials: { status: 400, body: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } },
  rate_limited: { status: 429, body: { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' } },
  server_error: { status: 500, body: { code: 500, error_code: 'unexpected_failure', msg: 'Internal error' } },
};

/** Wrap fetch. `standIn(email)` returns the answer to give locally (true = invalid_credentials), or falsy to let the call through. */
export function spyOnAuth(standIn: (email: string) => AuthAnswer | boolean = () => false): AuthSpy {
  const real = globalThis.fetch;
  const calls: AuthCall[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.pathname.startsWith('/auth/v1/')) {
      let email: string | undefined;
      if (url.pathname === '/auth/v1/token' && typeof init?.body === 'string') {
        try {
          const parsed = JSON.parse(init.body) as { email?: unknown };
          if (typeof parsed.email === 'string') email = parsed.email;
        } catch {
          /* not JSON: not a password grant */
        }
      }
      const decision = email === undefined ? false : standIn(email);
      const answer: AuthAnswer | undefined = decision === true ? 'invalid_credentials' : decision === false ? undefined : decision;
      calls.push({ path: url.pathname, email, stubbed: answer !== undefined });
      if (answer !== undefined) {
        const { status, body } = ANSWERS[answer];
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      }
    }
    return real(input, init);
  });
  return {
    calls,
    tokenCalls: () => calls.filter((c) => c.path === '/auth/v1/token'),
    logoutCalls: () => calls.filter((c) => c.path === '/auth/v1/logout'),
    restore: () => spy.mockRestore(),
  };
}
