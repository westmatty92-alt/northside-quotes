import 'server-only';

// =====================================================================================================
// STUB, BE1 REPLACES. Written by the A2 scaffold (bl-architect) so the frontend lane can render SCR-01
// (src/app/(public)/page.tsx calls issueFormToken()) with a dummy APP_SIGNING_SECRET before BE1 lands.
// The backend lane (BE1) owns this file and replaces the body and its unit tests. The exported names and
// signatures below are what other lanes code against: keep them, or raise a contract question.
//
// What the stub does: issueFormToken() returns a token in the documented format, so the page renders
// with a realistic value. verifyFormToken() ALWAYS THROWS (fails closed): nothing can accept a token
// until BE1 implements the constant-time check and the 3 s / 24 h window.
// =====================================================================================================
//
// Scheme (docs/SECURITY_MODEL.md "The public formToken scheme", decision 0002):
//   v1.{issued_at_ms}.{nonce_uuid}.{signature}
//   signature = base64url(HMAC-SHA256(APP_SIGNING_SECRET, `form-token|v1|${issued_at_ms}|${nonce_uuid}`))
// Valid from 3 s to 24 h after issue. too_young → 400 submission_refused; expired → 400 form_expired;
// invalid (bad shape or signature) → 401 form_token_invalid. The nonce becomes quote_requests.submission_key.
// A missing or short APP_SIGNING_SECRET makes both functions throw EnvConfigError (invariant 15).
import { createHmac, randomUUID } from 'node:crypto';
import { appSigningSecret } from './env';

export const FORM_TOKEN_MIN_AGE_MS = 3_000;
export const FORM_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type FormTokenRejection = 'too_young' | 'expired' | 'invalid';

export type FormTokenResult =
  | { ok: true; nonce: string; issuedAtMs: number }
  | { ok: false; reason: FormTokenRejection };

/** Issue a fresh form token for one page load. `nowMs` is for tests. Throws EnvConfigError without a valid secret. */
export function issueFormToken(nowMs: number = Date.now()): string {
  const secret = appSigningSecret();
  const issuedAt = String(Math.trunc(nowMs));
  const nonce = randomUUID();
  const signature = createHmac('sha256', secret).update(`form-token|v1|${issuedAt}|${nonce}`).digest('base64url');
  return `v1.${issuedAt}.${nonce}.${signature}`;
}

/** Check a token from the X-Form-Token header. `nowMs` is for tests. STUB: always throws until BE1. */
export function verifyFormToken(token: string, nowMs: number = Date.now()): FormTokenResult {
  void token;
  void nowMs;
  appSigningSecret();
  throw new Error('verifyFormToken is a stub (A2 scaffold); BE1 implements it. Refusing to accept any token.');
}
