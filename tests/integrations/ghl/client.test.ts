// @vitest-environment node
// The GHL client against the offline simulator: contract (parse and drift), errors, config, base URL, ids, tags.
// Proves: AC-009.3 / AC-017.10 (config_missing, no call), S0 SEC-12 (contact id), S0 SEC-20 (production base URL),
// AC-017.8 (only the four stage tags are removable), and the six error classes of the metrics spec.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGhlClient,
  GHL_API_VERSION,
  GHL_DEFAULT_BASE_URL,
  GhlError,
  type GhlErrorClass,
} from '@/lib/server/integrations/ghl/client';
import createFixture from '../../mocks/ghl/fixtures/create-contact.201.json';
import duplicateFound from '../../mocks/ghl/fixtures/duplicate-found.200.json';
import duplicateNone from '../../mocks/ghl/fixtures/duplicate-none.200.json';
import { startGhlSimulator, type GhlSimulator, type SimMode } from '../../mocks/ghl/simulator.mjs';
import { HOMEOWNER, simEnv } from './helpers';

let sim: GhlSimulator;
beforeAll(async () => {
  sim = await startGhlSimulator({ slowMs: 5_000 });
});
afterAll(async () => {
  await sim.close();
});
beforeEach(() => sim.reset());

const copy = { name: HOMEOWNER.name, phone: HOMEOWNER.phone, email: HOMEOWNER.email, address: HOMEOWNER.address };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function errorOf(fn: () => Promise<unknown>): Promise<GhlError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GhlError);
    return error as GhlError;
  }
  throw new Error('expected a GhlError');
}

describe('requests the simulator accepts', () => {
  it('sends Bearer auth, Version, Accept and the location id; finds nothing, creates, tags, untags', async () => {
    const client = createGhlClient({ env: simEnv(sim) });

    expect(await client.findDuplicateContact({ email: HOMEOWNER.email, phone: HOMEOWNER.phone })).toBeNull();
    const { id } = await client.createContact({ ...copy, tags: ['quote-request', 'quote-new'] });
    await client.addTags(id, ['quote-request', 'quote-won']);
    await client.removeTags(id, ['quote-new', 'quote-quoted', 'quote-lost']);

    const calls = sim.calls();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /contacts/search/duplicate',
      'POST /contacts',
      `POST /contacts/${id}/tags`,
      `DELETE /contacts/${id}/tags`,
    ]);
    for (const call of calls) {
      expect(call.authorized).toBe(true);
      expect(call.version).toBe(GHL_API_VERSION);
      expect(call.accept).toBe('application/json');
    }
    expect(calls[0]?.query).toEqual({ locationId: sim.locationId, email: HOMEOWNER.email, number: '+14165550142' });
    expect(sim.contacts()[0]?.tags.sort()).toEqual(['quote-request', 'quote-won']);
  });

  it('sends only the mapped contact fields: no problem text, reference, price, note, urgency or consent', async () => {
    const client = createGhlClient({ env: simEnv(sim) });
    await client.createContact({ ...copy, name: 'Maria Del Rio', tags: ['quote-request', 'quote-new'] });
    const body = sim.callsTo('POST', '/contacts')[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['address1', 'email', 'firstName', 'lastName', 'locationId', 'name', 'phone', 'tags']);
    expect(body).toMatchObject({ name: 'Maria Del Rio', firstName: 'Maria', lastName: 'Del Rio', phone: '+14165550142', address1: HOMEOWNER.address });
  });

  it('omits lastName for a one-word name', async () => {
    const client = createGhlClient({ env: simEnv(sim) });
    await client.createContact({ ...copy, name: 'Cher', tags: ['quote-request', 'quote-new'] });
    const body = sim.callsTo('POST', '/contacts')[0]?.body as Record<string, unknown>;
    expect(body.firstName).toBe('Cher');
    expect('lastName' in body).toBe(false);
  });

  it('finds a seeded contact by email (any case) or by phone', async () => {
    const id = sim.seedContact({ name: 'Seeded', email: 'Seeded@Example.test', phone: '+14165550199', tags: [] });
    const client = createGhlClient({ env: simEnv(sim) });
    expect(await client.findDuplicateContact({ email: 'seeded@example.test', phone: '9055550100' })).toEqual({ id });
    expect(await client.findDuplicateContact({ email: 'other@example.test', phone: '4165550199' })).toEqual({ id });
  });
});

