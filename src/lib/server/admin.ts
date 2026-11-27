import 'server-only';

// src/lib/server/admin.ts: the ONLY service-role entry point (docs/SECURITY_MODEL.md invariant 2).
// Created by the A2 scaffold; edited only by the backend lane. Every importer must be listed in invariant 2
// (`node scripts/check-code-guards.mjs service-role` enforces it). The service-role client bypasses RLS:
// use it only for the server operations the permission matrix gives to "Server (service role, named modules)".
//
// The environment is read lazily, on first use, so `next build` needs no secrets.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

let adminClient: SupabaseClient<Database> | undefined;

export class AdminClientConfigError extends Error {
  constructor() {
    super('The Supabase service-role client is not configured.');
    this.name = 'AdminClientConfigError';
  }
}

/** The service-role Supabase client (server only, bypasses RLS). Throws when its env vars are missing. */
export function getAdminClient(): SupabaseClient<Database> {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new AdminClientConfigError();
  adminClient = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient;
}
