// @vitest-environment node
// GET /api/quote-requests (operation listQuoteRequests) against the STAGING Supabase project, called in-process with a real
// staff session (a throwaway staff member created through the Auth admin API, deleted in afterAll).
//   AC-005.1  newest first            AC-005.4  nothing listed        AC-005.5  50 then "Show more" (the cursor)
//   AC-011.1  status filter           AC-011.2  empty filter           AC-016.10 Pipeline columns of 50
//   AC-013.1  search by reference     AC-013.2  nothing found          AC-013.3  search by part of a name (and phone digits)
//   SEC-13    the cursor is decoded and validated before the database is called (400), no filter string is built from input
// Every request is seeded with a name token unique to this file and run, searched with that token, and deleted in afterAll.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/quote-requests/route';
import { ListQuoteRequestsResponse } from '@/lib/api/generated/inbox/inbox.zod';
import { captureOutput, expectProblem } from '../../helpers/api';
import { inboxTools, staffRequest, type SeedRequest, type StaffSession } from '../../helpers/inbox';
import { setupStaging } from '../../helpers/staging';

const staging = setupStaging();
const ib = inboxTools(staging);

let staff: StaffSession;

beforeAll(async () => {
  staff = await ib.staff('Owner (list test)');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SUMMARY_KEYS = ['id', 'name', 'reference', 'status', 'submitted_at', 'urgency', 'version'];

/** A name token for one test: every request of the test carries it, and the test searches with it. */
let scopeCounter = 0;
const newScope = () => {
  scopeCounter += 1;
  return `${ib.tag}-s${scopeCounter}`;
};

const byNewest = (a: SeedRequest, b: SeedRequest) => (a.submittedAt === b.submittedAt ? (a.id < b.id ? 1 : -1) : a.submittedAt < b.submittedAt ? 1 : -1);

/** `token` null sends no Authorization header at all. */
function listCall(query: string | Record<string, string>, token: string | null = staff.token): Promise<Response> {
  const qs = typeof query === 'string' ? query : new URLSearchParams(query).toString();
  return Promise.resolve(GET(staffRequest(`/api/quote-requests${qs === '' ? '' : `?${qs}`}`, token ?? undefined), undefined));
}

/** A 200 page, checked against the generated contract schema and for exactly the contract's keys. */
async function page(query: string | Record<string, string>) {
  const res = await listCall(query);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  expect(res.headers.get('x-request-id')).toBeTruthy();
  expect(res.headers.get('cache-control')).toContain('no-store');
  const raw: unknown = await res.json();
  const body = ListQuoteRequestsResponse.parse(raw);
  expect(Object.keys(raw as object).sort()).toEqual(['data', 'next_cursor']);
  for (const item of (raw as { data: object[] }).data) expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS);
  return body;
}

/** Every page of a query, following next_cursor, as the list of ids. */
async function allIds(params: Record<string, string>): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 20; guard += 1) {
    const body = await page(cursor === null ? params : { ...params, cursor });
    ids.push(...body.data.map((item) => item.id));
    cursor = body.next_cursor;
    if (cursor === null) return ids;
  }
  throw new Error('the cursor never ended');
}