describe('contract: replies are parsed into our types, and drift names the field', () => {
  it('parses the fixtures verbatim', async () => {
    const client = createGhlClient({
      env: simEnv(sim),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(duplicateFound))
        .mockResolvedValueOnce(jsonResponse(duplicateNone))
        .mockResolvedValueOnce(jsonResponse(createFixture, 201)),
    });
    expect(await client.findDuplicateContact({ email: 'a@b.test', phone: '4165550142' })).toEqual({ id: duplicateFound.contact.id });
    expect(await client.findDuplicateContact({ email: 'a@b.test', phone: '4165550142' })).toBeNull();
    expect(await client.createContact({ ...copy, tags: ['quote-request', 'quote-new'] })).toEqual({ id: createFixture.contact.id });
  });

  it('a renamed id fails as server_error naming contact.id (create and search)', async () => {
    sim.setMode('drift');
    const client = createGhlClient({ env: simEnv(sim) });
    const created = await errorOf(() => client.createContact({ ...copy, tags: ['quote-request', 'quote-new'] }));
    expect(created.errorClass).toBe('server_error');
    expect(created.drift).toBe('contact.id');

    sim.setMode('ok');
    sim.seedContact({ email: HOMEOWNER.email, phone: '+14165550142' });
    sim.setMode('drift');
    const searched = await errorOf(() => client.findDuplicateContact({ email: HOMEOWNER.email, phone: HOMEOWNER.phone }));
    expect(searched.errorClass).toBe('server_error');
    expect(searched.drift).toBe('contact.id');
  });

  it('a reply without the contact key, a non-JSON reply and an invalid contact id are server_error', async () => {
    const make = (response: () => Response) => createGhlClient({ env: simEnv(sim), fetch: vi.fn(async () => response()) });
    const missing = await errorOf(() => make(() => jsonResponse({ nope: true })).findDuplicateContact({ email: 'a@b.test', phone: '4165550142' }));
    expect(missing).toMatchObject({ errorClass: 'server_error', drift: 'contact' });
    const notJson = await errorOf(() => make(() => new Response('<html>', { status: 200 })).createContact({ ...copy, tags: ['quote-request', 'quote-new'] }));
    expect(notJson).toMatchObject({ errorClass: 'server_error', drift: 'body' });
    const badId = await errorOf(() => make(() => jsonResponse({ contact: { id: 'a/../b' } }, 201)).createContact({ ...copy, tags: ['quote-request', 'quote-new'] }));
    expect(badId).toMatchObject({ errorClass: 'server_error', drift: 'contact.id' });
  });
});

