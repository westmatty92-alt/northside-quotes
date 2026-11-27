import 'server-only';

// src/lib/server/env.ts: the ONLY reader of APP_SIGNING_SECRET and CRON_SECRET (docs/SECURITY_MODEL.md
// invariant 15, docs/architecture.md "Environment variables").
//
// Values are read lazily, on each call, so `next build` needs no secrets and a changed variable is seen at once.
// Unset or shorter than 32 characters means EnvConfigError: nothing falls back to a default or an empty key
// (S0 SEC-4). The error names the variable, never its value.
//
// What callers do with EnvConfigError (invariant 15):
//   - GET /, the two formToken routes and POST /api/auth/sign-in answer 503 service_unavailable
//     (src/lib/server/http.ts maps it that way);
//   - /api/jobs/* answer 401 (isCronRequest below never throws, it just says no).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MIN_SECRET_LENGTH = 32;

export type SecretName = 'APP_SIGNING_SECRET' | 'CRON_SECRET';

export class EnvConfigError extends Error {
  readonly variable: SecretName;
  constructor(variable: SecretName) {
    super(`${variable} is not configured (unset or shorter than ${MIN_SECRET_LENGTH} characters).`);
    this.name = 'EnvConfigError';
    this.variable = variable;
  }
}

function readSecret(name: SecretName): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) throw new EnvConfigError(name);
  return value;
}

/** The HMAC key for form tokens and the IP and email hashes. Throws EnvConfigError when unset or short. */
export function appSigningSecret(): string {
  return readSecret('APP_SIGNING_SECRET');
}

/** The Bearer secret Vercel cron sends to /api/jobs/*. Throws EnvConfigError when unset or short. */
export function cronSecret(): string {
  return readSecret('CRON_SECRET');
}

/**
 * HMAC-SHA256 of `input` with APP_SIGNING_SECRET, as lower-case hex (64 characters). The inputs are
 * domain-separated by their caller (`ip|v1|...`, `email|v1|...`). Throws EnvConfigError without a valid secret.
 */
export function hmacHex(input: string): string {
  return createHmac('sha256', appSigningSecret()).update(input).digest('hex');
}

/**
 * Is this `Authorization` header exactly `Bearer <CRON_SECRET>`? (invariant 12). Never throws: an unset or short
 * secret matches nothing, so `Bearer undefined`, `Bearer ` and no header are all false. Buffers of different
 * lengths are rejected without being compared; equal-length buffers use a constant-time compare.
 */
export function isCronRequest(authorization: string | null | undefined): boolean {
  let secret: string;
  try {
    secret = cronSecret();
  } catch {
    return false;
  }
  const prefix = 'Bearer ';
  if (typeof authorization !== 'string' || !authorization.startsWith(prefix)) return false;
  const presented = Buffer.from(authorization.slice(prefix.length), 'utf8');
  const expected = Buffer.from(secret, 'utf8');
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
