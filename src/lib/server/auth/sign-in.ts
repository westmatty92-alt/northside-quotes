import 'server-only';

// src/lib/server/auth/sign-in.ts: POST /api/auth/sign-in (operation signIn; SECURITY_MODEL "Authentication and sessions",
// invariants 16, 19, 21; PRD FR-9 and ruling 4A; AC-004.4, AC-004.5, AC-004.11 to AC-004.13).
//
// Order of work, and why:
//   1. Validate the body (400 not an object, 422 field errors). Nothing is counted for a body that is refused here.
//   2. take_sign_in_attempt(email_hash, ip_hash): ONE database call that checks both pauses and records this attempt as a
//      failure up front (so parallel guesses count against each other). It runs BEFORE Supabase Auth. `allowed: false` is a
//      429 sign_in_paused with the same body for both limits and no Retry-After. ANY failure here (missing or short signing
//      secret, database error or timeout, an answer that is not the expected shape) is a 503 sign_in_unavailable and Auth is
//      never called: sign-in fails closed (AC-004.13, invariant 19).
//   3. Supabase Auth signInWithPassword through @supabase/ssr, which hands back the session cookies for the response.
//   4. The user must be staff (public.current_staff() under the new token). A signed-in user who is not staff is signed
//      out again and gets the same 401 as a wrong password; no cookie is sent.
//   5. Only for a staff sign-in: mark_sign_in_succeeded(attempt_id) and the staff_signed_in event. Both are best effort once
//      the person is signed in (an error is logged as { error_class, code } and never changes the answer).
//
// Email is hashed as HMAC-SHA256 of `email|v1|<trimmed, lower-cased email>`, the address as in SECURITY_MODEL "Network
// address" (services/network.ts, `ip|v1|unknown` when there is none). Hashes are the only thing stored; emails, passwords
// and addresses are never logged. One of the modules allowed to use the service-role client (invariant 2).
import { createServerClient } from '@supabase/ssr';
import { isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { StaffMember } from '@/lib/api/generated/model';
import { SignInBody } from '@/lib/api/generated/staff-auth/staff-auth.zod';
import { getAdminClient } from '@/lib/server/admin';
import { EnvConfigError, hmacHex } from '@/lib/server/env';
import { ProblemError, dbErrorFields, errorFields, fieldMessage, type FieldError } from '@/lib/server/http';
import { logLine } from '@/lib/server/log';
import { addressHash } from '@/lib/server/services/network';
import { authCookieOptions, createUserClient, publicSupabaseEnv } from '@/lib/server/supabase';
import type { Database } from '@/types/database';

/** One Set-Cookie the route must send, exactly as @supabase/ssr produced it. */
export type SessionCookie = { name: string; value: string; options: Record<string, unknown> };

export type SignInSuccess = {
  staff: StaffMember;
  cookies: SessionCookie[];
  /** Cache headers @supabase/ssr asks for on a response that sets session cookies. */
  headers: Record<string, string>;
};

const MESSAGES: Record<string, string> = {
  email: fieldMessage('email') ?? 'Enter a valid email address',
  password: 'Enter your password',
};

/** The sign-in answers that are not a success. The 503 is the contract's SignInUnavailable body. */
const unavailable = (errorClass: string, logCode = 'none') => new ProblemError(503, 'sign_in_unavailable', { errorClass, logCode });

function validationErrors(error: z.ZodError): FieldError[] {
  const seen = new Map<string, FieldError>();
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const field = key.slice(0, 60);
        if (!seen.has(field)) seen.set(field, { field, message: 'This field is not accepted' });
      }
      continue;
    }
    const first = issue.path[0];
    const field = typeof first === 'string' ? first : 'form';
    if (!seen.has(field)) seen.set(field, { field, message: MESSAGES[field] ?? 'Check this answer' });
  }
  return [...seen.values()];
}

/** The validated credentials: `email` trimmed and lower-cased (so the hash and Auth see the same text), password untouched. */
export function parseSignInBody(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ProblemError(400, 'bad_request');
  const input: Record<string, unknown> = { ...body };
  if (typeof input.email === 'string') input.email = input.email.trim();
  const parsed = SignInBody.strict().safeParse(input);
  if (!parsed.success) throw new ProblemError(422, 'validation_failed', { errors: validationErrors(parsed.error) });
  return { email: parsed.data.email.toLowerCase(), password: parsed.data.password };
}

/** Step 2. Throws the 429 or the 503; returns the id of the attempt it recorded. */
async function takeAttempt(email: string, clientAddress: string | null): Promise<string> {
  let emailHash: string;
  let ipHash: string;
  try {
    emailHash = hmacHex(`email|v1|${email}`);
    ipHash = addressHash(clientAddress);
  } catch (error) {
    // A missing or short APP_SIGNING_SECRET (invariant 15): name the variable, never a value.
    throw unavailable('EnvConfigError', error instanceof EnvConfigError ? error.variable : errorFields(error).code);
  }

  let result: Awaited<ReturnType<ReturnType<typeof getAdminClient>['rpc']>>;
  try {
    result = await getAdminClient().rpc('take_sign_in_attempt', { p_email_hash: emailHash, p_ip_hash: ipHash });
  } catch (error) {
    const failure = errorFields(error);
    throw unavailable(failure.error_class, failure.code);
  }
  if (result.error) throw unavailable('postgrest', dbErrorFields(result.error).code);

  const data = result.data as { allowed?: unknown; attempt_id?: unknown } | null;
  if (typeof data !== 'object' || data === null || typeof data.allowed !== 'boolean') throw unavailable('malformed_result');
  if (!data.allowed) throw new ProblemError(429, 'sign_in_paused'); // no Retry-After: its value would say which limit applied
  if (typeof data.attempt_id !== 'string' || data.attempt_id === '') throw unavailable('malformed_result');
  return data.attempt_id;
}

