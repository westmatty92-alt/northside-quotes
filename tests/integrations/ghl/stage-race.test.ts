// @vitest-environment node
// REV-1: two overlapping runners must leave the GHL contact on the stage of the MOST RECENT change, whatever
// order or speed they run in. The lease protects the database settle only; these tests look at the contact itself.
// Offline: the in-memory store plus the simulator, whose `slow` mode applies a call late (after `slowMs`).
// Proves: AC-017.6 and AC-017.15 ("the most recent change wins") on the provider side, for a stage-tag job, for
// two requests that share one contact, and for the contact copy's link to an existing contact.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGhlClient } from '@/lib/server/integrations/ghl/client';
import { MAX_STAGE_PASSES } from '@/lib/server/integrations/ghl/process-job';
import { runGhlJobsWith } from '@/lib/server/integrations/ghl/runner';
import { startGhlSimulator, type GhlSimulator } from '../../mocks/ghl/simulator.mjs';
import { FakeStore, makeJob, makeRequest, simEnv } from './helpers';

let sim: GhlSimulator;
beforeAll(async () => {
  sim = await startGhlSimulator({ slowMs: 600 });
});
afterAll(async () => {
  await sim.close();
});
beforeEach(() => sim.reset());

const quiet = () => undefined;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

const tagsOf = (contactId: string) => [...(sim.contacts().find((c) => c.id === contactId)?.tags ?? [])].sort();

/** A contact that carries `quote-new` and an owner tag of its own. */
const seed = () => sim.seedContact({ name: 'Zora Quillfeather', email: 'zora.quillfeather@example.test', tags: ['quote-request', 'quote-new', 'vip'] });

describe('a slow earlier stage-tag job never overwrites a newer stage (REV-1)', () => {
  // Which of runner A's two calls is slow: the add (first) or the remove (second).
  it.each([['first', 1], ['second', 2]] as const)('A reads "quoted" and is slow on its %s call; B reads "won" and finishes first', async (which, callsBeforeChange) => {
    const contactId = seed();
    const store = new FakeStore();
    const request = makeRequest({ status: 'quoted', ghl_contact_id: contactId });
    const jobA = store.add(request, makeJob(request, 'stage_tag', { target_status: 'quoted' }));
    const jobB = makeJob(request, 'stage_tag', { target_status: 'won' });
    store.queue.push(jobB);
    store.stages.set(request.id, 'quoted');
    // The database drops A's lease when the status changes: A's settle will be ignored, its calls still happen.
    store.settleOverride = (job) => (job.id === jobA.id ? { state: 'superseded', lease_id: null } : { state: 'succeeded', lease_id: null });
    sim.queueModes(which === 'first' ? ['slow'] : ['ok', 'slow']);
    const client = createGhlClient({ env: simEnv(sim) });

    const runA = runGhlJobsWith({ jobId: jobA.id }, { store, client, log: quiet });
    await until(() => sim.calls().length >= callsBeforeChange, 'runner A to send its calls');

    store.stages.set(request.id, 'won'); // the owner drags the card on to Won while A is still talking to GHL
    await runGhlJobsWith({ jobId: jobB.id }, { store, client, log: quiet });
    expect(tagsOf(contactId)).toEqual(['quote-request', 'quote-won', 'vip']); // B is done; A has not landed its slow call yet

    await runA; // A's slow call lands now
    expect(tagsOf(contactId)).toEqual(['quote-request', 'quote-won', 'vip']);
  });

  it('two requests that share one contact: the older request\'s slow job cannot undo the newer change (AC-017.15)', async () => {
    const contactId = seed();
    const store = new FakeStore();
    const first = makeRequest({ status: 'quoted', ghl_contact_id: contactId, email: 'zora.quillfeather@example.test' });
    const second = makeRequest({ status: 'new', ghl_contact_id: contactId, email: 'zora.quillfeather@example.test' });
    const jobA = store.add(first, makeJob(first, 'stage_tag', { target_status: 'quoted' }));
    const jobB = store.add(second, makeJob(second, 'stage_tag', { target_status: 'won' }));
    // Last change wins across both requests, so both read the same answer for the contact.
    store.stages.set(first.id, 'quoted');
    store.stages.set(second.id, 'quoted');
    sim.queueModes(['slow']);
    const client = createGhlClient({ env: simEnv(sim) });

    const runA = runGhlJobsWith({ jobId: jobA.id }, { store, client, log: quiet });
    await until(() => sim.calls().length >= 1, 'runner A to send its first call');

    store.stages.set(first.id, 'won'); // the second request moves to Won: it is now the most recent change
    store.stages.set(second.id, 'won');
    await runGhlJobsWith({ jobId: jobB.id }, { store, client, log: quiet });
    await runA;

    expect(tagsOf(contactId)).toEqual(['quote-request', 'quote-won', 'vip']);
  });
});