describe('errors map to the six metrics-spec classes', () => {
  const cases: Array<[SimMode, GhlErrorClass, number | undefined]> = [
    ['revoked', 'auth', 401],
    ['forbidden', 'auth', 403],
    ['429', 'rate_limited', 429],
    ['500', 'server_error', 500],
    ['badrequest', 'rejected', 400],
    ['notfound', 'rejected', 404],
    ['unprocessable', 'rejected', 422],
  ];
  it.each(cases)('simulator mode %s -> %s', async (mode, errorClass, status) => {
    sim.setMode(mode);
    const client = createGhlClient({ env: simEnv(sim) });
    const error = await errorOf(() => client.findDuplicateContact({ email: HOMEOWNER.email, phone: HOMEOWNER.phone }));
    expect(error.errorClass).toBe(errorClass);
    expect(error.status).toBe(status);
  });

  it('a wrong token is auth', async () => {
    const client = createGhlClient({ env: simEnv(sim, { GHL_PRIVATE_INTEGRATION_TOKEN: 'a-different-token' }) });
    expect((await errorOf(() => client.findDuplicateContact({ email: HOMEOWNER.email, phone: HOMEOWNER.phone }))).errorClass).toBe('auth');
  });

  it('a call slower than the timeout is timeout, and nothing was applied', async () => {
    sim.setMode('slow');
    const client = createGhlClient({ env: simEnv(sim), timeoutMs: 150 });
    const error = await errorOf(() => client.createContact({ ...copy, tags: ['quote-request', 'quote-new'] }));
    expect(error.errorClass).toBe('timeout');
    expect(sim.contacts()).toHaveLength(0);
  });

  it('a lost reply is timeout although the contact was created (AC-009.4 starting point)', async () => {
    sim.setMode('lost_reply');
    const client = createGhlClient({ env: simEnv(sim), timeoutMs: 150 });
    const error = await errorOf(() => client.createContact({ ...copy, tags: ['quote-request', 'quote-new'] }));
    expect(error.errorClass).toBe('timeout');
    expect(sim.contacts()).toHaveLength(1);
  });

  it('a refused connection is server_error', async () => {
    const client = createGhlClient({ env: simEnv(sim, { GHL_API_BASE_URL: 'http://127.0.0.1:1' }), timeoutMs: 2_000 });
    expect((await errorOf(() => client.findDuplicateContact({ email: HOMEOWNER.email, phone: HOMEOWNER.phone }))).errorClass).toBe('server_error');
  });

  it('a redirect is refused (the token never follows it to another host)', async () => {
    let hits = 0;
    const other = http.createServer((_req, res) => {
      hits += 1;
      res.end('{}');
    });
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const redirector = http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${(other.address() as AddressInfo).port}/stolen` });
      res.end();
    });
    await new Promise<void>((resolve) => redirector.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`;
      const client = createGhlClient({ env: simEnv(sim, { GHL_API_BASE_URL: base }) });
      expect((await errorOf(() => client.findDuplicateContact({ email: HOMEOWNER.email, phone: HOMEOWNER.phone }))).errorClass).toBe('server_error');
      expect(hits).toBe(0);
    } finally {
      redirector.close();
      other.close();
    }
  });

  it('the error carries no token, no URL, no body and no personal value', async () => {
    sim.setMode('500');
    const client = createGhlClient({ env: simEnv(sim) });
    const error = await errorOf(() => client.createContact({ ...copy, tags: ['quote-request', 'quote-new'] }));
    const everything = JSON.stringify({ message: error.message, stack: error.stack, own: Object.entries(error), cause: error.cause });
    for (const secret of [sim.token, HOMEOWNER.email, HOMEOWNER.name, HOMEOWNER.phone, HOMEOWNER.address, sim.url, 'simulated']) {
      expect(everything).not.toContain(secret);
    }
  });
});

describe('configuration: nothing is sent without a usable token and location', () => {
  const noFetch = () => vi.fn(async () => jsonResponse(duplicateNone));
  const cases: Array<[string, Record<string, string | undefined>]> = [
    ['no token', { GHL_PRIVATE_INTEGRATION_TOKEN: undefined }],
    ['an empty token', { GHL_PRIVATE_INTEGRATION_TOKEN: '' }],
    ['a token with a newline', { GHL_PRIVATE_INTEGRATION_TOKEN: 'abc\ndef' }],
    ['no location id', { GHL_LOCATION_ID: undefined }],
    ['a location id with a slash', { GHL_LOCATION_ID: 'loc/../x' }],
  ];
  it.each(cases)('%s -> config_missing and zero calls', async (_name, extra) => {
    const fetchSpy = noFetch();
    const client = createGhlClient({ env: simEnv(sim, extra), fetch: fetchSpy });
    expect((await errorOf(() => client.findDuplicateContact({ email: HOMEOWNER.email, phone: HOMEOWNER.phone }))).errorClass).toBe('config_missing');
    expect((await errorOf(() => client.createContact({ ...copy, tags: ['quote-request', 'quote-new'] }))).errorClass).toBe('config_missing');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sim.calls()).toHaveLength(0);
  });
});

