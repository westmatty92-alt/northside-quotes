import 'server-only';

// src/lib/server/form-token.ts: issue and verify the public X-Form-Token (docs/SECURITY_MODEL.md "The public
// formToken scheme", decision 0002).
//
// Scheme: v1.{issued_at_ms}.{nonce_uuid}.{signature}
//   signature = base64url(HMAC-SHA256(APP_SIGNING_SECRET, `form-token|v1|${issued_at_ms}|${nonce_uuid}`))
// Valid from 3 s to 24 h after issue.
//   too_young (< 3 s, the FR-8 time trap) -> 400 submission_refused
//   expired   (> 24 h)                   -> 400 form_expired
//   invalid   (bad shape or signature)   -> 401 form_token_invalid
// The nonce becomes quote_requests.submission_key. A missing or short APP_SIGNING_SECRET makes both functions throw
// EnvConfigError (invariant 15), before the token is even looked at.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { appSigningSecret } from './env';

export const FORM_TOKEN_MIN_AGE_MS = 3_000;
export const FORM_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type FormTokenRejection = 'too_young' | 'expired' | 'invalid';

export type FormTokenResult =
  | { ok: true; nonce: string; issuedAtMs: number }
  | { ok: false; reason: FormTokenRejection };

const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISSUED_AT = /^[0-9]{1,15}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes of HMAC-SHA256 as base64url without padding

function sign(secret: string, issuedAt: string, nonce: string): string {
  return createHmac('sha256', secret).update(`form-token|v1|${issuedAt}|${nonce}`).digest('base64url');
}

/** Issue a fresh form token for one page load. `nowMs` is for tests. Throws EnvConfigError without a valid secret. */
export function issueFormToken(nowMs: number = Date.now()): string {
  const secret = appSigningSecret();
  const issuedAt = String(Math.trunc(nowMs));
  const nonce = randomUUID();
  return `v1.${issuedAt}.${nonce}.${sign(secret, issuedAt, nonce)}`;
}

/**
 * Check a token from the X-Form-Token header. `nowMs` is for tests. Throws EnvConfigError without a valid secret;
 * every other outcome is a result. The signature is compared in constant time (equal-length buffers); age is only
 * judged once the signature is good, so an unsigned token never learns whether it was too young or too old.
 */
export function verifyFormToken(token: string, nowMs: number = Date.now()): FormTokenResult {
  const secret = appSigningSecret();
  const parts = typeof token === 'string' ? token.split('.') : [];
  const [version, issuedAt, nonce, signature] = parts;
  if (
    parts.length !== 4 ||
    version !== 'v1' ||
    issuedAt === undefined ||
    nonce === undefined ||
    signature === undefined ||
    !ISSUED_AT.test(issuedAt) ||
    !NONCE.test(nonce) ||
    !SIGNATURE.test(signature)
  ) {
    return { ok: false, reason: 'invalid' };
  }

  const expected = Buffer.from(sign(secret, issuedAt, nonce), 'utf8');
  const presented = Buffer.from(signature, 'utf8');
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return { ok: false, reason: 'invalid' };
  }

  const issuedAtMs = Number(issuedAt);
  const age = nowMs - issuedAtMs;
  if (age < FORM_TOKEN_MIN_AGE_MS) return { ok: false, reason: 'too_young' };
  if (age > FORM_TOKEN_MAX_AGE_MS) return { ok: false, reason: 'expired' };
  return { ok: true, nonce, issuedAtMs };
}