/** What a Supabase Auth failure means for the caller. Reads only the status and code, never the message. */
function authFailure(error: AuthError): ProblemError {
  const status = typeof error.status === 'number' ? error.status : 0;
  const log = { errorClass: error.name, logCode: typeof error.code === 'string' ? error.code : String(status) };
  if (status === 429) return new ProblemError(429, 'sign_in_paused', log); // Supabase's own limit, shown as the same pause
  if (isAuthRetryableFetchError(error) || status === 0 || status >= 500) return new ProblemError(503, 'sign_in_unavailable', log);
  return new ProblemError(401, 'invalid_credentials', log); // wrong password, unknown email, unconfirmed or banned: one answer
}

export async function signIn(input: { body: unknown; clientAddress: string | null }): Promise<SignInSuccess> {
  const { email, password } = parseSignInBody(input.body);
  const attemptId = await takeAttempt(email, input.clientAddress);

  // Session cookies are collected, not written: the route sends them only when sign-in fully succeeds.
  const cookies = new Map<string, SessionCookie>();
  const headers: Record<string, string> = {};
  const { url, anonKey } = publicSupabaseEnv();
  const supabase = createServerClient<Database>(url, anonKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => [],
      setAll(toSet, cacheHeaders) {
        for (const { name, value, options } of toSet) cookies.set(name, { name, value, options: { ...options } });
        Object.assign(headers, cacheHeaders);
      },
    },
  });
  /** Ends the session Auth just created (it must not outlive a refused sign-in). Best effort. */
  const revoke = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      /* the session was never given to the browser; nothing more to do */
    }
  };

  let auth: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
  try {
    auth = await supabase.auth.signInWithPassword({ email, password });
  } catch (error) {
    const failure = errorFields(error);
    throw unavailable(failure.error_class, failure.code);
  }
  if (auth.error) throw authFailure(auth.error);
  const { session, user } = auth.data;
  if (!session || !user) throw unavailable('no_session');

  const staffRow = await staffMember(session.access_token).catch(async (error: unknown) => {
    await revoke();
    throw error;
  });
  if (staffRow === null) {
    await revoke(); // signed in but not staff: signed out again, the same 401 as a wrong password, no cookie
    throw new ProblemError(401, 'invalid_credentials', { errorClass: 'not_staff', logCode: 'none' });
  }

  await markSucceeded(attemptId);
  await recordStaffSignedIn(staffRow.user_id);
  return { staff: staffRow, cookies: [...cookies.values()], headers };
}

/** public.current_staff() under the new token: the staff row for this session, or null. An error is a 503 (fail closed). */
async function staffMember(accessToken: string): Promise<StaffMember | null> {
  let result: Awaited<ReturnType<ReturnType<typeof createUserClient>['rpc']>>;
  try {
    result = await createUserClient(accessToken).rpc('current_staff');
  } catch (error) {
    const failure = errorFields(error);
    throw unavailable(failure.error_class, failure.code);
  }
  if (result.error) throw unavailable('postgrest', dbErrorFields(result.error).code);
  const row = (result.data as Array<{ user_id?: unknown; display_name?: unknown }> | null)?.[0];
  if (!row) return null;
  if (typeof row.user_id !== 'string' || typeof row.display_name !== 'string') throw unavailable('malformed_result');
  return { user_id: row.user_id, display_name: row.display_name };
}

/** mark_sign_in_succeeded(attempt_id): the attempt stops counting as a failure. Called only for a staff sign-in. */
async function markSucceeded(attemptId: string): Promise<void> {
  try {
    const { error } = await getAdminClient().rpc('mark_sign_in_succeeded', { p_attempt_id: attemptId });
    if (error) logLine('warn', { outcome: 'sign_in_not_marked', ...dbErrorFields(error) });
  } catch (error) {
    logLine('warn', { outcome: 'sign_in_not_marked', ...errorFields(error) });
  }
}

/** staff_signed_in (docs/metrics-spec.md): the internal user id only. Best effort. */
async function recordStaffSignedIn(userId: string): Promise<void> {
  try {
    const { error } = await getAdminClient()
      .from('events')
      .insert({ name: 'staff_signed_in', user_id: userId, properties: { user_id: userId } });
    if (error) logLine('warn', { outcome: 'staff_event_not_recorded', ...dbErrorFields(error) });
  } catch (error) {
    logLine('warn', { outcome: 'staff_event_not_recorded', ...errorFields(error) });
  }
}
