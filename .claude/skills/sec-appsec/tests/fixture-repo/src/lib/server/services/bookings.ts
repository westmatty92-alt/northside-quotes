import 'server-only';
// FIXTURE. Lines marked "expect:" must be flagged with that rule; all others must not.
import type { SupabaseClient } from '@supabase/supabase-js';

const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // expect: baseleap-service-role-key-outside-admin

export async function listAll(db: SupabaseClient) {
  return db.from('bookings').select('*'); // expect: baseleap-select-star
}

export async function listForUser(db: SupabaseClient) {
  return db.from('bookings').select('id, starts_at, status').limit(20);
}

export function weakToken() {
  return Math.random().toString(36).slice(2); // expect: baseleap-insecure-random-token
}

export function strongToken() {
  return crypto.randomUUID();
}

void key;
