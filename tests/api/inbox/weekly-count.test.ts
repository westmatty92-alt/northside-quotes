// @vitest-environment node
// GET /api/weekly-counts/current (operation getCurrentWeeklyCount) against the STAGING Supabase project, with a real staff
// session. The counts are global and staging is shared (other files of this run write requests and status changes into the
// current week while this one runs), so the tests are built to be exact whatever else is happening:
//   1. The week arithmetic (Monday 00:00 to Monday 00:00 in America/Toronto, the boundaries, won and lost by the date of the
//      change, daylight saving) is tested with absolute numbers in an ISOLATED week: a week in a far-future year that no other
//      row touches, read through app_private.weekly_counts_at(instant), the function behind the route (the route calls it with
//      now()). Rows are placed on exact boundaries.
//   2. The route itself, for the current week, is compared with an independent count made with the service role, read at a
//      quiet moment (the same number before and after the route call), and every row this file seeds or moves is checked
//      one by one for being counted or not.
//   AC-008.1  requests, won and lost this week      AC-008.2  a status change shows in the count    AC-008.3  Sunday 23:59:59 vs Monday 00:00:00
//   AC-008.4  won this week, submitted last week    AC-008.5  won then lost in one week             AC-008.6  the daylight saving weeks
//   AC-008.7  a week with no activity is 0, 0, 0    AC-008.8  the count failing is a 500 the screen shows as "Count unavailable"
import { randomInt } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as statusPost } from '@/app/api/quote-requests/[request_id]/status-changes/route';
import { GET, POST } from '@/app/api/weekly-counts/current/route';
import { GetCurrentWeeklyCountResponse } from '@/lib/api/generated/weekly-count/weekly-count.zod';
import { captureOutput, expectProblem } from '../../helpers/api';
import { idParams, inboxTools, psqlOutput, staffRequest, type SeedOptions, type StaffSession } from '../../helpers/inbox';
import { setupStaging } from '../../helpers/staging';

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

let staff: StaffSession;

beforeAll(async () => {
  staff = await ib.staff('Owner (weekly test)');
});

