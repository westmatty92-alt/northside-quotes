// @vitest-environment node
// The contact copy (match rule, create, link) and the stage tags, run through the real runner and the real client
// against the offline simulator, with an in-memory job store. The real database functions are covered in db.test.ts.
// Proves: AC-009.1 (create with fields and tags), AC-009.4 (lost reply: one contact), AC-009.5 / AC-009.10 / AC-009.11 /
// AC-017.14 (linking sends tags only, no contact fields, no create), AC-009.9 / AC-017.16 (unticked: zero calls),
// AC-017.3 / AC-017.7 (stage tag at create), AC-017.8 (one stage tag at a time, quote-request kept, owner tags kept),
// and the 400-on-create decision of docs/integration-contract.md "When the platform is down".
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGhlClient, type GhlClient } from '@/lib/server/integrations/ghl/client';
import { runGhlJobsWith } from '@/lib/server/integrations/ghl/runner';
import { startGhlSimulator, type GhlSimulator } from '../../mocks/ghl/simulator.mjs';
import { FakeStore, forbiddenClient, HOMEOWNER, makeJob, makeRequest, simEnv } from './helpers';

let sim: GhlSimulator;
beforeAll(async () => {
  sim = await startGhlSimulator({ slowMs: 5_000 });
});
afterAll(async () => {
  await sim.close();
});
beforeEach(() => sim.reset());

const quiet = () => undefined;
const clientFor = (timeoutMs?: number): GhlClient => createGhlClient({ env: simEnv(sim), ...(timeoutMs ? { timeoutMs } : {}) });
const callLines = () => sim.calls().map((c) => `${c.method} ${c.path.replace(/simcontact\d+/, ':id')}`);
const bodyOf = (method: string, prefix: string, n = 0) => sim.callsTo(method, prefix)[n]?.body as Record<string, unknown>;

describe('contact copy: create', () => {
  it('searches, then creates with the mapped fields plus quote-request and the stage tag of the status now', async () => {
    const store = new FakeStore();
    const request = makeRequest({ status: 'quoted' });
    const job = store.add(request);

    const result = await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect(result).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(callLines()).toEqual(['GET /contacts/search/duplicate', 'POST /contacts']);
    expect(bodyOf('POST', '/contacts')).toEqual({
      locationId: sim.locationId,
      name: HOMEOWNER.name,
      firstName: 'Zora',
      lastName: 'Quillfeather',
      phone: '+14165550142',
      email: HOMEOWNER.email,
      address1: HOMEOWNER.address,
      tags: ['quote-request', 'quote-quoted'],
    });
    const contact = sim.contacts()[0];
    expect(contact?.tags.sort()).toEqual(['quote-quoted', 'quote-request']);
    // settled with THE LEASE of this claim, and the contact id is handed to finish_ghl_job
    expect(store.finished).toHaveLength(1);
    expect(store.finished[0]?.job.lease_id).toBe(job.lease_id);
    expect(store.finished[0]?.settle).toEqual({ outcome: 'succeeded', contactId: contact?.id });
  });

  it('a create that timed out but was applied: the next attempt finds the contact and links it, one contact (AC-009.4)', async () => {
    const store = new FakeStore();
    const request = makeRequest();
    store.add(request);

    sim.queueModes(['ok', 'lost_reply']); // search finds nothing, create is applied and never answered
    const first = await runGhlJobsWith({}, { store, client: clientFor(200), log: quiet });
    expect(first).toEqual({ claimed: 1, succeeded: 0, waiting: 1, failed: 0 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'retry', errorClass: 'timeout' });
    expect(sim.contacts()).toHaveLength(1);
    const createdId = sim.contacts()[0]?.id;

    // the retry, 5 minutes later in real life: a new claim, a new lease
    store.queue.push(makeJob(request, 'contact_copy', { attempt_count: 1 }));
    const before = sim.calls().length;
    const second = await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect(second).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(sim.contacts()).toHaveLength(1);
    const retryCalls = sim.calls().slice(before).map((c) => `${c.method} ${c.path.replace(/simcontact\d+/, ':id')}`);
    expect(retryCalls).toEqual(['GET /contacts/search/duplicate', 'POST /contacts/:id/tags', 'DELETE /contacts/:id/tags']);
    expect(store.finished[1]?.settle).toEqual({ outcome: 'succeeded', contactId: createdId });
  });
});