describe('AC-005.1: newest first, with the fields a row shows', () => {
  it('lists requests submitted at 09:00, 09:05 and 09:10 as 09:10, 09:05, 09:00', async () => {
    const scope = newScope();
    const early = await ib.seed({ name: `${scope} early`, submittedAt: '2026-03-02T14:00:00.000Z', urgency: 'flexible' });
    const late = await ib.seed({ name: `${scope} late`, submittedAt: '2026-03-02T14:10:00.000Z', urgency: 'emergency' });
    const middle = await ib.seed({ name: `${scope} middle`, submittedAt: '2026-03-02T14:05:00.000Z' });

    const body = await page({ q: scope });
    expect(body.data.map((item) => item.id)).toEqual([late.id, middle.id, early.id]);
    expect(body.next_cursor).toBeNull();
    expect(body.data[0]).toEqual({
      id: late.id,
      reference: late.reference,
      name: `${scope} late`,
      urgency: 'emergency',
      status: 'new',
      submitted_at: '2026-03-02T14:10:00.000Z',
      version: 1,
    });
  });

  it('AC-005.2: a request submitted after the first load is at the top on the next load, with status new', async () => {
    const scope = newScope();
    await ib.seed({ name: `${scope} first`, submittedAt: '2026-03-02T14:00:00.000Z' });
    expect((await page({ q: scope })).data).toHaveLength(1);
    const fresh = await ib.seed({ name: `${scope} fresh`, submittedAt: new Date().toISOString() });
    const body = await page({ q: scope });
    expect(body.data[0]?.id).toBe(fresh.id);
    expect(body.data[0]?.status).toBe('new');
  });

  it('a request still pending is never listed (invariant 5)', async () => {
    const scope = newScope();
    const pending = await ib.seed({ name: `${scope} pending`, state: 'pending' });
    const stored = await ib.seed({ name: `${scope} stored` });
    const ids = (await page({ q: scope })).data.map((item) => item.id);
    expect(ids).toEqual([stored.id]);
    expect(ids).not.toContain(pending.id);
  });

  it('status and price changes never reorder the list (AC-007.5)', async () => {
    const scope = newScope();
    const a = await ib.seed({ name: `${scope} a`, submittedAt: '2026-03-02T14:00:00.000Z' });
    const b = await ib.seed({ name: `${scope} b`, submittedAt: '2026-03-02T14:05:00.000Z', status: 'won', priceCents: 45000 });
    const c = await ib.seed({ name: `${scope} c`, submittedAt: '2026-03-02T14:10:00.000Z', status: 'lost' });
    expect((await page({ q: scope })).data.map((item) => item.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe('AC-005.4: nothing to list', () => {
  it('an empty result is data [] and next_cursor null', async () => {
    const body = await page({ q: `${ib.tag}-nothing-seeded-with-this` });
    expect(body).toEqual({ data: [], next_cursor: null });
  });
});

describe('AC-005.5 and the cursor: 50 at a time', () => {
  it('51 requests: the default page is the 50 newest with a cursor, the second page is the last 1', async () => {
    const scope = newScope();
    const base = Date.parse('2026-03-03T10:00:00.000Z');
    const seeded = await ib.seedMany(Array.from({ length: 51 }, (_, i) => ({ name: `${scope} n${i}`, submittedAt: new Date(base + i * 60_000).toISOString() })));
    const expected = [...seeded].sort(byNewest).map((r) => r.id);

    const first = await page({ q: scope });
    expect(first.data).toHaveLength(50);
    expect(first.data.map((item) => item.id)).toEqual(expected.slice(0, 50));
    expect(first.next_cursor).toEqual(expect.any(String));
    expect((first.next_cursor ?? '').length).toBeLessThanOrEqual(200); // the contract's cursor maximum

    const second = await page({ q: scope, cursor: first.next_cursor ?? '' });
    expect(second.data.map((item) => item.id)).toEqual(expected.slice(50));
    expect(second.next_cursor).toBeNull();
  });

  it('limit sets the page size: 20, 20 and 11 for 51 rows, every row once, in order, and limit 100 returns them all', async () => {
    const scope = newScope();
    const base = Date.parse('2026-03-04T10:00:00.000Z');
    const seeded = await ib.seedMany(Array.from({ length: 51 }, (_, i) => ({ name: `${scope} n${i}`, submittedAt: new Date(base + i * 60_000).toISOString() })));
    const expected = [...seeded].sort(byNewest).map((r) => r.id);

    const sizes: number[] = [];
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const body = await page(cursor === null ? { q: scope, limit: '20' } : { q: scope, limit: '20', cursor });
      sizes.push(body.data.length);
      ids.push(...body.data.map((item) => item.id));
      cursor = body.next_cursor;
    } while (cursor !== null);
    expect(sizes).toEqual([20, 20, 11]);
    expect(ids).toEqual(expected);

    const all = await page({ q: scope, limit: '100' });
    expect(all.data.map((item) => item.id)).toEqual(expected);
    expect(all.next_cursor).toBeNull();
    expect((await page({ q: scope, limit: '1' })).data).toHaveLength(1);
  });

  it('the keyset is exact: rows with the same time, or times that differ by microseconds, are neither skipped nor repeated', async () => {
    const scope = newScope();
    const second = '2026-03-05T12:00:00';
    const seeded = await ib.seedMany([
      { name: `${scope} t1`, submittedAt: `${second}.000001+00:00` },
      { name: `${scope} t2`, submittedAt: `${second}.000002+00:00` },
      { name: `${scope} t3`, submittedAt: `${second}.000002+00:00` },
      { name: `${scope} t4`, submittedAt: `${second}.000002+00:00` },
      { name: `${scope} t5`, submittedAt: `${second}.000003+00:00` },
      { name: `${scope} t6`, submittedAt: `${second}.000000+00:00` },
    ]);
    const expected = [...seeded].sort(byNewest).map((r) => r.id);
    // one row per page is the hardest case for the cursor
    expect(await allIds({ q: scope, limit: '1' })).toEqual(expected);
    expect(await allIds({ q: scope, limit: '2' })).toEqual(expected);
    // all six share one millisecond in the response, so the order can only come from the database's own precision
    const body = await page({ q: scope });
    expect(new Set(body.data.map((item) => item.submitted_at)).size).toBe(1);
  });

  it('a cursor made from a real page keeps working when the list grows underneath it (newer rows do not shift the next page)', async () => {
    const scope = newScope();
    const base = Date.parse('2026-03-06T10:00:00.000Z');
    const seeded = await ib.seedMany(Array.from({ length: 6 }, (_, i) => ({ name: `${scope} g${i}`, submittedAt: new Date(base + i * 60_000).toISOString() })));
    const expected = [...seeded].sort(byNewest).map((r) => r.id);
    const first = await page({ q: scope, limit: '3' });
    await ib.seed({ name: `${scope} newcomer`, submittedAt: new Date(base + 99 * 60_000).toISOString() });
    const next = await page({ q: scope, limit: '3', cursor: first.next_cursor ?? '' });
    expect(next.data.map((item) => item.id)).toEqual(expected.slice(3));
  });
});

describe('a malformed cursor is 400 and never reaches the database (SEC-13)', () => {
  const when = '2026-03-02T14:00:00.000000+00:00';
  const id = '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';
  const make = (value: unknown) => `c1.${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')}`;

  const bad: Array<[string, string]> = [
    ['not a cursor at all', 'garbage'],
    ['empty', ''],
    ['only the prefix', 'c1.'],
    ['characters base64url does not have', 'c1.!!!!'],
    ['a cursor from another version', `c9.${Buffer.from(JSON.stringify([when, id])).toString('base64url')}`],
    ['base64 of text that is not JSON', `c1.${Buffer.from('not json').toString('base64url')}`],
    ['JSON that is not an array', make({ t: when, i: id })],
    ['an empty array', make([])],
    ['an array of one', make([when])],
    ['an array of three', make([when, id, 'x'])],
    ['numbers', make([1, 2])],
    ['an id that is not a uuid', make([when, 'not-a-uuid'])],
    ['an upper-case uuid', make([when, id.toUpperCase()])],
    ['a date that does not exist (31 February)', make(['2026-02-31T10:00:00.000000+00:00', id])],
    ['month 13', make(['2026-13-01T10:00:00.000000+00:00', id])],
    ['a time with no zone', make(['2026-03-02T14:00:00', id])],
    ['a time in another zone', make(['2026-03-02T14:00:00+05:00', id])],
    ['seven fractional digits', make(['2026-03-02T14:00:00.1234567+00:00', id])],
    ['SQL in the time', make([`${when}'; drop table public.quote_requests; --`, id])],
    ['a filter string in the id', make([when, 'x),status.eq.won,id.neq.(y'])],
    ['over 200 characters', `c1.${'A'.repeat(300)}`],
  ];

  it.each(bad)('%s', async (_name, cursor) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await listCall({ cursor });
    await expectProblem(res, 400, 'bad_request');
    // the guard talks to Auth and current_staff(); the list RPC must not have been called
    const urls = fetchSpy.mock.calls.map((call) => String(call[0] instanceof Request ? call[0].url : call[0]));
    expect(urls.some((url) => url.includes('list_quote_requests'))).toBe(false);
  });

  it('two cursor parameters are 400 too', async () => {
    await expectProblem(await listCall(`cursor=${make([when, id])}&cursor=${make([when, id])}`), 400, 'bad_request');
  });

  it('a cursor is checked before the other parameters, and after the session: no session is 401, not 400', async () => {
    await expectProblem(await listCall({ cursor: 'garbage', status: 'archived' }), 400, 'bad_request');
    await expectProblem(await listCall({ cursor: 'garbage' }, null), 401, 'session_expired');
  });

  it('a well-formed cursor that no row matches is just an empty page', async () => {
    const body = await page({ q: `${ib.tag}-none`, cursor: make([when, id]) });
    expect(body).toEqual({ data: [], next_cursor: null });
  });
});

describe('filters and search', () => {
  it('AC-011.1: the status filter lists exactly that status, newest first; AC-011.2: an empty filter is data []', async () => {
    const scope = newScope();
    const news = await ib.seedMany([
      { name: `${scope} new-a`, submittedAt: '2026-03-07T10:00:00.000Z' },
      { name: `${scope} new-b`, submittedAt: '2026-03-07T10:02:00.000Z' },
      { name: `${scope} new-c`, submittedAt: '2026-03-07T10:01:00.000Z' },
    ]);
    const quoted = await ib.seedMany([
      { name: `${scope} q-a`, status: 'quoted', submittedAt: '2026-03-07T10:03:00.000Z', priceCents: 1000 },
      { name: `${scope} q-b`, status: 'quoted', submittedAt: '2026-03-07T10:04:00.000Z' },
    ]);
    const won = await ib.seed({ name: `${scope} w-a`, status: 'won', submittedAt: '2026-03-07T10:05:00.000Z' });

    const ids = async (status?: string) => (await page(status === undefined ? { q: scope } : { q: scope, status })).data.map((item) => item.id);
    expect(await ids('new')).toEqual([...news].sort(byNewest).map((r) => r.id));
    expect(await ids('quoted')).toEqual([...quoted].sort(byNewest).map((r) => r.id));
    expect(await ids('won')).toEqual([won.id]);
    expect(await ids('lost')).toEqual([]);
    expect((await ids()).length).toBe(6);
    const empty = await page({ q: scope, status: 'lost' });
    expect(empty).toEqual({ data: [], next_cursor: null });
    for (const item of (await page({ q: scope, status: 'quoted' })).data) expect(item.status).toBe('quoted');
  });

  it('the status filter alone (what each Pipeline column sends, no q) returns only that status', async () => {
    for (const status of ['new', 'quoted', 'won', 'lost'] as const) {
      const body = await page({ status, limit: '5' });
      for (const item of body.data) expect(item.status).toBe(status);
    }
  });

  it('AC-016.10: 51 Quoted and 2 New: Quoted shows its 50 newest then 1 more, New shows both with no cursor', async () => {
    const scope = newScope();
    const base = Date.parse('2026-03-08T10:00:00.000Z');
    const quoted = await ib.seedMany(Array.from({ length: 51 }, (_, i) => ({ name: `${scope} q${i}`, status: 'quoted' as const, submittedAt: new Date(base + i * 60_000).toISOString() })));
    const news = await ib.seedMany([
      { name: `${scope} n0`, submittedAt: new Date(base + 100 * 60_000).toISOString() },
      { name: `${scope} n1`, submittedAt: new Date(base + 101 * 60_000).toISOString() },
    ]);
    const expectedQuoted = [...quoted].sort(byNewest).map((r) => r.id);

    const first = await page({ q: scope, status: 'quoted' });
    expect(first.data.map((item) => item.id)).toEqual(expectedQuoted.slice(0, 50));
    expect(first.next_cursor).not.toBeNull();
    const second = await page({ q: scope, status: 'quoted', cursor: first.next_cursor ?? '' });
    expect(second.data.map((item) => item.id)).toEqual(expectedQuoted.slice(50));
    expect(second.next_cursor).toBeNull();

    const newColumn = await page({ q: scope, status: 'new' });
    expect(newColumn.data.map((item) => item.id)).toEqual([...news].sort(byNewest).map((r) => r.id));
    expect(newColumn.next_cursor).toBeNull();
  });

  it('AC-013.1: the reference is found in any case; AC-013.2: nothing matching is data []', async () => {
    const scope = newScope();
    const target = await ib.seed({ name: `${scope} reference target` });
    await ib.seed({ name: `${scope} other` });
    // "is listed", not "is listed alone": the digits of a reference (3 or more) also search phone numbers, so on a shared
    // database an unrelated request whose phone contains them may come back too. Only the reference matches exactly.
    for (const typed of [target.reference, target.reference.toLowerCase(), ` ${target.reference.toLowerCase()} `]) {
      const body = await page({ q: typed, limit: '100' });
      expect(body.data.filter((item) => item.reference === target.reference).map((item) => item.id)).toEqual([target.id]);
      expect(body.data.map((item) => item.id)).toContain(target.id);
    }
    expect(await page({ q: `zzz${ib.tag}` })).toEqual({ data: [], next_cursor: null });
  });

  it('AC-013.3: part of a name, in any case, finds the request', async () => {
    const scope = newScope();
    const dana = await ib.seed({ name: `Dana Whitfield ${scope}` });
    await ib.seed({ name: `Sam Patel ${scope}` });
    for (const typed of [`whitfield ${scope}`, `WHITFIELD ${scope.toUpperCase()}`, `Dana Whitfield ${scope}`]) {
      expect((await page({ q: typed })).data.map((item) => item.id)).toEqual([dana.id]);
    }
  });

  it('the phone digits find the request however they are typed', async () => {
    const phone = '4165550' + String(Math.floor(Math.random() * 900) + 100);
    const request = await ib.seed({ name: `${newScope()} phone`, phone });
    const formatted = `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
    for (const typed of [phone, formatted, `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`]) {
      expect((await page({ q: typed })).data.map((item) => item.id)).toContain(request.id);
    }
  });

  it('search and the status filter combine, and search pages with the cursor', async () => {
    const scope = newScope();
    const base = Date.parse('2026-03-09T10:00:00.000Z');
    const matching = await ib.seedMany(Array.from({ length: 5 }, (_, i) => ({ name: `${scope} m${i}`, status: 'won' as const, submittedAt: new Date(base + i * 60_000).toISOString() })));
    await ib.seedMany(Array.from({ length: 3 }, (_, i) => ({ name: `${scope} x${i}`, status: 'lost' as const, submittedAt: new Date(base + i * 60_000).toISOString() })));
    expect(await allIds({ q: scope, status: 'won', limit: '2' })).toEqual([...matching].sort(byNewest).map((r) => r.id));
  });

  it('a blank search (spaces only) is the same as no search', async () => {
    const res = await listCall({ q: '   ', limit: '3' });
    expect(res.status).toBe(200);
    ListQuoteRequestsResponse.parse(await res.json());
  });

  it('SEC-13: search text is data, never a filter: SQL, PostgREST filter syntax and wildcards match only literally', async () => {
    const scope = newScope();
    const real = await ib.seed({ name: `${scope} real` });
    const attacks = [
      "'; drop table public.quote_requests; --",
      'a,b).or(status.eq.won',
      '%',
      '_',
      '\\',
      '"',
      "x' or '1'='1",
      'id.neq.00000000-0000-0000-0000-000000000000',
      '*',
      'x'.repeat(100),
    ];
    for (const typed of attacks) {
      const res = await listCall({ q: typed, limit: '100' });
      expect(res.status).toBe(200);
      const body = ListQuoteRequestsResponse.parse(await res.json());
      // only a name that really contains the text (or a reference that equals it) may come back: nothing matches "everything"
      for (const item of body.data) {
        expect(item.name.toLowerCase().includes(typed.trim().toLowerCase()) || item.reference === typed.trim().toUpperCase()).toBe(true);
      }
    }
    // the table is still there and the seeded row is still listed
    expect((await page({ q: scope })).data.map((item) => item.id)).toEqual([real.id]);
  });

  it('search text is not written to the log (it is part of the URL, which our log lines never carry)', async () => {
    const secretText = `zz-not-in-any-log-${ib.tag}`;
    const output = await captureOutput(async () => {
      expect((await listCall({ q: secretText })).status).toBe(200);
    });
    expect(output).toContain('GET /api/quote-requests');
    expect(output).not.toContain(secretText);
  });
});

describe('validation: 422 naming the field, with our own text', () => {
  const cases: Array<[string, string, string]> = [
    ['an unknown status', 'status=archived', 'status'],
    ['an empty status', 'status=', 'status'],
    ['a status in capitals', 'status=NEW', 'status'],
    ['limit 0', 'limit=0', 'limit'],
    ['limit 101', 'limit=101', 'limit'],
    ['a limit that is not a number', 'limit=abc', 'limit'],
    ['a limit with decimals', 'limit=1.5', 'limit'],
    ['a negative limit', 'limit=-1', 'limit'],
    ['an empty limit', 'limit=', 'limit'],
    ['an empty search', 'q=', 'q'],
    ['a search of 101 characters', `q=${'a'.repeat(101)}`, 'q'],
    ['a search with a NUL character', 'q=ab%00cd', 'q'],
    ['a parameter the contract does not have', 'page=2', 'page'],
    ['a repeated status', 'status=new&status=won', 'status'],
  ];

  it.each(cases)('%s', async (_name, query, field) => {
    const body = await expectProblem(await listCall(query), 422, 'validation_failed');
    expect(body.errors?.map((e) => e.field)).toContain(field);
    for (const error of body.errors ?? []) expect(error.message.length).toBeGreaterThan(0);
  });

  it('every bad parameter is named, once', async () => {
    const body = await expectProblem(await listCall('status=archived&limit=0&q=&extra=1'), 422, 'validation_failed');
    expect((body.errors ?? []).map((e) => e.field).sort()).toEqual(['extra', 'limit', 'q', 'status']);
  });

  it('the largest values the contract allows are accepted', async () => {
    expect((await listCall({ limit: '100', q: 'a'.repeat(100), status: 'won' })).status).toBe(200);
    expect((await listCall({ limit: '1' })).status).toBe(200);
  });
});

describe('failures are 500 internal_error with nothing from the database in the response or the log', () => {
  /** Answer the list RPC with a PostgREST error carrying a failing row's text; everything else goes to the real server. */
  function failRpc(status: number, code: string) {
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw).pathname.endsWith('/rpc/list_quote_requests')) {
        return new Response(
          JSON.stringify({ code, message: 'boom for Dana Whitfield 4165550123 dana@example.com', details: 'Failing row contains (Dana Whitfield, 14 Barton St W)', hint: 'secret hint' }),
          { status, headers: { 'content-type': 'application/json' } },
        );
      }
      return real(input, init);
    });
  }

  it.each([
    ['an internal error', 500, 'XX000'],
    ['a statement timeout (the contract lists no 503 here)', 500, '57014'],
    ['too many connections', 503, '53300'],
  ])('%s', async (_name, status, code) => {
    failRpc(status, code);
    const output = await captureOutput(async () => {
      const res = await listCall({ limit: '3' });
      const body = await expectProblem(res.clone(), 500, 'internal_error');
      expect(JSON.stringify(body)).not.toMatch(/Dana|4165550123|example\.com|Failing row|hint|boom/);
    });
    expect(output).not.toMatch(/Dana|4165550123|example\.com|Failing row|secret hint|boom/);
    const line = output
      .split('\n')
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .find((l) => l?.route === 'GET /api/quote-requests');
    expect(line).toMatchObject({ level: 'error', status: 500, error_class: 'postgrest', code });
  });

  it('a session that ended between the guard and the query (PT401) is 401 session_expired', async () => {
    failRpc(401, 'PT401');
    await expectProblem(await listCall({ limit: '3' }), 401, 'session_expired');
  });
});