beforeEach(() => {
  spies.pending.length = 0;
  spies.runGhlJobs.mockReset().mockResolvedValue({ claimed: 0, succeeded: 0, waiting: 0, failed: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Counts = { requests: number; won: number; lost: number };
type Week = { start: string; end: string } & Counts;

/** The wall-clock parts of an instant in America/Toronto. */
function toronto(instant: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: get('weekday'), date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}:${get('second')}` };
}

const plus = (instant: string, ms: number) => new Date(Date.parse(instant) + ms).toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

// ---- the route -----------------------------------------------------------------------------------------------------------

async function route() {
  const res = await GET(staffRequest('/api/weekly-counts/current', staff.token), undefined);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  expect(res.headers.get('x-request-id')).toBeTruthy();
  expect(res.headers.get('cache-control')).toContain('no-store');
  const raw: unknown = await res.json();
  const body = GetCurrentWeeklyCountResponse.parse(raw);
  expect(Object.keys(raw as object).sort()).toEqual(['lost', 'requests', 'time_zone', 'week_end', 'week_start', 'won']);
  return body;
}

async function move(id: string, to: 'new' | 'quoted' | 'won' | 'lost', version: number, expected: 200 | 201 = 201) {
  const res = await statusPost(staffRequest(`/api/quote-requests/${id}/status-changes`, staff.token, { method: 'POST', body: { to_status: to, version } }), idParams(id));
  expect(res.status).toBe(expected);
  await Promise.all(spies.pending.splice(0));
}

// ---- the independent count (service role, plain queries; not the function under test) ------------------------------------------

async function independentCount(start: string, end: string): Promise<Counts> {
  const db = staging.db();
  const head = { count: 'exact', head: true } as const;
  const [requests, won, lost] = await Promise.all([
    db.from('quote_requests').select('id', head).eq('state', 'submitted').gte('submitted_at', start).lt('submitted_at', end),
    db.from('quote_requests').select('id', head).eq('state', 'submitted').eq('status', 'won').gte('status_changed_at', start).lt('status_changed_at', end),
    db.from('quote_requests').select('id', head).eq('state', 'submitted').eq('status', 'lost').gte('status_changed_at', start).lt('status_changed_at', end),
  ]);
  for (const part of [requests, won, lost]) expect(part.error).toBeNull();
  return { requests: requests.count ?? -1, won: won.count ?? -1, lost: lost.count ?? -1 };
}

/** Is this stored request counted in this week, as requests, as won, as lost? (the three rules, applied in JS to the stored row) */
async function counted(id: string, start: string, end: string): Promise<{ requests: boolean; won: boolean; lost: boolean }> {
  const { data, error } = await staging.db().from('quote_requests').select('state, status, submitted_at, status_changed_at').eq('id', id).single();
  expect(error).toBeNull();
  const inWeek = (time: string | null) => time !== null && Date.parse(time) >= Date.parse(start) && Date.parse(time) < Date.parse(end);
  const submitted = data?.state === 'submitted';
  return {
    requests: submitted && inWeek(data?.submitted_at ?? null),
    won: submitted && data?.status === 'won' && inWeek(data?.status_changed_at ?? null),
    lost: submitted && data?.status === 'lost' && inWeek(data?.status_changed_at ?? null),
  };
}

/**
 * The route's answer and the independent count of the same week, taken while nothing else changed it (the independent count
 * is the same before and after the route call). Retries while other files write; fails only if it never gets a quiet moment.
 */
async function quietComparison() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const first = await route();
    const before = await independentCount(first.week_start, first.week_end);
    const api = await route();
    const after = await independentCount(first.week_start, first.week_end);
    if (before.requests === after.requests && before.won === after.won && before.lost === after.lost && api.week_start === first.week_start) {
      return { api, independent: after };
    }
    await sleep(500);
  }
  throw new Error('the current week kept changing for 30 seconds: no quiet moment to compare the route with the independent count');
}

describe('the route: this week, Monday 00:00 to the next Monday 00:00 in America/Toronto', () => {
  it('week_start is a Monday at 00:00:00 Toronto time, week_end is the next Monday at 00:00:00, and now is inside', async () => {
    const week = await route();
    expect(week.time_zone).toBe('America/Toronto');
    expect(toronto(week.week_start)).toMatchObject({ weekday: 'Mon', time: '00:00:00' });
    expect(toronto(week.week_end)).toMatchObject({ weekday: 'Mon', time: '00:00:00' });
    expect(Date.parse(week.week_start)).toBeLessThanOrEqual(Date.now());
    expect(Date.now()).toBeLessThan(Date.parse(week.week_end));
    // seven calendar days apart in Toronto (168 hours, or 167 or 169 in a daylight saving week)
    const days = (Date.parse(`${toronto(week.week_end).date}T00:00:00Z`) - Date.parse(`${toronto(week.week_start).date}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(7);
    expect([167, 168, 169]).toContain(hoursBetween(week.week_start, week.week_end));
  });

  it('only the current week is offered: no parameter picks another week (NG-10)', async () => {
    const plain = await route();
    const res = await GET(staffRequest('/api/weekly-counts/current?week=2026-01-05', staff.token), undefined);
    expect(GetCurrentWeeklyCountResponse.parse(await res.json()).week_start).toBe(plain.week_start);
  });

  it('the three numbers are exactly the independent count of requests, won and lost in that week, with rows of every kind present', async () => {
    const week = await route();
    const lastWeek = plus(week.week_start, -3 * 86_400_000);
    const now = new Date().toISOString();
    const rows: Array<[string, SeedOptions, { requests: boolean; won: boolean; lost: boolean }]> = [
      ['submitted this week, new', { label: 'w-new' }, { requests: true, won: false, lost: false }],
      ['submitted this week, quoted a moment ago', { label: 'w-quoted', status: 'quoted', statusChangedAt: now }, { requests: true, won: false, lost: false }],
      ['submitted this week, won now', { label: 'w-won', status: 'won', statusChangedAt: now }, { requests: true, won: true, lost: false }],
      ['submitted this week, lost now', { label: 'w-lost', status: 'lost', statusChangedAt: now }, { requests: true, won: false, lost: true }],
      ['AC-008.4: submitted last week, won this week', { label: 'old-won', submittedAt: lastWeek, status: 'won', statusChangedAt: now }, { requests: false, won: true, lost: false }],
      ['submitted last week, lost this week', { label: 'old-lost', submittedAt: lastWeek, status: 'lost', statusChangedAt: now }, { requests: false, won: false, lost: true }],
      ['submitted last week, won last week', { label: 'old-old-won', submittedAt: lastWeek, status: 'won', statusChangedAt: plus(week.week_start, -1000) }, { requests: false, won: false, lost: false }],
      ['AC-008.3: submitted Sunday 23:59:59 Toronto time, last week', { label: 'sunday', submittedAt: plus(week.week_start, -1000) }, { requests: false, won: false, lost: false }],
      ['AC-008.3: submitted Monday 00:00:00 Toronto time', { label: 'monday', submittedAt: week.week_start }, { requests: true, won: false, lost: false }],
      ['still pending', { label: 'pending', state: 'pending' }, { requests: false, won: false, lost: false }],
    ];
    const made: Array<{ id: string; expected: { requests: boolean; won: boolean; lost: boolean }; name: string }> = [];
    for (const [name, options, expected] of rows) made.push({ id: (await ib.seed({ ...options, name: `${ib.tag} ${options.label}` })).id, expected, name });

    for (const item of made) expect(await counted(item.id, week.week_start, week.week_end), item.name).toEqual(item.expected);

    const { api, independent } = await quietComparison();
    expect({ requests: api.requests, won: api.won, lost: api.lost }).toEqual(independent);
    // this test's own rows alone contribute 5 requests, 2 won and 2 lost, so the global numbers are at least that
    expect(api.requests).toBeGreaterThanOrEqual(made.filter((m) => m.expected.requests).length);
    expect(api.won).toBeGreaterThanOrEqual(made.filter((m) => m.expected.won).length);
    expect(api.lost).toBeGreaterThanOrEqual(made.filter((m) => m.expected.lost).length);
  });

  it('AC-008.2 and AC-008.5: marking a request won, then lost, through the real status route moves it between the counts, and the route agrees with the independent count each time', async () => {
    const request = await ib.seed({ name: `${ib.tag} flow` });
    const { api: start } = await quietComparison();
    expect(await counted(request.id, start.week_start, start.week_end)).toEqual({ requests: true, won: false, lost: false });

    await move(request.id, 'won', 1);
    const won = await quietComparison();
    expect(await counted(request.id, won.api.week_start, won.api.week_end)).toEqual({ requests: true, won: true, lost: false });
    expect({ requests: won.api.requests, won: won.api.won, lost: won.api.lost }).toEqual(won.independent);

    await move(request.id, 'lost', 2); // won on Tuesday, lost on Wednesday: won counts 0 for it, lost counts 1
    const lost = await quietComparison();
    expect(await counted(request.id, lost.api.week_start, lost.api.week_end)).toEqual({ requests: true, won: false, lost: true });
    expect({ requests: lost.api.requests, won: lost.api.won, lost: lost.api.lost }).toEqual(lost.independent);

    await move(request.id, 'lost', 3, 200); // the same status again changes nothing
    expect(await counted(request.id, lost.api.week_start, lost.api.week_end)).toEqual({ requests: true, won: false, lost: true });

    await move(request.id, 'quoted', 3); // out of both
    const quoted = await quietComparison();
    expect(await counted(request.id, quoted.api.week_start, quoted.api.week_end)).toEqual({ requests: true, won: false, lost: false });
    expect({ requests: quoted.api.requests, won: quoted.api.won, lost: quoted.api.lost }).toEqual(quoted.independent);
  });
});

