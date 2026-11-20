#!/usr/bin/env node
// tests/mocks/ghl/simulator.mjs: an offline, deterministic GoHighLevel stand-in (INT1). No dependencies.
// QA reuses it for failure drills with no network access. Docs: docs/integrations/ghl.md "Simulator".
//
//   node tests/mocks/ghl/simulator.mjs [--port 4510] [--token <fake>] [--location-id <fake>] [--mode ok]
//
// Then point the app at it: GHL_API_BASE_URL=http://127.0.0.1:4510 (preview and local only: the client ignores it
// when VERCEL_ENV=production), GHL_PRIVATE_INTEGRATION_TOKEN=<the --token value>, GHL_LOCATION_ID=<the --location-id value>.
//
// It implements exactly the four calls the app makes, with an in-memory contact book:
//   GET    /contacts/search/duplicate?locationId&email&number
//   POST   /contacts
//   POST   /contacts/:id/tags       (adds; a tag that does not exist yet is created)
//   DELETE /contacts/:id/tags       (removes; tags the contact does not have are ignored)
//
// MODES (one per request via header `x-sim-mode`, else the next entry of the queue, else the standing mode):
//   ok            answer normally
//   slow          wait `slowMs` before doing anything; if the caller gave up meanwhile, nothing was applied
//   lost_reply    APPLY the call (e.g. create the contact), then never answer (the caller times out)
//   429           rate limited, no Retry-After header (GHL sends none)
//   500           server error
//   revoked       401
//   forbidden     403
//   badrequest    400
//   notfound      404
//   unprocessable 422
//   drift         applies the call, then answers with renamed fields (id -> identifier, tags -> tagList)
// Settings: allowDuplicateContact (default false: a second contact with the same email or phone gets a 400, the
// behaviour the contract assumes when "Allow Duplicate Contact" is off) and searchLag (new contacts are invisible
// to the duplicate search until flushSearchIndex()).
//
// Everything about error bodies and statuses for situations the docs do not describe is INVENTED: see
// tests/mocks/ghl/fixtures/README.md. The simulator never records the token, only whether it was the right one.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

export const SIM_DEFAULT_TOKEN = 'sim-token-not-a-secret';
export const SIM_DEFAULT_LOCATION = 'SIMLOCATION0000000001';

const FAILURE_MODES = {
  429: [429, '429'],
  500: [500, '500'],
  revoked: [401, '401'],
  forbidden: [403, '403'],
  badrequest: [400, '400'],
  notfound: [404, '404'],
  unprocessable: [422, '422'],
};

const normaliseTag = (tag) => String(tag).trim().toLowerCase();
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

