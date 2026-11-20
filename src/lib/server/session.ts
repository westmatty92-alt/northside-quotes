import 'server-only';

// src/lib/server/session.ts: session refresh for src/proxy.ts (A2 scaffold; backend lane owns it and the proxy).
// The proxy reads the @supabase/ssr cookies only to refresh the session and to redirect signed-out page visits
// to /sign-in?next=<path> (SECURITY_MODEL "Authentication and sessions"). It never authorises /api calls.
// A new server client is created for every request, as @supabase/ssr requires.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';
import { publicSupabaseEnv } from './supabase';

export type RefreshedSession = {
  /** The response to continue with: carries any refreshed auth cookies and their no-cache headers. */
  response: NextResponse;
  /** The signed-in user's id, or null when signed out. */
  userId: string | null;
};

/** Refreshes the Supabase session cookies for one proxied request. */
export async function refreshSession(request: NextRequest): Promise<RefreshedSession> {
  const { url, anonKey } = publicSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Must run before any response is produced, so a refreshed token is written to the cookies.
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return { response, userId: typeof sub === 'string' ? sub : null };
}
