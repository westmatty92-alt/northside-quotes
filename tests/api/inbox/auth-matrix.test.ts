// @vitest-environment node
// The auth matrix of the six staff operations of BE3 against the STAGING Supabase project (docs/SECURITY_MODEL.md "Permission
// matrix", invariants 3 and 4): listQuoteRequests, getQuoteRequest, listQuoteRequestPhotos, saveQuote,
// changeQuoteRequestStatus and getCurrentWeeklyCount.
//   no session, a bad token, only a cookie   401 session_expired, one body, and a write route writes nothing
//   a signed-in user who is not staff        401 session_expired (the contract lists no 403 on any staff operation)
//   a removed staff member, a session over 7 days, 401 at once, on every route
//   the owner and the helper                 identical rights: both succeed on every route
//   an unknown or pending id                 404 on every route that takes one, 401 (never 404) without a session
// Staff sessions are real (throwaway Auth users with and without a staff row, deleted in afterAll).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listGet, PUT as listPut } from '@/app/api/quote-requests/route';
import { GET as detailGet, DELETE as detailDelete, POST as detailPost } from '@/app/api/quote-requests/[request_id]/route';
import { GET as photosGet, POST as photosPost } from '@/app/api/quote-requests/[request_id]/photos/route';
import { PUT as quotePut, DELETE as quoteDelete } from '@/app/api/quote-requests/[request_id]/quote/route';
import { POST as statusPost, PUT as statusPut } from '@/app/api/quote-requests/[request_id]/status-changes/route';
import { GET as weeklyGet, DELETE as weeklyDelete } from '@/app/api/weekly-counts/current/route';
import { expectProblem } from '../../helpers/api';
import { idParams, inboxTools, psqlOutput, staffRequest, type StaffSession } from '../../helpers/inbox';
import { psql, setupStaging } from '../../helpers/staging';

const spies = vi.hoisted(() => ({ pending: [] as Promise<unknown>[], runGhlJobs: vi.fn() }));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (task: unknown) => {
      spies.pending.push(Promise.resolve().then(() => (typeof task === 'function' ? (task as () => unknown)() : task)));
    },
  };
});
vi.mock('@/lib/server/integrations/ghl', () => ({ runGhlJobs: spies.runGhlJobs }));

const staging = setupStaging();
const ib = inboxTools(staging);

let owner: StaffSession;
let helper: StaffSession;
let notStaff: { id: string; token: string };
let aging: StaffSession;
let target: { id: string };

beforeAll(async () => {
  owner = await ib.staff('Owner');
  helper = await ib.staff('Office helper');
  notStaff = await ib.nonStaff();
  aging = await ib.staff('Aging staff');
});