export async function startGhlSimulator(options = {}) {
  const token = options.token ?? SIM_DEFAULT_TOKEN;
  const locationId = options.locationId ?? SIM_DEFAULT_LOCATION;
  const slowMs = options.slowMs ?? 15_000;
  // Contact ids are never reused within one simulator, not even after reset(): tests that write ids into a shared
  // database must not see two homeowners share one contact id. Pass a run-unique idPrefix for such tests.
  const idPrefix = options.idPrefix ?? 'simcontact';
  let seq = 0;
  const errors = fixture('errors');

  const state = freshState(options.mode);
  const sockets = new Set();
  const sleepers = new Set();

  function freshState(mode = 'ok') {
    return { contacts: new Map(), calls: [], mode, queue: [], allowDuplicateContact: false, searchLag: false };
  }

  function contactView(c) {
    return {
      id: c.id,
      locationId,
      name: c.name,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      address1: c.address1,
      tags: [...c.tags],
    };
  }

  function addContact(fields) {
    seq += 1;
    const c = {
      id: `${idPrefix}${String(seq).padStart(10, '0')}`,
      name: fields.name ?? '',
      firstName: fields.firstName,
      lastName: fields.lastName,
      email: fields.email,
      phone: fields.phone,
      address1: fields.address1,
      tags: [...new Set((Array.isArray(fields.tags) ? fields.tags : []).map(normaliseTag))],
      indexed: !state.searchLag,
    };
    state.contacts.set(c.id, c);
    return c;
  }

  function findByEmailOrPhone(email, phone, { onlyIndexed }) {
    for (const c of state.contacts.values()) {
      if (onlyIndexed && !c.indexed) continue;
      if ((email && same(c.email, email)) || (phone && c.phone === phone)) return c;
    }
    return null;
  }

  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(''));
    });

  /** Waits unless the caller hangs up first. Resolves true when the full time passed. */
  const pause = (ms, res) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => done(true), ms);
      const done = (full) => {
        clearTimeout(timer);
        sleepers.delete(cancel);
        res.off('close', onClose);
        resolve(full);
      };
      const onClose = () => done(false);
      const cancel = () => done(false);
      sleepers.add(cancel);
      res.on('close', onClose);
    });

  function nextMode(req) {
    const header = req.headers['x-sim-mode'];
    if (typeof header === 'string' && header !== '') return header;
    if (state.queue.length > 0) return state.queue.shift();
    return state.mode;
  }

  function send(res, status, body, headers = {}) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  function drift(body) {
    // The kind of change a provider makes without telling anyone: renamed fields.
    return JSON.parse(JSON.stringify(body).replace('"id":', '"identifier":').replace('"tags":', '"tagList":'));
  }

  // The effect of one call. Returns { status, body }.
  function apply(method, url, body) {
    const p = url.pathname;
    const q = url.searchParams;

    if (method === 'GET' && p === '/contacts/search/duplicate') {
      if (q.get('locationId') !== locationId) return { status: 403, body: errors['403'] };
      const hit = findByEmailOrPhone(q.get('email'), q.get('number'), { onlyIndexed: true });
      if (!hit) return { status: 200, body: fixture('duplicate-none.200') };
      return { status: 200, body: { ...fixture('duplicate-found.200'), contact: contactView(hit) } };
    }

    if (method === 'POST' && p === '/contacts') {
      if (!body || typeof body !== 'object' || body.locationId !== locationId) return { status: 403, body: errors['403'] };
      if (typeof body.email !== 'string' && typeof body.phone !== 'string') return { status: 422, body: errors['422'] };
      if (!state.allowDuplicateContact && findByEmailOrPhone(body.email, body.phone, { onlyIndexed: false })) {
        return { status: 400, body: errors['400-duplicate'] };
      }
      const c = addContact(body);
      return { status: 201, body: { ...fixture('create-contact.201'), contact: contactView(c) } };
    }

    const tagRoute = /^\/contacts\/([^/]+)\/tags$/.exec(p);
    if (tagRoute && (method === 'POST' || method === 'DELETE')) {
      const id = decodeURIComponent(tagRoute[1]);
      const c = state.contacts.get(id);
      if (!c) return { status: 404, body: errors['404'] };
      if (!body || !Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string')) return { status: 422, body: errors['422'] };
      const tags = body.tags.map(normaliseTag);
      if (method === 'POST') {
        for (const t of tags) {
          if (!c.tags.includes(t)) c.tags.push(t);
        }
      } else {
        c.tags = c.tags.filter((t) => !tags.includes(t));
      }
      return { status: 200, body: { ...fixture('tags.200'), tags: [...c.tags] } };
    }

    return { status: 404, body: errors['404'] };
  }

  async function control(req, res, url) {
    const raw = await readBody(req);
    let input = {};
    try {
      input = raw ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, { error: 'bad json' });
    }
    if (req.method === 'GET' && url.pathname === '/__sim/state') {
      return send(res, 200, { contacts: [...state.contacts.values()].map(contactView), calls: state.calls });
    }
    if (req.method === 'POST' && url.pathname === '/__sim/reset') {
      Object.assign(state, freshState());
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/__sim/mode') {
      if (typeof input.mode === 'string') state.mode = input.mode;
      if (Array.isArray(input.queue)) state.queue = input.queue.map(String);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/__sim/config') {
      if (typeof input.allowDuplicateContact === 'boolean') state.allowDuplicateContact = input.allowDuplicateContact;
      if (typeof input.searchLag === 'boolean') state.searchLag = input.searchLag;
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/__sim/seed') {
      return send(res, 200, { id: addContact(input).id });
    }
    return send(res, 404, { error: 'unknown control route' });
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://simulator');
    if (url.pathname.startsWith('/__sim/')) return control(req, res, url);

    const raw = await readBody(req);
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    const mode = nextMode(req);
    const authorized = req.headers.authorization === `Bearer ${token}`;
    const method = req.method ?? 'GET';
    state.calls.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
      authorized,
      version: typeof req.headers.version === 'string' ? req.headers.version : null,
      accept: typeof req.headers.accept === 'string' ? req.headers.accept : null,
      mode,
    });

    if (!authorized) return send(res, 401, errors['401']);

    const failure = FAILURE_MODES[mode];
    if (failure) {
      const [status, key] = failure;
      return send(res, status, errors[key]);
    }

    if (mode === 'slow' && !(await pause(slowMs, res))) return; // the caller gave up: nothing applied

    const { status, body: reply } = apply(method, url, body);

    if (mode === 'lost_reply') {
      await pause(60_000, res); // applied, never answered
      return;
    }
    return send(res, status, mode === 'drift' ? drift(reply) : reply);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => res.destroy());
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    locationId,
    calls: () => state.calls.map((c) => structuredClone(c)),
    callsTo: (method, pathPrefix) => state.calls.filter((c) => c.method === method && c.path.startsWith(pathPrefix)).map((c) => structuredClone(c)),
    contacts: () => [...state.contacts.values()].map(contactView),
    reset: () => {
      Object.assign(state, freshState());
    },
    setMode: (mode) => {
      state.mode = mode;
    },
    queueModes: (modes) => {
      state.queue = [...modes];
    },
    configure: (settings) => {
      if (typeof settings.allowDuplicateContact === 'boolean') state.allowDuplicateContact = settings.allowDuplicateContact;
      if (typeof settings.searchLag === 'boolean') state.searchLag = settings.searchLag;
    },
    flushSearchIndex: () => {
      for (const c of state.contacts.values()) c.indexed = true;
    },
    seedContact: (fields) => addContact(fields).id,
    close: () =>
      new Promise((resolve) => {
        for (const cancel of [...sleepers]) cancel();
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve(undefined));
      }),
  };
}

// Run directly: a long-lived simulator for QA.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i]?.replace(/^--/, '') ?? ''] = process.argv[i + 1];
  const sim = await startGhlSimulator({
    port: args.port ? Number(args.port) : 4510,
    token: args.token,
    locationId: args['location-id'],
    mode: args.mode,
  });
  console.log(`GHL simulator on ${sim.url} (mode ${args.mode ?? 'ok'})`);
  console.log(`  GHL_API_BASE_URL=${sim.url}`);
  console.log(`  GHL_PRIVATE_INTEGRATION_TOKEN=${sim.token}   (a fake value, valid only for this simulator)`);
  console.log(`  GHL_LOCATION_ID=${sim.locationId}`);
}
