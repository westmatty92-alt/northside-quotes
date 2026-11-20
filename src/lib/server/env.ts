import 'server-only';

// =====================================================================================================
// STUB, BE1 REPLACES. Written by the A2 scaffold (bl-architect) so the frontend lane can render SCR-01
// before BE1 lands. The backend lane (BE1) owns this file and replaces the body. The exported names
// and signatures below are what other lanes code against: keep them, or raise a contract question.
// =====================================================================================================
//
// src/lib/server/env.ts: the ONLY reader of APP_SIGNING_SECRET and CRON_SECRET (docs/SECURITY_MODEL.md
// invariant 15, docs/architecture.md "Environment variables"). Values are read lazily, on each call, so
// `next build` needs no secrets. Unset or shorter than 32 characters → EnvConfigError; nothing falls back
// to a default or empty key (S0 SEC-4). The error names the variable, never its value.
//
// Callers map EnvConfigError to: GET / fails, the formToken routes and POST /api/auth/sign-in answer 503
// service_unavailable, /api/jobs/* answer 401 (invariant 15).

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
