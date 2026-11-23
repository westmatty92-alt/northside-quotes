// @vitest-environment node
// The GHL runner against the REAL staging database functions (claim_ghl_job, finish_ghl_job, find_ghl_contact_match,
// ghl_stage_for_request, the consent trigger) with the offline simulator standing in for GoHighLevel. No live GHL.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. They come from the process, or else from .env.local
// (this checkout, then the main checkout) through ../staging-env.ts. THIS SUITE NEVER SKIPS: when they are still
// missing, or the URL names production (SUPABASE_PROD_PROJECT_REF) or not staging (SUPABASE_STAGING_REF), every test
// here fails and the message names the variables (never values). A skipped run is not evidence.
// Every row created here is tracked by id and removed in afterAll (cascade removes jobs, events); afterAll then
// counts what is left for those ids and fails if it is not zero.
//
// Proves: AC-009.1 / AC-009.2 (copy stored and linked, success event), AC-009.9 / AC-009.12 / AC-009.13 / AC-017.16
// (unticked: no job, no call, never matched, never linked), AC-009.10 / AC-009.11 (same email, same phone: link, no
// create, no contact fields), AC-017.15 / AC-017.17 (last change wins, any run order), S0 SEC-7 (lease semantics the
// runner relies on), AC-009.3 (token missing), the retry backoff and `rejected` at once, and the seam itself.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminClient } from '@/lib/server/admin';
import { createGhlClient } from '@/lib/server/integrations/ghl/client';
import { runGhlJobs } from '@/lib/server/integrations/ghl';
import { runGhlJobsWith } from '@/lib/server/integrations/ghl/runner';
import { startGhlSimulator, type GhlSimulator } from '../../mocks/ghl/simulator.mjs';
import { loadStagingEnv, stagingEnvProblem } from '../staging-env';
import { simEnv } from './helpers';

// Fill in the env from .env.local when the process lacks it, then check it. getAdminClient reads the env lazily, so
// this runs before the first use. No skip: a problem fails the suite below.
loadStagingEnv();
const envProblem = stagingEnvProblem();

