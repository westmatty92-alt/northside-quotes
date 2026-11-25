// @vitest-environment node
// BUG-QA2-4 (QA2 fuzz, regression probe PRB-45): `version` outside what the database column holds was a 500.
// PUT /api/quote-requests/{id}/quote and POST /api/quote-requests/{id}/status-changes pass `version` to
// save_quote_request_quote() / change_quote_request_status(), whose argument is a 32-bit integer (quote_requests.version is
// `integer`). A number above 2,147,483,647 reached the database, which refused it (SQLSTATE 22003), and that became a 500.
// The rule: a version that is not a whole number from 1 to 2,147,483,647 is a 422 naming `version`, answered before the
// request row or either function is touched, whether or not the request exists. The raw JSON text is sent, as QA's probe does.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as statusPost } from '@/app/api/quote-requests/[request_id]/status-changes/route';
import { PUT as quotePut } from '@/app/api/quote-requests/[request_id]/quote/route';
import { captureOutput, expectProblem } from '../../helpers/api';
import { idParams, inboxTools, staffRequest, type StaffSession } from '../../helpers/inbox';
import { setupStaging } from '../../helpers/staging';

const spies = vi.hoisted(() => ({ runGhlJobs: vi.fn() }));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (task: unknown) => void (typeof task === 'function' ? (task as () => unknown)() : task) };
});
vi.mock('@/lib/server/integrations/ghl', () => ({ runGhlJobs: spies.runGhlJobs }));

const staging = setupStaging();
const ib = inboxTools(staging);

let staff: StaffSession;

beforeAll(async () => {
  staff = await ib.staff('Owner (version range test)');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const INT32_MAX = '2147483647';
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000b6';

type Route = { name: string; send: (id: string, versionJson: string) => Promise<Response>; rpc: string };

const routes: Route[] = [
  {
    name: 'PUT quote',
    rpc: 'save_quote_request_quote',
    send: (id, versionJson) =>
      Promise.resolve(quotePut(staffRequest(`/api/quote-requests/${id}/quote`, staff.token, { method: 'PUT', rawBody: `{"note":"","price_cents":6895,"version":${versionJson}}` }), idParams(id))),
  },
  {
    name: 'POST status-changes',
    rpc: 'change_quote_request_status',
    send: (id, versionJson) =>
      Promise.resolve(statusPost(staffRequest(`/api/quote-requests/${id}/status-changes`, staff.token, { method: 'POST', rawBody: `{"to_status":"new","version":${versionJson}}` }), idParams(id))),
  },
];

/** Every version the contract's `minimum: 1` lets through but the column cannot hold, and the other kinds of bad number. */
const refused: Array<[string, string]> = [
  ['int32 max + 1', '2147483648'],
  ['the value that broke the status change (10000000001)', '10000000001'],
  ['the value that broke the quote save (367499305219)', '367499305219'],
  ['1e10 (a whole number written with an exponent)', '1e10'],
  ['2147483648.0', '2147483648.0'],
  ['the largest exact JavaScript integer', '9007199254740991'],
  ['one past it (not exact in JavaScript)', '9007199254740993'],
  ['a 34-digit number', '1687381385382380550179543211573248'],
  ['1e400 (parses to Infinity)', '1e400'],
  ['a float', '1.5'],
  ['a float just above int32 max', '2147483647.5'],
  ['a tiny float', '1e-7'],
  ['zero', '0'],
  ['minus zero', '-0'],
  ['minus one', '-1'],
  ['int32 min - 1', '-2147483649'],
  ['a huge negative', '-9999999999999'],
  ['a huge negative with 34 digits', '-1687381385382380550179543211573248'],
  ['text that looks like a number', '"1"'],
  ['text with a huge number', '"10000000001"'],
  ['true', 'true'],
  ['null', 'null'],
  ['an array', '[1]'],
  ['an object', '{"v":1}'],
];

describe.each(routes)('$name: a version the column cannot hold is 422 naming version, never a 500 (BUG-QA2-4)', (route) => {
  it.each(refused)('an existing request, version %s', async (_label, versionJson) => {
    const request = await ib.seed({ name: `${ib.tag} existing` });
    const calls: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname);
      return real(input, init);
    });
    let status = 0;
    const output = await captureOutput(async () => {
      const res = await route.send(request.id, versionJson);
      status = res.status;
      const body = await expectProblem(res, 422, 'validation_failed');
      expect(body.errors?.map((e) => e.field)).toEqual(['version']);
      expect(JSON.stringify(body)).not.toMatch(/out of range|integer|22003|postgres/i);
    });
    expect(status).toBe(422);
    expect(output).not.toMatch(/postgrest|22003/); // a database failure logs error_class postgrest and its SQLSTATE
    // before any database call: neither the function nor the request table was reached
    expect(calls.filter((path) => path.includes(`/rpc/${route.rpc}`) || path.includes('/quote_requests'))).toEqual([]);
    expect(await ib.stored(request.id)).toMatchObject({ status: 'new', price_cents: null, note: null, version: 1 });
    expect(await ib.statusChanges(request.id)).toHaveLength(0);
  });

  it.each(refused)('an unknown request id, version %s: the 422 comes before the 404', async (_label, versionJson) => {
    const res = await route.send(UNKNOWN_ID, versionJson);
    const body = await expectProblem(res, 422, 'validation_failed');
    expect(body.errors?.map((e) => e.field)).toEqual(['version']);
  });

  it('the top of the range is accepted by validation: int32 max is 409 stale_version for an existing request and 404 for an unknown one', async () => {
    const request = await ib.seed({ name: `${ib.tag} top of range` });
    await expectProblem(await route.send(request.id, INT32_MAX), 409, 'stale_version');
    await expectProblem(await route.send(UNKNOWN_ID, INT32_MAX), 404, 'not_found');
    expect(await ib.stored(request.id)).toMatchObject({ price_cents: null, note: null, version: 1 });
  });

  it('1.0 is the whole number 1 and is accepted', async () => {
    const request = await ib.seed({ name: `${ib.tag} one` });
    const res = await route.send(request.id, '1.0');
    expect([200, 201]).toContain(res.status);
  });
});