describe('contact copy: link to a contact the homeowner already has (tags only)', () => {
  const seedOwnerContact = () =>
    sim.seedContact({
      name: 'Name As Edited In GHL',
      email: 'edited-in-ghl@example.test',
      phone: '+19055550000',
      address1: 'An address edited in GHL',
      tags: ['quote-request', 'quote-won', 'vip'],
    });

  it('our own database match: no search, no create, no contact field; adds the stage tag and removes the other three only', async () => {
    const contactId = seedOwnerContact();
    const store = new FakeStore();
    const request = makeRequest({ status: 'new' });
    store.add(request);
    store.matches.set(request.id, contactId);

    const result = await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect(result).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(callLines()).toEqual(['POST /contacts/:id/tags', 'DELETE /contacts/:id/tags']);
    expect(bodyOf('POST', '/contacts/')).toEqual({ tags: ['quote-request', 'quote-new'] });
    expect(bodyOf('DELETE', '/contacts/')).toEqual({ tags: ['quote-quoted', 'quote-won', 'quote-lost'] });
    // the contact's fields are exactly what the owner left (AC-009.5, AC-017.14); the owner's own tag is kept
    expect(sim.contacts()[0]).toMatchObject({
      name: 'Name As Edited In GHL',
      email: 'edited-in-ghl@example.test',
      phone: '+19055550000',
      address1: 'An address edited in GHL',
    });
    expect([...(sim.contacts()[0]?.tags ?? [])].sort()).toEqual(['quote-new', 'quote-request', 'vip']);
    expect(store.finished[0]?.settle).toEqual({ outcome: 'succeeded', contactId });
  });

  it('the stage comes from ghl_stage_for_request, not from the request alone (last change wins)', async () => {
    const contactId = seedOwnerContact();
    const store = new FakeStore();
    const request = makeRequest({ status: 'new' });
    store.add(request);
    store.matches.set(request.id, contactId);
    store.stages.set(request.id, 'lost');

    await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect(bodyOf('POST', '/contacts/')).toEqual({ tags: ['quote-request', 'quote-lost'] });
    expect([...(sim.contacts()[0]?.tags ?? [])].sort()).toEqual(['quote-lost', 'quote-request', 'vip']);
  });

  it('GHL duplicate search found it: link, no create, no contact field', async () => {
    const contactId = sim.seedContact({ name: 'Edited', email: HOMEOWNER.email.toUpperCase(), phone: '+19055550000', tags: [] });
    const store = new FakeStore();
    store.add(makeRequest());

    const result = await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect(result.succeeded).toBe(1);
    expect(callLines()).toEqual(['GET /contacts/search/duplicate', 'POST /contacts/:id/tags', 'DELETE /contacts/:id/tags']);
    expect(sim.calls().some((c) => c.method === 'POST' && c.path === '/contacts')).toBe(false);
    expect(sim.contacts()).toHaveLength(1);
    expect(sim.contacts()[0]).toMatchObject({ name: 'Edited', phone: '+19055550000' });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'succeeded', contactId });
  });

  it('a contact id from our database that is not URL-safe fails as server_error, with no call', async () => {
    const store = new FakeStore();
    const request = makeRequest();
    store.add(request);
    store.matches.set(request.id, '../../etc');
    const result = await runGhlJobsWith({}, { store, client: forbiddenClient(), log: quiet });
    expect(result).toEqual({ claimed: 1, succeeded: 0, waiting: 1, failed: 0 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'retry', errorClass: 'server_error' });
  });
});

describe('contact copy: GHL answers 400 to the create (decision of the contract)', () => {
  it('a refused duplicate: the search is repeated once, finds the contact, and the attempt links it', async () => {
    // GHL holds a contact the first search cannot see yet (index lag); the create is refused as a duplicate (400);
    // the lag is over by the second search in the same attempt.
    sim.configure({ searchLag: true });
    const contactId = sim.seedContact({ name: 'Existing', email: HOMEOWNER.email, phone: '+14165550142', tags: [] });
    const store = new FakeStore();
    store.add(makeRequest());
    const real = clientFor();
    const client: GhlClient = {
      ...real,
      createContact: async (input) => {
        try {
          return await real.createContact(input);
        } finally {
          sim.flushSearchIndex();
        }
      },
    };

    const result = await runGhlJobsWith({}, { store, client, log: quiet });

    expect(result).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(callLines()).toEqual([
      'GET /contacts/search/duplicate',
      'POST /contacts',
      'GET /contacts/search/duplicate',
      'POST /contacts/:id/tags',
      'DELETE /contacts/:id/tags',
    ]);
    expect(sim.contacts()).toHaveLength(1);
    expect(store.finished[0]?.settle).toEqual({ outcome: 'succeeded', contactId });
  });

  it('a 400 that is not a duplicate: the repeated search finds nothing, the attempt is rejected and fails at once', async () => {
    sim.queueModes(['ok', 'badrequest', 'ok']); // search none, create 400, search none
    const store = new FakeStore();
    store.add(makeRequest());

    const result = await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect(result).toEqual({ claimed: 1, succeeded: 0, waiting: 0, failed: 1 });
    expect(callLines()).toEqual(['GET /contacts/search/duplicate', 'POST /contacts', 'GET /contacts/search/duplicate']);
    expect(store.finished[0]?.settle).toEqual({ outcome: 'failed', errorClass: 'rejected' });
  });

  it('a 400 on a tag call is rejected at once, without a second search', async () => {
    const contactId = sim.seedContact({ email: 'x@example.test', phone: '+14165550103', tags: [] });
    sim.queueModes(['badrequest']);
    const store = new FakeStore();
    const request = makeRequest();
    store.add(request);
    store.matches.set(request.id, contactId);

    const result = await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect(result.failed).toBe(1);
    expect(store.finished[0]?.settle).toEqual({ outcome: 'failed', errorClass: 'rejected' });
    expect(callLines()).toEqual(['POST /contacts/:id/tags']);
  });

  it('a contact deleted in GHL (404 on the tag call) is rejected, never recreated', async () => {
    const store = new FakeStore();
    const request = makeRequest();
    store.add(request);
    store.matches.set(request.id, 'deletedincontactid');

    const result = await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect(result.failed).toBe(1);
    expect(store.finished[0]?.settle).toEqual({ outcome: 'failed', errorClass: 'rejected' });
    expect(sim.calls().some((c) => c.method === 'POST' && c.path === '/contacts')).toBe(false);
  });
});