it('the staging database is configured and is not production', () => {
  expect(envProblem, envProblem).toBeUndefined();
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const RUN = randomUUID().slice(0, 8);
const created: string[] = [];
let counter = 0;
const usedPhones = new Set<string>();

const db = () => getAdminClient();
const quiet = () => undefined;

function uniquePhone(): string {
  for (;;) {
    const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    if (!usedPhones.has(phone)) {
      usedPhones.add(phone);
      return phone;
    }
  }
}

type SeedOptions = { consent: boolean; email?: string; phone?: string; name?: string };

/** A submitted request created through the real RPCs (what the public form does), tracked for cleanup. */
async function seed(options: SeedOptions): Promise<{ id: string; email: string; phone: string; name: string }> {
  counter += 1;
  const email = options.email ?? `int1-${RUN}-${counter}@example.test`;
  const phone = options.phone ?? uniquePhone();
  const name = options.name ?? `Int One${counter} Tester`;
  const started = await db().rpc('start_quote_request', {
    p_submission_key: randomUUID(),
    p_name: name,
    p_phone: phone,
    p_email: email,
    p_address: `${counter} Test Street, Hamilton`,
    p_problem: 'INT1 test request: a placeholder problem description',
    p_urgency: 'soon',
    p_photo_count: 0,
    p_ip_hash: null as unknown as string,
    p_marketing_consent: options.consent,
  });
  expect(started.error).toBeNull();
  const id = (started.data as { request_id: string }).request_id;
  created.push(id);
  const completed = await db().rpc('complete_quote_request', { p_request_id: id, p_photos: [] });
  expect(completed.error).toBeNull();
  return { id, email, phone, name };
}

/** What change_quote_request_status does for the database (that RPC needs a staff session, which a test lacks). */
async function changeStatus(id: string, to: 'new' | 'quoted' | 'won' | 'lost'): Promise<void> {
  const row = await db().from('quote_requests').select('marketing_consent').eq('id', id).single();
  expect(row.error).toBeNull();
  const upd = await db().from('quote_requests').update({ status: to, status_changed_at: 'now' }).eq('id', id);
  expect(upd.error).toBeNull();
  if (row.data?.marketing_consent) {
    const sup = await db()
      .from('ghl_sync_jobs')
      .update({ state: 'superseded', locked_until: null, lease_id: null })
      .eq('request_id', id)
      .eq('kind', 'stage_tag')
      .in('state', ['pending', 'waiting']);
    expect(sup.error).toBeNull();
    const ins = await db().from('ghl_sync_jobs').insert({ request_id: id, kind: 'stage_tag', target_status: to });
    expect(ins.error).toBeNull();
  }
}

async function jobs(id: string) {
  const { data, error } = await db().from('ghl_sync_jobs').select('*').eq('request_id', id).order('created_at');
  expect(error).toBeNull();
  return data ?? [];
}

async function requestRow(id: string) {
  const { data, error } = await db().from('quote_requests').select('ghl_contact_id, ghl_linked_at, name, status').eq('id', id).single();
  expect(error).toBeNull();
  return data!;
}

async function events(id: string) {
  const { data, error } = await db().from('events').select('name, properties').eq('request_id', id);
  expect(error).toBeNull();
  return data ?? [];
}

async function makeAllDue(id: string) {
  const { error } = await db().from('ghl_sync_jobs').update({ next_attempt_at: 'now' }).eq('request_id', id).in('state', ['pending', 'waiting']);
  expect(error).toBeNull();
}

let sim: GhlSimulator;
const run = (id: string, timeoutMs?: number) =>
  runGhlJobsWith({ requestId: id }, { client: createGhlClient({ env: simEnv(sim), ...(timeoutMs ? { timeoutMs } : {}) }), log: quiet });
const line = (c: { method: string; path: string }) => `${c.method} ${c.path.replace(/^\/contacts\/[^/]+\/tags$/, '/contacts/:id/tags')}`;
const callLines = () => sim.calls().map(line);

describe('GHL runner against the staging database and the simulator', () => {
  // a problem fails each test on its own (a throwing beforeAll would make vitest count them as skipped)
  beforeEach(() => {
    if (envProblem) throw new Error(envProblem);
  });
  beforeAll(async () => {
    // run-unique contact ids: rows of different tests in the shared staging database never share a contact id
    sim = await startGhlSimulator({ slowMs: 5_000, idPrefix: `i1x${RUN}c` });
  });
  afterAll(async () => {
    await sim?.close();
    if (envProblem) return;
    if (created.length > 0) {
      const removed = await db().from('quote_requests').delete().in('id', created);
      expect(removed.error).toBeNull();
    }
    // cleanup proof: nothing this run created is left (requests, and the jobs and events that cascade from them)
    for (const [table, column] of [
      ['quote_requests', 'id'],
      ['ghl_sync_jobs', 'request_id'],
      ['events', 'request_id'],
    ] as const) {
      const left = await db().from(table).select('*', { count: 'exact', head: true }).in(column, created);
      expect(left.error).toBeNull();
      expect({ table, left: left.count }).toEqual({ table, left: 0 });
    }
  });
  beforeEach(() => sim.reset());
  afterEach(() => vi.unstubAllEnvs());

  it('a ticked request: one copy job, the runner creates the contact, stores the link and the success event', async () => {
    const r = await seed({ consent: true });
    const before = await jobs(r.id);
    expect(before.map((j) => [j.kind, j.state])).toEqual([['contact_copy', 'pending']]);

    const result = await run(r.id);

    expect(result).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(callLines()).toEqual(['GET /contacts/search/duplicate', 'POST /contacts']);
    const contact = sim.contacts()[0]!;
    expect(contact).toMatchObject({ name: r.name, email: r.email, phone: `+1${r.phone}` });
    expect(contact.tags.sort()).toEqual(['quote-new', 'quote-request']);

    const row = await requestRow(r.id);
    expect(row.ghl_contact_id).toBe(contact.id);
    expect(row.ghl_linked_at).not.toBeNull();
    const [job] = await jobs(r.id);
    expect(job).toMatchObject({ state: 'succeeded', attempt_count: 1, lease_id: null, locked_until: null, last_error_class: null });
    const names = (await events(r.id)).map((e) => e.name);
    expect(names).toContain('ghl_sync_succeeded');
    expect(names).not.toContain('ghl_sync_attempt_failed');
  });

  it('an unticked request: no job exists, the runner makes zero calls, and the database refuses to queue one', async () => {
    const r = await seed({ consent: false });
    expect(await jobs(r.id)).toHaveLength(0);

    expect(await run(r.id)).toEqual({ claimed: 0, succeeded: 0, waiting: 0, failed: 0 });
    expect(sim.calls()).toHaveLength(0);

    const insert = await db().from('ghl_sync_jobs').insert({ request_id: r.id, kind: 'contact_copy' });
    expect(insert.error?.code).toBe('23514');
    const tagInsert = await db().from('ghl_sync_jobs').insert({ request_id: r.id, kind: 'stage_tag', target_status: 'won' });
    expect(tagInsert.error?.code).toBe('23514');
    expect(await jobs(r.id)).toHaveLength(0);

    // a status change of an unticked request queues nothing either (what the RPC does)
    await changeStatus(r.id, 'won');
    expect(await jobs(r.id)).toHaveLength(0);
    expect(await run(r.id)).toMatchObject({ claimed: 0 });
    expect(sim.calls()).toHaveLength(0);
    expect((await requestRow(r.id)).ghl_contact_id).toBeNull();
  });

  it('a second ticked request with the same email links to the first one\'s contact: no create, no contact fields (AC-009.10)', async () => {
    const first = await seed({ consent: true });
    await run(first.id);
    const contact = sim.contacts()[0]!;
    const calls = sim.calls().length;

    // a different name, address and phone, the same email in capitals: only the match rule ties them together
    const second = await seed({ consent: true, email: first.email.toUpperCase(), phone: uniquePhone() });
    const result = await run(second.id);

    expect(result).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    // our own database match: no GHL search, no create; tags only
    expect(sim.calls().slice(calls).map(line)).toEqual(['POST /contacts/:id/tags', 'DELETE /contacts/:id/tags']);
    expect(sim.contacts()).toHaveLength(1);
    // the contact still carries the first request's fields: the second request sent none
    expect(sim.contacts()[0]).toMatchObject({ name: contact.name, email: contact.email, phone: contact.phone, address1: contact.address1 });
    expect(second.name).not.toBe(first.name);
    expect([...sim.contacts()[0]!.tags].sort()).toEqual(['quote-new', 'quote-request']);
    expect((await requestRow(second.id)).ghl_contact_id).toBe(contact.id);
    expect((await events(second.id)).map((e) => e.name)).toContain('ghl_sync_succeeded');
  });

  it('the same phone with another email links the same way (AC-009.11)', async () => {
    const first = await seed({ consent: true });
    await run(first.id);
    const calls = sim.calls().length;

    const second = await seed({ consent: true, phone: first.phone });
    expect(await run(second.id)).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });

    expect(sim.contacts()).toHaveLength(1);
    expect(sim.calls().slice(calls).map(line)).toEqual(['POST /contacts/:id/tags', 'DELETE /contacts/:id/tags']);
    expect((await requestRow(second.id)).ghl_contact_id).toBe((await requestRow(first.id)).ghl_contact_id);
  });

  it('an unticked request with the same email is never matched, linked or sent, and cannot be linked by column check (AC-009.12, AC-009.13)', async () => {
    const first = await seed({ consent: true });
    await run(first.id);
    const calls = sim.calls().length;

    const unticked = await seed({ consent: false, email: first.email, phone: first.phone });
    expect(await jobs(unticked.id)).toHaveLength(0);
    expect(await run(unticked.id)).toMatchObject({ claimed: 0 });
    expect(sim.calls()).toHaveLength(calls);
    expect((await requestRow(unticked.id)).ghl_contact_id).toBeNull();

    const match = await db().rpc('find_ghl_contact_match', { p_request_id: unticked.id });
    expect(match.data).toBeNull();
    const stage = await db().rpc('ghl_stage_for_request', { p_request_id: unticked.id });
    expect(stage.data).toBeNull();
    const link = await db().from('quote_requests').update({ ghl_contact_id: 'abc123', ghl_linked_at: new Date().toISOString() }).eq('id', unticked.id);
    expect(link.error?.code).toBe('23514');

    // and it does not take part in "last change wins": it changes last, the contact keeps the ticked request's stage
    await changeStatus(unticked.id, 'lost');
    await changeStatus(first.id, 'quoted');
    expect(await run(first.id)).toMatchObject({ claimed: 1, succeeded: 1 });
    expect([...sim.contacts()[0]!.tags].sort()).toEqual(['quote-quoted', 'quote-request']);
  });

  it('last change wins on a shared contact, whatever order the jobs run in (AC-017.15, AC-017.17)', async () => {
    const a = await seed({ consent: true });
    await run(a.id);
    const b = await seed({ consent: true, email: a.email });
    await run(b.id);
    const contact = sim.contacts()[0]!;
    expect((await requestRow(a.id)).ghl_contact_id).toBe(contact.id);
    expect((await requestRow(b.id)).ghl_contact_id).toBe(contact.id);

    // the owner adds a tag of their own in GHL
    const res = await fetch(`${sim.url}/contacts/${contact.id}/tags`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sim.token}`, Version: 'v3', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['vip'] }),
    });
    expect(res.ok).toBe(true);

    await changeStatus(a.id, 'quoted'); // earlier
    await changeStatus(b.id, 'lost'); // later: wins
    await run(b.id); // the later change runs first ...
    expect([...sim.contacts()[0]!.tags].sort()).toEqual(['quote-lost', 'quote-request', 'vip']);
    await run(a.id); // ... and the late job of the earlier change must not put quote-quoted back
    expect([...sim.contacts()[0]!.tags].sort()).toEqual(['quote-lost', 'quote-request', 'vip']);
    expect((await jobs(a.id)).filter((j) => j.kind === 'stage_tag').map((j) => j.state)).toEqual(['succeeded']);

    // and a newer change on the other request takes the stage over: the contact ends with exactly one stage tag
    await changeStatus(a.id, 'won');
    await run(a.id);
    expect([...sim.contacts()[0]!.tags].sort()).toEqual(['quote-request', 'quote-won', 'vip']);
  });

  it('a stage-tag job waits for its contact copy without counting an attempt, then both run (FR-24)', async () => {
    const r = await seed({ consent: true });
    sim.setMode('500');
    expect(await run(r.id)).toEqual({ claimed: 1, succeeded: 0, waiting: 1, failed: 0 }); // copy fails once, retry in 5 minutes
    await changeStatus(r.id, 'quoted');
    const calls = sim.calls().length;

    const waiting = await run(r.id); // the copy is not due, the stage-tag job is
    expect(waiting).toEqual({ claimed: 1, succeeded: 0, waiting: 1, failed: 0 });
    expect(sim.calls()).toHaveLength(calls); // no GHL call for a job that only waits
    const tag = (await jobs(r.id)).find((j) => j.kind === 'stage_tag')!;
    expect(tag).toMatchObject({ state: 'waiting', attempt_count: 0 });

    sim.setMode('ok');
    await makeAllDue(r.id);
    expect(await run(r.id)).toEqual({ claimed: 2, succeeded: 2, waiting: 0, failed: 0 });
    expect([...sim.contacts()[0]!.tags].sort()).toEqual(['quote-quoted', 'quote-request']);
    expect((await events(r.id)).map((e) => e.name)).toEqual(expect.arrayContaining(['ghl_sync_attempt_failed', 'ghl_sync_succeeded', 'ghl_tag_sync_succeeded']));
  });

  it('a 5xx schedules the retry (5 minutes, class recorded); a 422 fails at once with no retry', async () => {
    const down = await seed({ consent: true });
    sim.setMode('500');
    await run(down.id);
    const [retry] = await jobs(down.id);
    expect(retry).toMatchObject({ state: 'waiting', attempt_count: 1, last_error_class: 'server_error', lease_id: null });
    // both timestamps come from the database's now() in one statement: exactly the first backoff step of 5 minutes
    expect(new Date(retry!.next_attempt_at).getTime() - new Date(retry!.last_attempt_at!).getTime()).toBe(5 * 60_000);
    const failEvent = (await events(down.id)).find((e) => e.name === 'ghl_sync_attempt_failed');
    expect(failEvent?.properties).toMatchObject({ attempt_number: 1, error_class: 'server_error' });

    const refused = await seed({ consent: true });
    sim.setMode('unprocessable');
    await run(refused.id);
    const [failed] = await jobs(refused.id);
    expect(failed).toMatchObject({ state: 'failed', attempt_count: 1, last_error_class: 'rejected' });
    expect((await events(refused.id)).map((e) => e.name)).not.toContain('ghl_sync_gave_up');
  });

  it('a timeout (lost reply) keeps the request intact and the next attempt links the contact it created: one contact (AC-009.4)', async () => {
    const r = await seed({ consent: true });
    sim.queueModes(['ok', 'lost_reply']);
    await run(r.id, 200);
    expect((await jobs(r.id))[0]).toMatchObject({ state: 'waiting', last_error_class: 'timeout' });
    expect(sim.contacts()).toHaveLength(1);

    await makeAllDue(r.id);
    expect(await run(r.id)).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(sim.contacts()).toHaveLength(1);
    expect((await requestRow(r.id)).ghl_contact_id).toBe(sim.contacts()[0]!.id);
  });

  it('lease semantics the runner relies on: an expired lease re-claimed by another runner makes the first one\'s result a no-op (SEC-7)', async () => {
    const r = await seed({ consent: true });
    const [job] = await jobs(r.id);

    const first = await db().rpc('claim_ghl_job', { p_request_id: r.id });
    const l1 = first.data![0]!.lease_id!;
    expect(l1).toBeTruthy();
    // while leased, the runner finds nothing to claim
    expect(await run(r.id)).toMatchObject({ claimed: 0 });

    // the lease runs out and another runner claims the job
    await db().from('ghl_sync_jobs').update({ locked_until: new Date(Date.now() - 1_000).toISOString() }).eq('id', job!.id);
    const second = await db().rpc('claim_ghl_job', { p_request_id: r.id });
    const l2 = second.data![0]!.lease_id!;
    expect(l2).not.toBe(l1);

    // the first runner finally settles with its old lease: ignored, the row comes back still leased by the other
    const stale = await db().rpc('finish_ghl_job', { p_job_id: job!.id, p_lease_id: l1, p_outcome: 'succeeded', p_contact_id: 'stalecontact' });
    expect(stale.error).toBeNull();
    expect(stale.data).toMatchObject({ state: 'pending', lease_id: l2 });
    expect((await requestRow(r.id)).ghl_contact_id).toBeNull();
    expect((await events(r.id)).map((e) => e.name)).not.toContain('ghl_sync_succeeded');

    // a missing lease is ignored too, and the current lease settles
    const none = await db().rpc('finish_ghl_job', { p_job_id: job!.id, p_lease_id: null as unknown as string, p_outcome: 'succeeded' });
    expect(none.data).toMatchObject({ state: 'pending', lease_id: l2 });
    const ok = await db().rpc('finish_ghl_job', { p_job_id: job!.id, p_lease_id: l2, p_outcome: 'abandon' });
    expect(ok.data).toMatchObject({ state: 'failed', lease_id: null });
  });

  it('a job superseded by a newer status change drops its lease: the old runner\'s result comes back as superseded', async () => {
    const r = await seed({ consent: true });
    await run(r.id);
    await changeStatus(r.id, 'quoted');
    const claimed = await db().rpc('claim_ghl_job', { p_request_id: r.id });
    const row = claimed.data![0]!;
    expect(row.kind).toBe('stage_tag');

    await changeStatus(r.id, 'won'); // supersedes the leased push

    const late = await db().rpc('finish_ghl_job', { p_job_id: row.id, p_lease_id: row.lease_id!, p_outcome: 'succeeded' });
    expect(late.data).toMatchObject({ state: 'superseded', lease_id: null });
    expect((await events(r.id)).filter((e) => e.name === 'ghl_tag_sync_succeeded')).toHaveLength(0);
  });

  it('the seam runGhlJobs() runs the real runner with the client built from the environment (no token: failed at once, no call)', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('GHL_API_BASE_URL', sim.url);
    vi.stubEnv('GHL_LOCATION_ID', sim.locationId);

    const withToken = await seed({ consent: true });
    vi.stubEnv('GHL_PRIVATE_INTEGRATION_TOKEN', sim.token);
    expect(await runGhlJobs({ requestId: withToken.id })).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(sim.callsTo('POST', '/contacts')).toHaveLength(1);

    const noToken = await seed({ consent: true });
    vi.stubEnv('GHL_PRIVATE_INTEGRATION_TOKEN', undefined);
    const calls = sim.calls().length;
    expect(await runGhlJobs({ requestId: noToken.id })).toEqual({ claimed: 1, succeeded: 0, waiting: 0, failed: 1 });
    expect(sim.calls()).toHaveLength(calls);
    expect((await jobs(noToken.id))[0]).toMatchObject({ state: 'failed', attempt_count: 1, last_error_class: 'config_missing' });
    const failure = (await events(noToken.id)).find((e) => e.name === 'ghl_sync_attempt_failed');
    expect(failure?.properties).toMatchObject({ error_class: 'config_missing' });
    expect(JSON.stringify(failure)).not.toContain(sim.token);

    // an unticked request through the seam: nothing at all
    const unticked = await seed({ consent: false });
    expect(await runGhlJobs({ requestId: unticked.id })).toEqual({ claimed: 0, succeeded: 0, waiting: 0, failed: 0 });
  });
});