// ---- the isolated week ---------------------------------------------------------------------------------------------------------

/** app_private.weekly_counts_at(instant), as UTC text and numbers. */
function dbWeek(instant: string): Week {
  const [start, end, requests, won, lost] = psqlOutput(
    `select to_char(week_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(week_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), requests, won, lost from app_private.weekly_counts_at('${instant}'::timestamptz);`,
  )
    .trim()
    .split('|');
  return { start: start ?? '', end: end ?? '', requests: Number(requests), won: Number(won), lost: Number(lost) };
}

const usedYears = new Set<number>();

/**
 * A week in a far-future year, with nothing in it and around it: `instant(year)` says which day of the year the week must contain.
 * Absolute counts are exact in it, because no other row of any run is anywhere near.
 */
async function emptyWeek(instant: (year: number) => string): Promise<Week> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const year = 2040 + randomInt(0, 60);
    if (usedYears.has(year)) continue;
    const week = dbWeek(instant(year));
    const db = staging.db();
    const around = { from: plus(week.start, -3 * 86_400_000), to: plus(week.end, 3 * 86_400_000) };
    const [submitted, changed] = await Promise.all([
      db.from('quote_requests').select('id', { count: 'exact', head: true }).gte('submitted_at', around.from).lt('submitted_at', around.to),
      db.from('quote_requests').select('id', { count: 'exact', head: true }).gte('status_changed_at', around.from).lt('status_changed_at', around.to),
    ]);
    if (submitted.count === 0 && changed.count === 0) {
      usedYears.add(year);
      return week;
    }
  }
  throw new Error('no empty week found in 2040 to 2099');
}

