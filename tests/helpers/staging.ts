// tests/helpers/staging.ts: the staging-backed API tests' setup and cleanup. Staging is shared, so every row a test file
// creates is tracked and removed in afterAll, and afterAll then proves nothing it created is left.
//
// - The variables come from tests/helpers/staging-env.ts; when they are missing the file FAILS in beforeAll (never skips).
// - APP_SIGNING_SECRET and CRON_SECRET are random per test file (no secret lives in a fixture); the address hashes use that
//   secret, so one run's rows can never collide with another run's.
// - Quote requests are deleted through the service role (photos, jobs and events cascade). Spam refusal events hang off no
//   request and the service role cannot delete events, so those are deleted with psql on SUPABASE_STAGING_DB_URL (the URL is
//   passed as an argument only and never printed).
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, vi } from 'vitest';
import { getAdminClient } from '@/lib/server/admin';
import { issueFormToken } from '@/lib/server/form-token';
import { addressHash } from '@/lib/server/services/network';
import type { Database } from '@/types/database';
import { loadStagingEnv, stagingEnvProblem } from './staging-env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Direct SQL on the staging database, for the two things the API roles cannot do (delete events, read nothing else). */
function psql(sql: string): void {
  try {
    execFileSync('psql', [process.env.SUPABASE_STAGING_DB_URL ?? '', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (error) {
    // never the stderr or the command: they can hold connection details
    const status = typeof error === 'object' && error !== null && 'status' in error ? String((error as { status: unknown }).status) : 'unknown';
    throw new Error(`psql cleanup on the staging database failed (exit ${status})`);
  }
}

export type Staging = {
  secrets: { signing: string; cron: string };
  /** The service-role client (what the app's admin.ts builds). */
  db: () => SupabaseClient<Database>;
  /** A client with only the publishable key, like the homeowner's browser. */
  anon: () => SupabaseClient<Database>;
  /** A form token issued `ageMs` ago (default 10 s, past the 3 s time trap). */
  token: (ageMs?: number) => string;
  /** A random private IPv4 address for one test (tracked for cleanup); the hash is keyed by this file's random secret, so runs never collide. */
  address: () => string;
  /** Track a request id so afterAll deletes it and its files. */
  trackRequest: (id: string) => void;
  /** Track an address (as sent in x-real-ip) so afterAll deletes its counter rows and spam events. */
  trackAddress: (address: string) => void;
  /** Track a raw address hash (for rows a test inserts itself) so afterAll deletes its counter rows and spam events. */
  trackHash: (hash: string) => void;
  /** Track an event id (events the service role cannot delete) so afterAll deletes it with psql. */
  trackEvent: (id: string) => void;
  /** A valid createQuoteRequest body; overrides replace fields. */
  body: (overrides?: Record<string, unknown>) => Record<string, unknown>;
};

/** Call once per test file, at the top level of the file. */
export function setupStaging(): Staging {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

  const secrets = { signing: randomBytes(32).toString('hex'), cron: randomBytes(32).toString('hex') };
  const requestIds = new Set<string>();
  const addresses = new Set<string>();
  const rawHashes = new Set<string>();
  const eventIds = new Set<string>();
  const runId = randomBytes(4).toString('hex');
  let counter = 0;

  const db = () => getAdminClient();
  const publicEnv = () => ({ url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' });

  beforeAll(() => {
    loadStagingEnv();
    const problem = stagingEnvProblem();
    if (problem) throw new Error(problem); // a missing variable fails the file; nothing here skips
    vi.stubEnv('APP_SIGNING_SECRET', secrets.signing);
    vi.stubEnv('CRON_SECRET', secrets.cron);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  async function cleanup(): Promise<void> {
    const admin = db();
    const ids = [...requestIds].filter((id) => UUID.test(id));
    for (const id of ids) {
      const files = await admin.storage.from('quote-photos').list(id, { limit: 10 });
      const paths = (files.data ?? []).map((f) => `${id}/${f.name}`);
      if (paths.length > 0) await admin.storage.from('quote-photos').remove(paths);
    }
    if (ids.length > 0) {
      const removed = await admin.from('quote_requests').delete().in('id', ids);
      expect(removed.error).toBeNull();
    }

    const hashes = [...new Set([...[...addresses].map((a) => addressHash(a)), ...rawHashes])];
    const doomedEvents = new Set([...eventIds].filter((id) => UUID.test(id)));
    if (hashes.length > 0) {
      const windows = await admin.from('spam_refusal_windows').select('event_id').in('ip_hash', hashes);
      expect(windows.error).toBeNull();
      for (const w of windows.data ?? []) if (UUID.test(w.event_id)) doomedEvents.add(w.event_id);
    }
    if (doomedEvents.size > 0) psql(`delete from public.events where id in (${[...doomedEvents].map((id) => `'${id}'`).join(',')})`);
    if (hashes.length > 0) {
      const hits = await admin.from('rate_limit_hits').delete().in('ip_hash', hashes);
      expect(hits.error).toBeNull();
    }

    // proof of cleanup: nothing this file created is left
    if (doomedEvents.size > 0) {
      const eventsLeft = await admin.from('events').select('id').in('id', [...doomedEvents]);
      expect(eventsLeft.data ?? []).toHaveLength(0);
    }
    if (ids.length > 0) {
      const left = await admin.from('quote_requests').select('id').in('id', ids);
      expect(left.data ?? []).toHaveLength(0);
    }
    if (hashes.length > 0) {
      const hitsLeft = await admin.from('rate_limit_hits').select('id').in('ip_hash', hashes);
      const windowsLeft = await admin.from('spam_refusal_windows').select('id').in('ip_hash', hashes);
      expect(hitsLeft.data ?? []).toHaveLength(0);
      expect(windowsLeft.data ?? []).toHaveLength(0);
    }
  }

  return {
    secrets,
    db,
    anon: () => {
      const { url, key } = publicEnv();
      return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    },
    token: (ageMs = 10_000) => issueFormToken(Date.now() - ageMs),
    address: () => {
      const address = `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
      addresses.add(address);
      return address;
    },
    trackRequest: (id) => {
      requestIds.add(id);
    },
    trackAddress: (address) => {
      addresses.add(address);
    },
    trackHash: (hash) => {
      rawHashes.add(hash);
    },
    trackEvent: (id) => {
      eventIds.add(id);
    },
    body: (overrides = {}) => {
      counter += 1;
      return {
        name: 'Rehearsal Tester',
        phone: '416-555-0123',
        email: `be1.${runId}.${counter}@example.test`,
        address: '14 Test Street, Hamilton ON',
        problem: 'The test tap drips constantly under the sink',
        urgency: 'soon',
        marketing_consent: false,
        website: '',
        photos: [],
        ...overrides,
      };
    },
  };
}
