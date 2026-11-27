// src/lib/supabase/browser.ts: the browser Supabase clients (frontend lane).
//
//   getUploadClient()   a sessionless client for the homeowner's direct photo upload (`uploadQuotePhoto`): the
//                       publishable key only, no session stored, nothing refreshed. It can do only what the
//                       `quote-photos` insert policy allows the anon role.
//   getSessionClient()  the cookie-backed session client for staff sign-out and token refresh (used from FE2 on).
//
// Only NEXT_PUBLIC_* values are read here. They are named with literal `process.env.NAME` accesses so Next can
// inline them into the browser bundle, and they are checked with a schema when a client is first needed.
import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const envSchema = z.object({
  url: z.url(),
  anonKey: z.string().min(1),
});

function readEnv() {
  return envSchema.parse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

let uploadClient: SupabaseClient | undefined;
let sessionClient: SupabaseClient | undefined;

export function getUploadClient(): SupabaseClient {
  if (!uploadClient) {
    const { url, anonKey } = readEnv();
    uploadClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return uploadClient;
}

export function getSessionClient(): SupabaseClient {
  if (!sessionClient) {
    const { url, anonKey } = readEnv();
    sessionClient = createBrowserClient(url, anonKey);
  }
  return sessionClient;
}