describe('consent: an unticked request never causes a call (ruling 1B)', () => {
  it('a copy job for an unticked request (which the trigger forbids) still makes zero calls', async () => {
    const store = new FakeStore();
    store.add(makeRequest({ marketing_consent: false }));
    const result = await runGhlJobsWith({}, { store, client: forbiddenClient(), log: quiet });
    expect(result).toEqual({ claimed: 1, succeeded: 0, waiting: 0, failed: 1 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'abandon' });
    expect(sim.calls()).toHaveLength(0);
  });

  it('a stage-tag job for an unticked request makes zero calls, even with a contact id on the row', async () => {
    const store = new FakeStore();
    const request = makeRequest({ marketing_consent: false, ghl_contact_id: 'abc123' });
    store.add(request, makeJob(request, 'stage_tag'));
    await runGhlJobsWith({}, { store, client: forbiddenClient(), log: quiet });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'abandon' });
  });

  it('a job whose request has vanished makes zero calls', async () => {
    const store = new FakeStore();
    store.queue.push(makeJob({ id: '00000000-0000-4000-8000-000000000001' }));
    await runGhlJobsWith({}, { store, client: forbiddenClient(), log: quiet });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'abandon' });
  });
});

describe('stage tags', () => {
  it('adds quote-request and the current stage, removes only the other three; owner tags stay (AC-017.8)', async () => {
    const contactId = sim.seedContact({ email: 'o@example.test', phone: '+14165550104', tags: ['quote-request', 'quote-new', 'vip'] });
    const store = new FakeStore();
    const request = makeRequest({ status: 'won', ghl_contact_id: contactId });
    store.add(request, makeJob(request, 'stage_tag', { target_status: 'won' }));

    const result = await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect(result).toEqual({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
    expect(callLines()).toEqual(['POST /contacts/:id/tags', 'DELETE /contacts/:id/tags']);
    expect(bodyOf('POST', '/contacts/')).toEqual({ tags: ['quote-request', 'quote-won'] });
    expect(bodyOf('DELETE', '/contacts/')).toEqual({ tags: ['quote-new', 'quote-quoted', 'quote-lost'] });
    expect([...(sim.contacts()[0]?.tags ?? [])].sort()).toEqual(['quote-request', 'quote-won', 'vip']);
    expect(store.finished[0]?.settle).toEqual({ outcome: 'succeeded' });
  });

  it('every attempt re-reads the stage: a late job for an older status applies the current one (AC-017.15)', async () => {
    const contactId = sim.seedContact({ email: 'o@example.test', phone: '+14165550105', tags: ['quote-request', 'quote-lost'] });
    const store = new FakeStore();
    const request = makeRequest({ status: 'quoted', ghl_contact_id: contactId });
    store.add(request, makeJob(request, 'stage_tag', { target_status: 'quoted' }));
    store.stages.set(request.id, 'lost'); // another request of the same homeowner changed later

    await runGhlJobsWith({}, { store, client: clientFor(), log: quiet });

    expect([...(sim.contacts()[0]?.tags ?? [])].sort()).toEqual(['quote-lost', 'quote-request']);
  });

  it('waits for the contact copy without calling GHL or counting an attempt', async () => {
    const store = new FakeStore();
    const request = makeRequest();
    store.add(request, makeJob(request, 'stage_tag'));
    store.copyStates.set(request.id, 'waiting');

    const result = await runGhlJobsWith({}, { store, client: forbiddenClient(), log: quiet });

    expect(result).toEqual({ claimed: 1, succeeded: 0, waiting: 1, failed: 0 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'wait' });
  });

  it('is abandoned (failed, no call) when the contact copy failed', async () => {
    const store = new FakeStore();
    const request = makeRequest();
    store.add(request, makeJob(request, 'stage_tag'));
    store.copyStates.set(request.id, 'failed');

    const result = await runGhlJobsWith({}, { store, client: forbiddenClient(), log: quiet });

    expect(result).toEqual({ claimed: 1, succeeded: 0, waiting: 0, failed: 1 });
    expect(store.finished[0]?.settle).toEqual({ outcome: 'abandon' });
  });
});