beforeEach(() => {
  spies.pending.length = 0;
  spies.runGhlJobs.mockReset().mockResolvedValue({ claimed: 0, succeeded: 0, waiting: 0, failed: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Headers = Record<string, string>;
type Call = (token: string | undefined, id: string, headers?: Headers) => Promise<Response>;

const ROUTES: Array<{ name: string; operation: string; writes: boolean; takesId: boolean; call: Call; okStatus: number }> = [
  { name: 'GET /api/quote-requests', operation: 'listQuoteRequests', writes: false, takesId: false, okStatus: 200, call: async (t, _id, h) => listGet(staffRequest('/api/quote-requests?limit=1', t, { headers: h }), undefined) },
  { name: 'GET /api/quote-requests/{id}', operation: 'getQuoteRequest', writes: false, takesId: true, okStatus: 200, call: async (t, id, h) => detailGet(staffRequest(`/api/quote-requests/${id}`, t, { headers: h }), idParams(id)) },
  { name: 'GET /api/quote-requests/{id}/photos', operation: 'listQuoteRequestPhotos', writes: false, takesId: true, okStatus: 200, call: async (t, id, h) => photosGet(staffRequest(`/api/quote-requests/${id}/photos`, t, { headers: h }), idParams(id)) },
  { name: 'PUT /api/quote-requests/{id}/quote', operation: 'saveQuote', writes: true, takesId: true, okStatus: 200, call: async (t, id, h) => quotePut(staffRequest(`/api/quote-requests/${id}/quote`, t, { method: 'PUT', body: { price_cents: 100, note: 'x', version: 1 }, headers: h }), idParams(id)) },
  { name: 'POST /api/quote-requests/{id}/status-changes', operation: 'changeQuoteRequestStatus', writes: true, takesId: true, okStatus: 201, call: async (t, id, h) => statusPost(staffRequest(`/api/quote-requests/${id}/status-changes`, t, { method: 'POST', body: { to_status: 'won', version: 1 }, headers: h }), idParams(id)) },
  { name: 'GET /api/weekly-counts/current', operation: 'getCurrentWeeklyCount', writes: false, takesId: false, okStatus: 200, call: async (t, _id, h) => weeklyGet(staffRequest('/api/weekly-counts/current', t, { headers: h }), undefined) },
];

function routeOf(operation: string) {
  const found = ROUTES.find((r) => r.operation === operation);
  if (!found) throw new Error(`no route table entry for ${operation}`);
  return found;
}

/** What a refused call must leave behind: the request exactly as seeded, no history, no event, no job, no GHL attempt. */
async function expectUntouched(): Promise<void> {
  await Promise.all(spies.pending.splice(0));
  expect(await ib.stored(target.id)).toMatchObject({ status: 'new', version: 1, price_cents: null, note: null, last_staff_update_by: null });
  expect(await ib.statusChanges(target.id)).toHaveLength(0);
  expect(await ib.events(target.id, 'quote_request_status_changed')).toHaveLength(0);
  expect(await ib.events(target.id, 'quote_request_quoted')).toHaveLength(0);
  expect(await ib.jobs(target.id)).toHaveLength(0);
  expect(spies.runGhlJobs).not.toHaveBeenCalled();
}

async function seedTarget(label: string): Promise<{ id: string }> {
  return ib.seed({ name: `${ib.tag} ${label}`, consent: true });
}

describe('no session, a bad token, only a cookie: 401 session_expired and nothing is written', () => {
  beforeAll(async () => {
    target = await seedTarget('matrix target');
  });

  const sessions: Array<[string, string | undefined, Headers]> = [
    ['no Authorization header', undefined, {}],
    ['an empty bearer token', undefined, { authorization: 'Bearer ' }],
    ['another scheme', undefined, { authorization: 'Basic b3duZXI6cGFzc3dvcmQ=' }],
    ['a token that is not a token', 'not-a-jwt', {}],
    ['"undefined" as the token', 'undefined', {}],
    ['a token of 5,000 characters', 'a'.repeat(5000), {}],
    ['only the session cookie (cookies never authenticate an API call)', undefined, { cookie: 'sb-staging-auth-token=eyJhbGciOiJIUzI1NiJ9.e30.x' }],
  ];

  const bodies: unknown[] = [];

  for (const route of ROUTES) {
    it.each(sessions)(`${route.operation}: %s`, async (_name, token, headers) => {
      const res = await route.call(token, target.id, headers);
      bodies.push(await expectProblem(res.clone(), 401, 'session_expired'));
      expect(JSON.stringify(await res.json())).not.toMatch(/staff|token|jwt|quote|request/i);
      if (route.writes) await expectUntouched();
    });
  }

  it('a token with a bad signature is refused on every route', async () => {
    for (const route of ROUTES) {
      const forged = `${owner.token.slice(0, -4)}AAAA`;
      await expectProblem(await route.call(forged, target.id), 401, 'session_expired');
    }
    await expectUntouched();
  });

  it('every refusal has the same body, so nothing says why or which route', () => {
    expect(bodies.length).toBeGreaterThanOrEqual(ROUTES.length * sessions.length);
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it('an unknown id with no session is 401, never 404: the answer does not say whether the request exists', async () => {
    for (const route of ROUTES.filter((r) => r.takesId)) {
      await expectProblem(await route.call(undefined, '00000000-0000-4000-8000-0000000000c1'), 401, 'session_expired');
      await expectProblem(await route.call(undefined, target.id), 401, 'session_expired');
    }
  });
});

describe('a signed-in user who is not staff is 401 session_expired on every route (the contract has no 403 here)', () => {
  beforeAll(async () => {
    target = await seedTarget('matrix non-staff target');
  });

  for (const route of ROUTES) {
    it(route.operation, async () => {
      const res = await route.call(notStaff.token, target.id);
      await expectProblem(res, 401, 'session_expired');
      if (route.writes) await expectUntouched();
    });
  }

  it('they cannot read a request, a photo or a count directly from the database either (RLS)', async () => {
    const { createUserClient } = await import('@/lib/server/supabase');
    const db = createUserClient(notStaff.token);
    const requests = await db.from('quote_requests').select('id').eq('id', target.id);
    const counts = await db.rpc('weekly_counts');
    const list = await db.rpc('list_quote_requests', { p_limit: 5 });
    expect(requests.data ?? []).toHaveLength(0);
    expect((counts.data ?? [{ requests: 0 }])[0]).toMatchObject({ requests: 0 });
    expect(list.data ?? []).toHaveLength(0);
  });
});

describe('the owner and the helper have identical rights', () => {
  it.each([
    ['owner', () => owner],
    ['helper', () => helper],
  ] as const)('%s succeeds on every route', async (who, session) => {
    const own = await ib.seed({ name: `${ib.tag} rights ${who}`, consent: false });
    const token = session().token;
    // read routes
    for (const route of ROUTES.filter((r) => !r.writes)) {
      const res = await route.call(token, own.id);
      expect(res.status, route.operation).toBe(route.okStatus);
    }
    // write routes (each gets its own request at version 1)
    for (const route of ROUTES.filter((r) => r.writes)) {
      const fresh = await ib.seed({ name: `${ib.tag} rights ${who} ${route.operation}`, consent: false });
      const res = await route.call(token, fresh.id);
      expect(res.status, route.operation).toBe(route.okStatus);
    }
  });

  it('both are recorded as the user who made the change, under their own display names', async () => {
    const request = await ib.seed({ name: `${ib.tag} who` });
    const saved = await quotePut(staffRequest(`/api/quote-requests/${request.id}/quote`, helper.token, { method: 'PUT', body: { price_cents: 500, note: null, version: 1 } }), idParams(request.id));
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { last_updated: { by_display_name: string } }).last_updated.by_display_name).toBe('Office helper');
    const moved = await statusPost(staffRequest(`/api/quote-requests/${request.id}/status-changes`, owner.token, { method: 'POST', body: { to_status: 'quoted', version: 2 } }), idParams(request.id));
    expect(moved.status).toBe(201);
    const detail = await detailGet(staffRequest(`/api/quote-requests/${request.id}`, owner.token), idParams(request.id));
    expect(((await detail.json()) as { last_updated: { by_display_name: string } }).last_updated.by_display_name).toBe('Owner');
    expect((await ib.statusChanges(request.id))[0]?.changed_by).toBe(owner.id);
  });
});

describe('an unknown or pending id is 404 on every route that takes one', () => {
  it('with a staff session: 404 not_found, and nothing is written', async () => {
    const pending = await ib.seed({ name: `${ib.tag} matrix pending`, state: 'pending' });
    for (const route of ROUTES.filter((r) => r.takesId)) {
      for (const id of ['00000000-0000-4000-8000-0000000000c2', 'not-a-uuid', pending.id]) {
        await expectProblem(await route.call(owner.token, id), 404, 'not_found');
      }
    }
    await Promise.all(spies.pending.splice(0));
    expect(spies.runGhlJobs).not.toHaveBeenCalled();
    const stored = await staging.db().from('quote_requests').select('status, version, price_cents').eq('id', pending.id).single();
    expect(stored.data).toEqual({ status: 'new', version: 1, price_cents: null });
  });

  it('the 404 body is the same for an id that never existed and one that is pending', async () => {
    const pending = await ib.seed({ name: `${ib.tag} same 404`, state: 'pending' });
    const a = await expectProblem(await routeOf('getQuoteRequest').call(owner.token, '00000000-0000-4000-8000-0000000000c3'), 404, 'not_found');
    const b = await expectProblem(await routeOf('getQuoteRequest').call(owner.token, pending.id), 404, 'not_found');
    expect(a).toEqual(b);
  });
});

describe('a method the contract does not list for a path is 405 with Allow, even without a session', () => {
  const id = '00000000-0000-4000-8000-0000000000c4';
  const cases: Array<[string, () => Promise<Response>, string]> = [
    ['PUT /api/quote-requests', async () => listPut(staffRequest('/api/quote-requests', undefined, { method: 'PUT' }), undefined), 'GET, POST'],
    ['POST /api/quote-requests/{id}', async () => detailPost(staffRequest(`/api/quote-requests/${id}`, undefined, { method: 'POST' }), idParams(id)), 'GET'],
    ['DELETE /api/quote-requests/{id}', async () => detailDelete(staffRequest(`/api/quote-requests/${id}`, undefined, { method: 'DELETE' }), idParams(id)), 'GET'],
    ['POST /api/quote-requests/{id}/photos', async () => photosPost(staffRequest(`/api/quote-requests/${id}/photos`, undefined, { method: 'POST' }), idParams(id)), 'GET'],
    ['DELETE /api/quote-requests/{id}/quote', async () => quoteDelete(staffRequest(`/api/quote-requests/${id}/quote`, undefined, { method: 'DELETE' }), idParams(id)), 'PUT'],
    ['PUT /api/quote-requests/{id}/status-changes', async () => statusPut(staffRequest(`/api/quote-requests/${id}/status-changes`, undefined, { method: 'PUT' }), idParams(id)), 'POST'],
    ['DELETE /api/weekly-counts/current', async () => weeklyDelete(staffRequest('/api/weekly-counts/current', undefined, { method: 'DELETE' }), undefined), 'GET'],
  ];
  it.each(cases)('%s', async (_name, call, allow) => {
    const res = await call();
    await expectProblem(res, 405, 'method_not_allowed');
    expect(res.headers.get('allow')).toBe(allow);
  });
});

describe('a session that has ended is refused at once, on every route', () => {
  beforeAll(async () => {
    target = await seedTarget('matrix ended target');
  });

  it('a session older than 7 days is 401 on every route (6 days is still fine), though its token has not expired', async () => {
    psql(`update auth.sessions set created_at = now() - interval '6 days' where user_id = '${aging.id}'`);
    expect((await routeOf('listQuoteRequests').call(aging.token, target.id)).status).toBe(200);
    psql(`update auth.sessions set created_at = now() - interval '8 days' where user_id = '${aging.id}'`);
    for (const route of ROUTES) await expectProblem(await route.call(aging.token, target.id), 401, 'session_expired');
    await expectUntouched();
  });

  it('a staff member removed from the staff table is 401 on every route the moment the row is gone', async () => {
    expect((await routeOf('getQuoteRequest').call(helper.token, target.id)).status).toBe(200);
    psql(`delete from public.staff where user_id = '${helper.id}'`);
    for (const route of ROUTES) await expectProblem(await route.call(helper.token, target.id), 401, 'session_expired');
    await expectUntouched();
  });

  it('the database agrees: neither of them can read any request directly any more', async () => {
    const { createUserClient } = await import('@/lib/server/supabase');
    for (const token of [aging.token, helper.token]) {
      const rows = await createUserClient(token).from('quote_requests').select('id').eq('id', target.id);
      expect(rows.data ?? []).toHaveLength(0);
    }
    expect(psqlOutput(`select count(*) from public.staff where user_id = '${helper.id}';`).trim()).toBe('0');
  });
});

describe('the BE3 source follows the rules the tests above rely on', () => {
  const root = resolve(__dirname, '../../..');
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
  const ROUTE_FILES = [
    'src/app/api/quote-requests/route.ts',
    'src/app/api/quote-requests/[request_id]/route.ts',
    'src/app/api/quote-requests/[request_id]/photos/route.ts',
    'src/app/api/quote-requests/[request_id]/quote/route.ts',
    'src/app/api/quote-requests/[request_id]/status-changes/route.ts',
    'src/app/api/weekly-counts/current/route.ts',
  ];

  it('every staff handler awaits requireStaff before it reads the body, the query, the id or calls a service', () => {
    for (const file of ROUTE_FILES) {
      const source = read(file);
      const guard = source.indexOf('await requireStaff(req)');
      expect(guard, file).toBeGreaterThan(-1);
      for (const later of ['readJsonBody(req)', 'parseListQuery(', 'await params', 'getQuoteRequest(', 'listQuoteRequests(', 'saveQuote(', 'changeQuoteRequestStatus(', 'getCurrentWeeklyCount(', 'listQuoteRequestPhotos(']) {
        const at = source.indexOf(later, source.indexOf('withApi'));
        if (at !== -1) expect(guard, `${file}: ${later}`).toBeLessThan(at);
      }
    }
  });

  it('the service and the routes use the user-scoped client only: no service-role client, no filter strings built from input (SEC-13)', () => {
    for (const file of ['src/lib/server/services/quote-requests.ts', ...ROUTE_FILES.slice(1)]) {
      const source = read(file);
      expect(source, file).not.toMatch(/getAdminClient|from '@\/lib\/server\/admin'|SUPABASE_SERVICE_ROLE_KEY/);
      expect(source, file).not.toMatch(/\.or\(|\.filter\(|\.ilike\(|\.like\(|\.textSearch\(/);
    }
    const service = read('src/lib/server/services/quote-requests.ts');
    expect(service).toContain("rpc('list_quote_requests'");
  });
});
