// tests/helpers/auth.ts: TEMPLATE (backend owns it). Test users per role on the test database, a session
// attached to a request, and cleanup. Points at the Supabase preview branch in real builds and at a
// throwaway local Supabase stack in dry runs (B16). It never runs against production.
//
// Env (names only; values come from the environment, never from files in the repo):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: the TEST project's values
//   SUPABASE_PROD_PROJECT_REF: the production project ref, so the guard can refuse it
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { Database } from '@/types/database';

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal']);

/** Same rule as supabase/scripts/db.mjs: refuse the production ref, and any remote host while the ref is unset. */
export function assertNotProduction(url = process.env.NEXT_PUBLIC_SUPABASE_URL, prodRef = process.env.SUPABASE_PROD_PROJECT_REF): string {
  if (!url) throw new Error('tests: NEXT_PUBLIC_SUPABASE_URL is not set (preview branch or local test stack)');
  const host = new URL(url).hostname;
  if (prodRef && url.includes(prodRef)) throw new Error('tests: refusing — the Supabase URL is the production project');
  if (!LOCAL.has(host) && !prodRef) throw new Error('tests: refusing a remote Supabase while SUPABASE_PROD_PROJECT_REF is unset');
  return url;
}

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`tests: ${name} is not set`);
  return v;
};

export function adminClient(): SupabaseClient<Database> {
  const url = assertNotProduction();
  return createClient<Database>(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}

export type TestUser = { id: string; email: string; accessToken: string; role: string };

/** Creates a confirmed user with a random email and signs it in. Run-unique so parallel runs never collide. */
export async function createTestUser(role: string, runId = crypto.randomUUID().slice(0, 8)): Promise<TestUser> {
  const admin = adminClient();
  const email = `test+${role}-${runId}@example.test`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) throw new Error(`tests: createUser failed: ${error?.message}`);
  const anon = createClient<Database>(assertNotProduction(), need('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !session.session) throw new Error(`tests: sign-in failed: ${signInError?.message}`);
  return { id: created.user.id, email, accessToken: session.session.access_token, role };
}

/** Attaches the user's session as the contract's bearer token. */
export function authed(req: NextRequest, user: TestUser): NextRequest {
  req.headers.set('authorization', `Bearer ${user.accessToken}`);
  return req;
}

/** Deletes the test users (rows that cascade from the tenant go with the tenant cleanup the project adds). */
export async function deleteTestUsers(users: TestUser[]): Promise<void> {
  const admin = adminClient();
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}

// Project-specific part (the backend fills this in from the architect's schema), for example:
//   export async function testTenant(roles: string[]) { create org (is_test = true) → users → team_members rows → return ids }
//   export async function cleanupTenant(t) { delete the org's rows → deleteTestUsers(t.users) }