describe('linking an existing contact keeps up with a status change made during the calls (REV-1, link())', () => {
  it('the request moves to Won while its copy is linking: the contact ends on Won, not on the stage read first', async () => {
    const contactId = seed();
    const store = new FakeStore();
    const request = makeRequest({ status: 'quoted' });
    const job = store.add(request, makeJob(request, 'contact_copy'));
    store.matches.set(request.id, contactId);
    store.stages.set(request.id, 'quoted');
    sim.queueModes(['slow']);
    const client = createGhlClient({ env: simEnv(sim) });

    const run = runGhlJobsWith({ jobId: job.id }, { store, client, log: quiet });
    await until(() => sim.calls().length >= 1, 'the link to send its first call');
    store.stages.set(request.id, 'won');
    const result = await run;

    expect(result).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'succeeded', contactId });
    expect(tagsOf(contactId)).toEqual(['quote-request', 'quote-won', 'vip']);
  });
});

describe('the check after the calls costs nothing when nothing moved, and is bounded when everything moves', () => {
  it('a stage that holds still: the same two provider calls as before, one extra database read, success', async () => {
    const contactId = seed();
    const store = new FakeStore();
    const request = makeRequest({ status: 'quoted', ghl_contact_id: contactId });
    const job = store.add(request, makeJob(request, 'stage_tag', { target_status: 'quoted' }));
    let reads = 0;
    const read = store.stageFor.bind(store);
    store.stageFor = async (id) => {
      reads += 1;
      return read(id);
    };

    const result = await runGhlJobsWith({ jobId: job.id }, { store, client: createGhlClient({ env: simEnv(sim) }), log: quiet });

    expect(result).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(reads).toBe(2); // before the calls and after them
    expect(sim.calls().map((c) => c.method)).toEqual(['POST', 'DELETE']);
    expect(tagsOf(contactId)).toEqual(['quote-quoted', 'quote-request', 'vip']);
  });

  it('a stage that never holds still: at most MAX_STAGE_PASSES passes, then a retry (not a success) with code stage_moving', async () => {
    const contactId = seed();
    const store = new FakeStore();
    const request = makeRequest({ status: 'new', ghl_contact_id: contactId });
    const job = store.add(request, makeJob(request, 'stage_tag', { target_status: 'new' }));
    const answers = ['quoted', 'won', 'lost', 'new', 'quoted', 'won']; // a different answer on every read
    let n = 0;
    store.stageFor = async () => answers[n++ % answers.length] ?? null;
    const entries: Array<Record<string, unknown>> = [];

    const result = await runGhlJobsWith({ jobId: job.id }, { store, client: createGhlClient({ env: simEnv(sim) }), log: (e) => entries.push({ ...e }) });

    expect(result).toEqual({ claimed: 1, succeeded: 0, waiting: 1, failed: 0 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'retry', errorClass: 'server_error' });
    expect(entries.find((e) => e.outcome === 'waiting')).toMatchObject({ error_class: 'server_error', code: 'stage_moving' });
    expect(sim.calls()).toHaveLength(2 * MAX_STAGE_PASSES);
    expect(n).toBe(MAX_STAGE_PASSES + 1); // the first read, then one after every pass
  });
});