const midWeek = (year: number) => `${year}-06-10T16:00:00Z`;
/** The first Sunday of November (daylight saving ends at 02:00 that day), at noon UTC. */
const dstEnds = (year: number) => `${year}-11-${String(1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7)).padStart(2, '0')}T12:00:00Z`;
/** The second Sunday of March (daylight saving starts at 02:00 that day), at noon UTC. */
const dstStarts = (year: number) => `${year}-03-${String(8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7)).padStart(2, '0')}T12:00:00Z`;

describe('the week arithmetic in an isolated week (absolute numbers, whatever else runs)', () => {
  it('AC-008.7: a week with no activity is 0, 0 and 0', async () => {
    const week = await emptyWeek(midWeek);
    expect({ requests: week.requests, won: week.won, lost: week.lost }).toEqual({ requests: 0, won: 0, lost: 0 });
  });

  it('AC-008.3: requests are counted by submitted time: Monday 00:00:00 and the last second of Sunday are in; Sunday 23:59:59 before and Monday 00:00:00 after are out', async () => {
    const week = await emptyWeek(midWeek);
    await ib.seedMany([
      { name: `${ib.tag} sunday night before`, submittedAt: plus(week.start, -1000) },
      { name: `${ib.tag} monday midnight`, submittedAt: week.start },
      { name: `${ib.tag} wednesday`, submittedAt: plus(week.start, 2 * 86_400_000) },
      { name: `${ib.tag} last second`, submittedAt: plus(week.end, -1000) },
      { name: `${ib.tag} next monday`, submittedAt: week.end },
      { name: `${ib.tag} last year`, submittedAt: plus(week.start, -365 * 86_400_000) },
    ]);
    expect(dbWeek(plus(week.start, 3 * 86_400_000))).toMatchObject({ start: week.start, end: week.end, requests: 3, won: 0, lost: 0 });
  });

  it('AC-008.1: 4 requests, 1 of them won and 1 lost this week, show as 4, 1 and 1', async () => {
    const week = await emptyWeek(midWeek);
    const at = (days: number) => plus(week.start, days * 86_400_000);
    await ib.seedMany([
      { name: `${ib.tag} a`, submittedAt: at(1) },
      { name: `${ib.tag} b`, submittedAt: at(1), status: 'won', statusChangedAt: at(2) },
      { name: `${ib.tag} c`, submittedAt: at(2), status: 'lost', statusChangedAt: at(3) },
      { name: `${ib.tag} d`, submittedAt: at(3) },
    ]);
    expect(dbWeek(at(3))).toMatchObject({ requests: 4, won: 1, lost: 1 });
  });

  it('AC-008.4: a request submitted last week and marked won this week counts as won and not as a request', async () => {
    const week = await emptyWeek(midWeek);
    const lastWeek = plus(week.start, -4 * 86_400_000);
    await ib.seedMany([
      { name: `${ib.tag} old won`, submittedAt: lastWeek, status: 'won', statusChangedAt: plus(week.start, 86_400_000) },
      { name: `${ib.tag} old lost`, submittedAt: lastWeek, status: 'lost', statusChangedAt: plus(week.start, 2 * 86_400_000) },
    ]);
    expect(dbWeek(plus(week.start, 3 * 86_400_000))).toMatchObject({ requests: 0, won: 1, lost: 1 });
  });

  it('won and lost follow the date of the change: before Monday 00:00 is last week, Monday 00:00:00 to the last second is this week, next Monday 00:00:00 is not', async () => {
    const week = await emptyWeek(midWeek);
    const old = plus(week.start, -10 * 86_400_000);
    const kinds = ['won', 'lost'] as const;
    const rows: SeedOptions[] = [];
    for (const status of kinds) {
      for (const [label, changed] of [
        ['sunday night before', plus(week.start, -1000)],
        ['monday midnight', week.start],
        ['last second', plus(week.end, -1000)],
        ['next monday', week.end],
      ] as const) {
        rows.push({ name: `${ib.tag} ${status} ${label}`, submittedAt: old, status, statusChangedAt: changed });
      }
    }
    await ib.seedMany(rows);
    expect(dbWeek(plus(week.start, 3 * 86_400_000))).toMatchObject({ requests: 0, won: 2, lost: 2 });
  });

  it('AC-008.5: a request won on Tuesday and lost on Wednesday of the same week counts for lost only (the count follows the current status)', async () => {
    const week = await emptyWeek(midWeek);
    await ib.seed({ name: `${ib.tag} won then lost`, submittedAt: plus(week.start, 86_400_000), status: 'lost', statusChangedAt: plus(week.start, 2 * 86_400_000) });
    expect(dbWeek(plus(week.start, 3 * 86_400_000))).toMatchObject({ requests: 1, won: 0, lost: 1 });
  });

  it('quoted and new requests are never won or lost, however recently they changed; a pending request is never counted at all', async () => {
    const week = await emptyWeek(midWeek);
    const inside = plus(week.start, 2 * 86_400_000);
    await ib.seedMany([
      { name: `${ib.tag} quoted`, submittedAt: inside, status: 'quoted', statusChangedAt: inside },
      { name: `${ib.tag} new again`, submittedAt: inside, status: 'new', statusChangedAt: inside },
      { name: `${ib.tag} pending won`, state: 'pending', status: 'won', statusChangedAt: inside },
    ]);
    expect(dbWeek(inside)).toMatchObject({ requests: 2, won: 0, lost: 0 });
  });

  it('AC-008.6: the week in which daylight saving ends (169 hours) still runs Monday 00:00 to Monday 00:00 Toronto time, and counts Sunday 23:59:59', async () => {
    const week = await emptyWeek(dstEnds);
    expect(toronto(week.start)).toMatchObject({ weekday: 'Mon', time: '00:00:00' });
    expect(toronto(week.end)).toMatchObject({ weekday: 'Mon', time: '00:00:00' });
    expect(hoursBetween(week.start, week.end)).toBe(169);
    expect(week.start.endsWith('T04:00:00Z')).toBe(true); // midnight Toronto, still daylight time (UTC-4)
    expect(week.end.endsWith('T05:00:00Z')).toBe(true); // midnight Toronto, standard time (UTC-5)
    const sundayNight = toronto(plus(week.end, -1000));
    expect(sundayNight).toMatchObject({ weekday: 'Sun', time: '23:59:59' });
    await ib.seedMany([
      { name: `${ib.tag} dst sunday 23:59:59`, submittedAt: plus(week.end, -1000) },
      { name: `${ib.tag} dst monday 00:00:00`, submittedAt: week.end },
      { name: `${ib.tag} dst before`, submittedAt: plus(week.start, -1000) },
      { name: `${ib.tag} dst start`, submittedAt: week.start },
    ]);
    expect(dbWeek(plus(week.start, 3 * 86_400_000))).toMatchObject({ start: week.start, end: week.end, requests: 2 });
  });

  it('the week in which daylight saving starts is 167 hours long and runs Monday 00:00 to Monday 00:00 Toronto time', async () => {
    const week = await emptyWeek(dstStarts);
    expect(toronto(week.start)).toMatchObject({ weekday: 'Mon', time: '00:00:00' });
    expect(toronto(week.end)).toMatchObject({ weekday: 'Mon', time: '00:00:00' });
    expect(hoursBetween(week.start, week.end)).toBe(167);
  });

  it('for any instant, the week starts on a Monday at 00:00:00 Toronto time, ends 7 calendar days later, and contains the instant', () => {
    const instants = [
      '2026-11-20T15:00:00Z',
      '2026-11-02T04:59:59Z', // Sunday 23:59:59 Toronto
      '2026-11-02T05:00:00Z', // Monday 00:00:00 Toronto
      '2026-11-01T05:59:59Z', // the hour daylight saving ends
      '2026-03-08T06:59:59Z',
      '2026-03-09T03:59:59Z',
      '2027-01-01T00:00:00Z',
      '2027-12-31T23:59:59Z',
      '2028-02-29T12:00:00Z',
    ];
    for (const instant of instants) {
      const week = dbWeek(instant);
      expect(toronto(week.start), instant).toMatchObject({ weekday: 'Mon', time: '00:00:00' });
      expect(toronto(week.end), instant).toMatchObject({ weekday: 'Mon', time: '00:00:00' });
      expect(Date.parse(week.start), instant).toBeLessThanOrEqual(Date.parse(instant));
      expect(Date.parse(instant), instant).toBeLessThan(Date.parse(week.end));
      const days = (Date.parse(`${toronto(week.end).date}T00:00:00Z`) - Date.parse(`${toronto(week.start).date}T00:00:00Z`)) / 86_400_000;
      expect(days, instant).toBe(7);
    }
  });
});

describe('failures and methods', () => {
  it('AC-008.8: a database failure is 500 internal_error ("Count unavailable" on screen) with nothing from the database in the response or the log', async () => {
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw).pathname.endsWith('/rpc/weekly_counts')) {
        return new Response(JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout for Dana Whitfield', details: null, hint: 'secret hint' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return real(input, init);
    });
    const output = await captureOutput(async () => {
      const res = await GET(staffRequest('/api/weekly-counts/current', staff.token), undefined);
      const body = await expectProblem(res.clone(), 500, 'internal_error');
      expect(JSON.stringify(body)).not.toMatch(/Dana|timeout|hint/);
    });
    expect(output).not.toMatch(/Dana|statement timeout|secret hint/);
    expect(output).toContain('"code":"57014"');
  });

  it('every method but GET is a 405 problem with Allow: GET', async () => {
    const res = await POST(staffRequest('/api/weekly-counts/current', staff.token, { method: 'POST' }), undefined);
    await expectProblem(res, 405, 'method_not_allowed');
    expect(res.headers.get('allow')).toBe('GET');
  });
});
