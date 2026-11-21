import 'server-only';

// src/lib/server/supabase.ts: user-scoped Supabase clients for route handlers (A2 scaffold; backend lane).
// Route handlers authenticate from the bearer token only, never from cookies (SECURITY_MODEL "API authentication"),
// so this client carries the caller's access token and every query runs under RLS as that user.
// The environment is read lazily, on first use, so `next build` needs no secrets.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export class SupabaseConfigError extends Error {
  constructor() {
    super('The Supabase URL or publishable key is not configured.');
    this.name = 'SupabaseConfigError';
  }
}

/** NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (public values), validated on first use. */
export function publicSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new SupabaseConfigError();
  return { url, anonKey };
}

/**
 * The attributes of the Supabase session cookies (contract, signIn: "httpOnly false so the browser client can read the
 * access token; Secure; SameSite Lax"). Used by the sign-in route and by the proxy's session refresh, so both write the same
 * cookie. `Secure` is on everywhere except `next dev`, where the app is served over plain http.
 */
export function authCookieOptions(): { path: string; sameSite: 'lax'; httpOnly: false; secure: boolean } {
  return { path: '/', sameSite: 'lax', httpOnly: false, secure: process.env.NODE_ENV !== 'development' };
}

/** A Supabase client that acts as the user who owns `accessToken` (RLS applies). One per request. */
export function createUserClient(accessToken: string): SupabaseClient<Database> {
  const { url, anonKey } = publicSupabaseEnv();
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