describe('base URL (S0 SEC-20)', () => {
  const hostOf = async (env: Record<string, string | undefined>) => {
    const fetchSpy = vi.fn<typeof fetch>(async () => jsonResponse(duplicateNone));
    const client = createGhlClient({ env, fetch: fetchSpy });
    await client.findDuplicateContact({ email: HOMEOWNER.email, phone: HOMEOWNER.phone });
    return new URL(String(fetchSpy.mock.calls[0]?.[0]));
  };
  const base = { GHL_PRIVATE_INTEGRATION_TOKEN: 'tok-xyz', GHL_LOCATION_ID: 'LOC1' };

  it('VERCEL_ENV=production ignores GHL_API_BASE_URL and always uses the real host', async () => {
    const url = await hostOf({ ...base, VERCEL_ENV: 'production', GHL_API_BASE_URL: 'https://evil.example' });
    expect(url.origin).toBe(GHL_DEFAULT_BASE_URL);
  });

  it('without an override the real host is used, in every environment', async () => {
    expect((await hostOf({ ...base })).origin).toBe(GHL_DEFAULT_BASE_URL);
    expect((await hostOf({ ...base, VERCEL_ENV: 'preview' })).origin).toBe(GHL_DEFAULT_BASE_URL);
  });

  it('preview and local runs may point at a stub; a trailing slash is trimmed', async () => {
    const url = await hostOf({ ...base, VERCEL_ENV: 'preview', GHL_API_BASE_URL: 'http://127.0.0.1:4510/' });
    expect(url.origin).toBe('http://127.0.0.1:4510');
    expect(url.pathname).toBe('/contacts/search/duplicate');
  });

  it('an unusable override fails closed instead of falling back to the real host', async () => {
    for (const bad of ['not a url', 'ftp://host.example', 'https://user:pw@host.example']) {
      const fetchSpy = noFetchSpy();
      const client = createGhlClient({ env: { ...base, VERCEL_ENV: 'preview', GHL_API_BASE_URL: bad }, fetch: fetchSpy });
      expect((await errorOf(() => client.findDuplicateContact({ email: HOMEOWNER.email, phone: HOMEOWNER.phone }))).errorClass).toBe('config_missing');
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });
});

function noFetchSpy() {
  return vi.fn(async () => jsonResponse(duplicateNone));
}

describe('contact id and tags (S0 SEC-12, AC-017.8)', () => {
  const badIds = ['', '../x', 'a/b', 'a b', 'a?x=1', 'a#b', 'a%2Fb', 'a'.repeat(101)];

  it.each(badIds)('contact id %j never reaches the network', async (id) => {
    const fetchSpy = noFetchSpy();
    const client = createGhlClient({ env: simEnv(sim), fetch: fetchSpy });
    expect((await errorOf(() => client.addTags(id, ['quote-request', 'quote-new']))).errorClass).toBe('server_error');
    expect((await errorOf(() => client.removeTags(id, ['quote-won']))).errorClass).toBe('server_error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a valid id goes into the path as is', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => jsonResponse({ tags: [] }));
    const client = createGhlClient({ env: simEnv(sim), fetch: fetchSpy });
    await client.addTags('Abc_def-123', ['quote-request', 'quote-new']);
    expect(new URL(String(fetchSpy.mock.calls[0]?.[0])).pathname).toBe('/contacts/Abc_def-123/tags');
  });

  it('only quote-request and the four stage tags can be added; only the four stage tags can be removed', async () => {
    const fetchSpy = noFetchSpy();
    const client = createGhlClient({ env: simEnv(sim), fetch: fetchSpy });
    const looseAdd = client.addTags as unknown as (id: string, tags: string[]) => Promise<void>;
    const looseRemove = client.removeTags as unknown as (id: string, tags: string[]) => Promise<void>;
    expect((await errorOf(() => looseAdd('abc', ['vip']))).errorClass).toBe('rejected');
    expect((await errorOf(() => looseRemove('abc', ['quote-request']))).errorClass).toBe('rejected');
    expect((await errorOf(() => looseRemove('abc', ['vip', 'quote-won']))).errorClass).toBe('rejected');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('removing stage tags keeps quote-request and the owner\'s own tags on the contact', async () => {
    const id = sim.seedContact({ email: 'o@example.test', phone: '+14165550101', tags: ['quote-request', 'quote-new', 'vip'] });
    const client = createGhlClient({ env: simEnv(sim) });
    await client.addTags(id, ['quote-request', 'quote-quoted']);
    await client.removeTags(id, ['quote-new', 'quote-won', 'quote-lost']);
    expect(sim.contacts()[0]?.tags.sort()).toEqual(['quote-quoted', 'quote-request', 'vip']);
  });
});
