// @vitest-environment node
// POST /api/quote-requests/{request_id}/status-changes (operation changeQuoteRequestStatus) against the STAGING Supabase
// project, with a real staff session. The change goes through change_quote_request_status() (version checked, one
// transaction: status, audit row, event, stage-tag job). Next's after() runs the scheduled task at once under test, and the
// GHL seam (runGhlJobs) is replaced by a spy: no GoHighLevel call is possible. The stored rows are read with the service role.
//   AC-007.1 to .3  any status to any other         AC-007.4  the same status again changes nothing   AC-007.5  the list order stays
//   AC-007.7        previous, new, time and user    AC-016.6  a drop in the same column              AC-016.12 a stale move is 409
//   AC-017.5        no tag attempt for no change    AC-017.16 an unticked request queues nothing      metrics-spec: the event fires once
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listGet } from '@/app/api/quote-requests/route';
import { GET as detailGet } from '@/app/api/quote-requests/[request_id]/route';
import { GET as statusGet, POST as statusPost } from '@/app/api/quote-requests/[request_id]/status-changes/route';
import { ChangeQuoteRequestStatusResponse, GetQuoteRequestResponse, ListQuoteRequestsResponse } from '@/lib/api/generated/inbox/inbox.zod';
import { captureOutput, expectProblem } from '../../helpers/api';
import { idParams, inboxTools, staffRequest, type StaffSession } from '../../helpers/inbox';
import { setupStaging } from '../../helpers/staging';

const spies = vi.hoisted(() => ({ pending: [] as Promise<unknown>[], runGhlJobs: vi.fn() }));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    // outside a request scope the real after() throws; run the task now and let the test await it
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
  staff = await ib.staff('Owner (status test)');
});

beforeEach(() => {
  spies.pending.length = 0;
  spies.runGhlJobs.mockReset().mockResolvedValue({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const flush = async () => {
  await Promise.all(spies.pending.splice(0));
};

type Status = 'new' | 'quoted' | 'won' | 'lost';

function change(id: string, body: unknown, init: { rawBody?: string } = {}): Promise<Response> {
  const request = staffRequest(`/api/quote-requests/${id}/status-changes`, staff.token, init.rawBody === undefined ? { method: 'POST', body } : { method: 'POST', rawBody: init.rawBody });
  return Promise.resolve(statusPost(request, idParams(id)));
}

/** A 201 (real change) or 200 (no change), checked against the contract; returns the body. */
async function ok(id: string, to: Status, version: number, expected: 200 | 201 = 201) {
  const res = await change(id, { to_status: to, version });
  expect(res.status).toBe(expected);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  expect(res.headers.get('x-request-id')).toBeTruthy();
  const raw: unknown = await res.json();
  const body = ChangeQuoteRequestStatusResponse.parse(raw);
  expect(Object.keys(raw as object).sort()).toEqual(['changed', 'status', 'status_changed_at', 'version']);
  await flush();
  return body;
}

const detail = async (id: string) => {
  const res = await detailGet(staffRequest(`/api/quote-requests/${id}`, staff.token), idParams(id));
  expect(res.status).toBe(200);
  return GetQuoteRequestResponse.parse(await res.json());
};

const near = (time: string | null) => {
  expect(time).not.toBeNull();
  expect(Math.abs(Date.parse(time ?? '') - Date.now())).toBeLessThan(60_000);
};

describe('AC-007.1 to AC-007.3: any status to any other', () => {
  it('AC-007.1: new to won is 201 with changed true, the time and the next version; the detail and the list show won', async () => {
    const scope = `${ib.tag} ac1`;
    const request = await ib.seed({ name: scope });
    const body = await ok(request.id, 'won', 1);
    expect(body).toMatchObject({ changed: true, status: 'won', version: 2 });
    near(body.status_changed_at);
    expect(await ib.stored(request.id)).toMatchObject({ status: 'won', version: 2, last_staff_update_by: staff.id });
    expect(await detail(request.id)).toMatchObject({ status: 'won', status_changed_at: body.status_changed_at, version: 2 });
    const list = await listGet(staffRequest(`/api/quote-requests?q=${encodeURIComponent(scope)}`, staff.token), undefined);
    const page = ListQuoteRequestsResponse.parse(await list.json());
    expect(page.data).toMatchObject([{ id: request.id, status: 'won', version: 2 }]);
  });

  it('AC-007.2: new to quoted and later lost: both changes are stored with their times, in order', async () => {
    const request = await ib.seed({ name: `${ib.tag} ac2` });
    const quoted = await ok(request.id, 'quoted', 1);
    const lost = await ok(request.id, 'lost', quoted.version);
    expect([quoted.version, lost.version]).toEqual([2, 3]);
    const history = await ib.statusChanges(request.id);
    expect(history.map((h) => [h.from_status, h.to_status])).toEqual([
      ['new', 'quoted'],
      ['quoted', 'lost'],
    ]);
    expect(Date.parse(history[0]?.changed_at ?? '')).toBeLessThanOrEqual(Date.parse(history[1]?.changed_at ?? ''));
    expect(await ib.stored(request.id)).toMatchObject({ status: 'lost', version: 3 });
  });

  it('AC-007.3: won to lost is stored as a change from won to lost', async () => {
    const request = await ib.seed({ name: `${ib.tag} ac3`, status: 'won', statusChangedAt: '2026-03-02T15:00:00.000Z' });
    const body = await ok(request.id, 'lost', 1);
    expect(body.status).toBe('lost');
    expect(Date.parse(body.status_changed_at ?? '')).toBeGreaterThan(Date.parse('2026-03-02T15:00:00.000Z'));
    expect((await ib.statusChanges(request.id)).map((h) => [h.from_status, h.to_status])).toEqual([['won', 'lost']]);
  });

  it('every one of the 12 moves between two different statuses works, and none of them touches the price', async () => {
    const statuses: Status[] = ['new', 'quoted', 'won', 'lost'];
    for (const from of statuses) {
      for (const to of statuses.filter((s) => s !== from)) {
        const request = await ib.seed({ name: `${ib.tag} ${from}-${to}`, status: from, priceCents: 2500 });
        const body = await ok(request.id, to, 1);
        expect(body).toMatchObject({ changed: true, status: to, version: 2 });
        expect(await ib.stored(request.id)).toMatchObject({ status: to, price_cents: 2500 });
      }
    }
  });

  it('moving to quoted changes the status only: no price is required or set and no quoted event fires', async () => {
    const request = await ib.seed({ name: `${ib.tag} quoted no price` });
    await ok(request.id, 'quoted', 1);
    expect(await ib.stored(request.id)).toMatchObject({ status: 'quoted', price_cents: null, first_quoted_at: null });
    expect(await ib.events(request.id, 'quote_request_quoted')).toHaveLength(0);
  });
});

describe('AC-007.4, AC-016.6, AC-017.5: choosing the current status changes nothing', () => {
  it('is 200 with changed false, the same version and time, no history, no event, no job and no GHL attempt', async () => {
    const request = await ib.seed({ name: `${ib.tag} same`, status: 'quoted', statusChangedAt: '2026-03-02T15:00:00.000Z', consent: true });
    const body = await ok(request.id, 'quoted', 1, 200);
    expect(body).toEqual({ changed: false, status: 'quoted', status_changed_at: '2026-03-02T15:00:00.000Z', version: 1 });
    expect(await ib.statusChanges(request.id)).toHaveLength(0);
    expect(await ib.events(request.id, 'quote_request_status_changed')).toHaveLength(0);
    expect(await ib.jobs(request.id)).toHaveLength(0);
    expect(await ib.stored(request.id)).toMatchObject({ status: 'quoted', version: 1, last_staff_update_by: null, last_staff_update_at: null });
    expect(spies.runGhlJobs).not.toHaveBeenCalled();
  });

  it('a request that never changed status answers status_changed_at null', async () => {
    const request = await ib.seed({ name: `${ib.tag} same new` });
    const body = await ok(request.id, 'new', 1, 200);
    expect(body).toEqual({ changed: false, status: 'new', status_changed_at: null, version: 1 });
  });

  it('the same status with a stale version is still 409 (the version is checked first)', async () => {
    const request = await ib.seed({ name: `${ib.tag} same stale`, status: 'quoted' });
    await expectProblem(await change(request.id, { to_status: 'quoted', version: 5 }), 409, 'stale_version');
  });
});

describe('AC-007.7: previous status, new status, time and user are stored, and the event fires once', () => {
  it('writes one audit row and one quote_request_status_changed event for a real change', async () => {
    const request = await ib.seed({ name: `${ib.tag} audit` });
    const body = await ok(request.id, 'won', 1);
    const history = await ib.statusChanges(request.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from_status: 'new', to_status: 'won', changed_by: staff.id });
    near(history[0]?.changed_at ?? null);
    expect(history[0]?.changed_at && Date.parse(history[0].changed_at)).toBe(Date.parse(body.status_changed_at ?? ''));

    const events = await ib.events(request.id, 'quote_request_status_changed');
    expect(events).toHaveLength(1);
    expect(events[0]?.user_id).toBe(staff.id);
    expect(events[0]?.properties).toEqual({ request_id: request.id, from_status: 'new', to_status: 'won', user_id: staff.id });
  });

  it('each real change fires its own event, each same-status call fires none', async () => {
    const request = await ib.seed({ name: `${ib.tag} events` });
    let version = 1;
    for (const to of ['quoted', 'won', 'lost'] as const) version = (await ok(request.id, to, version)).version;
    await ok(request.id, 'lost', version, 200);
    await ok(request.id, 'lost', version, 200);
    const events = await ib.events(request.id, 'quote_request_status_changed');
    expect(events).toHaveLength(3);
    expect(events.map((e) => (e.properties as { to_status: string }).to_status).sort()).toEqual(['lost', 'quoted', 'won']);
    expect(await ib.statusChanges(request.id)).toHaveLength(3);
  });

  it('the history cannot be edited or deleted by a staff session (append-only)', async () => {
    const request = await ib.seed({ name: `${ib.tag} append only` });
    await ok(request.id, 'won', 1);
    const { createUserClient } = await import('@/lib/server/supabase');
    const asStaff = createUserClient(staff.token);
    const updated = await asStaff.from('quote_request_status_changes').update({ to_status: 'lost' }).eq('request_id', request.id).select();
    const deleted = await asStaff.from('quote_request_status_changes').delete().eq('request_id', request.id).select();
    expect(updated.data ?? []).toHaveLength(0);
    expect(deleted.data ?? []).toHaveLength(0);
    expect(await ib.statusChanges(request.id)).toHaveLength(1);
  });
});

describe('AC-007.5: a status change never moves the request in the list', () => {
  it('the order by submitted time is the same before and after a move (also AC-016.8: the moved card is not placed at the top)', async () => {
    const scope = `${ib.tag} order`;
    const a = await ib.seed({ name: `${scope} a`, status: 'won', submittedAt: '2026-03-02T14:10:00.000Z' });
    const b = await ib.seed({ name: `${scope} b`, submittedAt: '2026-03-02T14:00:00.000Z' });
    const c = await ib.seed({ name: `${scope} c`, status: 'won', submittedAt: '2026-03-02T08:00:00.000Z' });
    const ids = async (status: string) => {
      const res = await listGet(staffRequest(`/api/quote-requests?status=${status}&q=${encodeURIComponent(scope)}`, staff.token), undefined);
      return ListQuoteRequestsResponse.parse(await res.json()).data.map((r) => r.id);
    };
    expect(await ids('won')).toEqual([a.id, c.id]);
    await ok(b.id, 'won', 1); // submitted 14:00: between a (14:10) and c (08:00)
    expect(await ids('won')).toEqual([a.id, b.id, c.id]);
    expect(await ids('new')).toEqual([]);
  });
});

describe('AC-016.12 and AC-006.5: a stale version is 409 and nothing changes', () => {
  it('the owner drags a card still shown as new, but the helper already moved it to won', async () => {
    const request = await ib.seed({ name: `${ib.tag} stale`, consent: true });
    const helper = await ok(request.id, 'won', 1);
    expect(spies.runGhlJobs).toHaveBeenCalledTimes(1);
    spies.runGhlJobs.mockClear();

    const stale = await change(request.id, { to_status: 'lost', version: 1 });
    await expectProblem(stale, 409, 'stale_version');
    await flush();
    expect(await ib.stored(request.id)).toMatchObject({ status: 'won', version: helper.version });
    expect(await ib.statusChanges(request.id)).toHaveLength(1);
    expect(await ib.events(request.id, 'quote_request_status_changed')).toHaveLength(1);
    expect((await ib.jobs(request.id)).filter((j) => j.kind === 'stage_tag')).toEqual([{ kind: 'stage_tag', state: 'pending', target_status: 'won' }]);
    expect(spies.runGhlJobs).not.toHaveBeenCalled();
  });

  it('a stale price save and a stale status change both lose to whichever came first', async () => {
    const request = await ib.seed({ name: `${ib.tag} stale price` });
    const { PUT } = await import('@/app/api/quote-requests/[request_id]/quote/route');
    const saved = await PUT(staffRequest(`/api/quote-requests/${request.id}/quote`, staff.token, { method: 'PUT', body: { price_cents: 100, note: null, version: 1 } }), idParams(request.id));
    expect(saved.status).toBe(200);
    await expectProblem(await change(request.id, { to_status: 'won', version: 1 }), 409, 'stale_version');
    expect(await ib.stored(request.id)).toMatchObject({ status: 'new', price_cents: 100, version: 2 });
  });

  it('a version ahead of the stored one is 409 too', async () => {
    const request = await ib.seed({ name: `${ib.tag} ahead` });
    await expectProblem(await change(request.id, { to_status: 'won', version: 9 }), 409, 'stale_version');
    expect(await ib.stored(request.id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('five moves of the same version at once: exactly one wins, four are 409, one history row, one event, one job', async () => {
    const request = await ib.seed({ name: `${ib.tag} race`, consent: true });
    const targets: Status[] = ['quoted', 'won', 'lost', 'quoted', 'won'];
    const results = await Promise.all(targets.map((to) => change(request.id, { to_status: to, version: 1 })));
    await flush();
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    for (const res of results.filter((r) => r.status === 409)) await expectProblem(res, 409, 'stale_version');
    const winner = ChangeQuoteRequestStatusResponse.parse(await results.find((r) => r.status === 201)?.json());
    expect(winner.version).toBe(2);
    expect(await ib.stored(request.id)).toMatchObject({ status: winner.status, version: 2 });
    expect(await ib.statusChanges(request.id)).toHaveLength(1);
    expect(await ib.events(request.id, 'quote_request_status_changed')).toHaveLength(1);
    expect((await ib.jobs(request.id)).filter((j) => j.kind === 'stage_tag' && j.state === 'pending')).toHaveLength(1);
    expect(spies.runGhlJobs).toHaveBeenCalledTimes(1);
  });
});

describe('the stage-tag attempt after the response (US-017)', () => {
  it('a ticked request: the change queues one stage-tag job for the new status and the attempt runs once, for this request, after the response', async () => {
    const request = await ib.seed({ name: `${ib.tag} ticked`, consent: true });
    const res = await change(request.id, { to_status: 'quoted', version: 1 });
    expect(res.status).toBe(201);
    // the response is built; the attempt is scheduled, not run inline
    expect(spies.pending).toHaveLength(1);
    await flush();
    expect(spies.runGhlJobs).toHaveBeenCalledTimes(1);
    expect(spies.runGhlJobs).toHaveBeenCalledWith({ requestId: request.id });
    expect(await ib.jobs(request.id)).toEqual([{ kind: 'stage_tag', state: 'pending', target_status: 'quoted' }]);
  });

  it('AC-017.16: an unticked request: the status is saved, no job exists and the GHL seam is never called', async () => {
    const request = await ib.seed({ name: `${ib.tag} unticked`, consent: false });
    const body = await ok(request.id, 'won', 1);
    expect(body.status).toBe('won');
    expect(await ib.jobs(request.id)).toEqual([]);
    expect(spies.pending).toHaveLength(0);
    expect(spies.runGhlJobs).not.toHaveBeenCalled();
    expect((await detail(request.id)).ghl.stage_tag).toBeNull();
  });

  it('AC-017.6: a later change supersedes the waiting push: one active job, for the newest status, and an attempt per change', async () => {
    const request = await ib.seed({ name: `${ib.tag} supersede`, consent: true });
    const quoted = await ok(request.id, 'quoted', 1);
    await ok(request.id, 'won', quoted.version);
    const jobs = (await ib.jobs(request.id)).filter((j) => j.kind === 'stage_tag');
    expect(jobs.filter((j) => j.state === 'superseded').map((j) => j.target_status)).toEqual(['quoted']);
    expect(jobs.filter((j) => j.state === 'pending').map((j) => j.target_status)).toEqual(['won']);
    expect(spies.runGhlJobs).toHaveBeenCalledTimes(2);
    for (const call of spies.runGhlJobs.mock.calls) expect(call).toEqual([{ requestId: request.id }]);
  });

  it('GoHighLevel being down does not matter: a rejected attempt leaves the status saved, the 201 sent, and only { error_class, code } logged', async () => {
    class GhlStoreError extends Error {
      readonly code = '57014';
      constructor() {
        super('db said: Failing row contains (Dana Whitfield, 4165550123, dana@example.com) token=abc123');
        this.name = 'GhlStoreError';
      }
    }
    spies.runGhlJobs.mockRejectedValue(new GhlStoreError());
    const request = await ib.seed({ name: `${ib.tag} ghl down`, consent: true });
    const output = await captureOutput(async () => {
      const res = await change(request.id, { to_status: 'won', version: 1 });
      expect(res.status).toBe(201);
      ChangeQuoteRequestStatusResponse.parse(await res.json());
      await flush(); // the after() task rejects inside; it must be caught
    });
    expect(spies.runGhlJobs).toHaveBeenCalledTimes(1);
    expect(await ib.stored(request.id)).toMatchObject({ status: 'won', version: 2 });
    expect(output).not.toMatch(/Dana|4165550123|example\.com|Failing row|token=|abc123/);
    const line = output
      .split('\n')
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .find((l) => l?.outcome === 'ghl_stage_tag_attempt_failed');
    expect(line).toMatchObject({ level: 'error', quote_request_id: request.id, error_class: 'GhlStoreError', code: '57014' });
    expect(Object.keys(line ?? {}).sort()).toEqual(['code', 'error_class', 'level', 'outcome', 'quote_request_id', 'request_id']);
  });

  it('if the check for a queued job fails, the status is still saved and the attempt is still scheduled (it claims nothing without a job)', async () => {
    const request = await ib.seed({ name: `${ib.tag} check fails`, consent: true });
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw).pathname.endsWith('/rest/v1/ghl_sync_jobs')) {
        return new Response(JSON.stringify({ code: 'XX000', message: 'boom', details: null, hint: null }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return real(input, init);
    });
    const res = await change(request.id, { to_status: 'won', version: 1 });
    expect(res.status).toBe(201);
    await flush();
    expect(spies.runGhlJobs).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    expect(await ib.stored(request.id)).toMatchObject({ status: 'won', version: 2 });
  });
});

describe('validation: 422 naming the field, 400 for a body that is not an object, and nothing changes', () => {
  const cases: Array<[string, unknown, string]> = [
    ['an unknown status', { to_status: 'archived', version: 1 }, 'to_status'],
    ['a status in capitals', { to_status: 'WON', version: 1 }, 'to_status'],
    ['no to_status', { version: 1 }, 'to_status'],
    ['a null to_status', { to_status: null, version: 1 }, 'to_status'],
    ['no version', { to_status: 'won' }, 'version'],
    ['version 0', { to_status: 'won', version: 0 }, 'version'],
    ['a negative version', { to_status: 'won', version: -1 }, 'version'],
    ['a version with decimals', { to_status: 'won', version: 1.5 }, 'version'],
    ['a version as text', { to_status: 'won', version: '1' }, 'version'],
    ['a field the contract does not have', { to_status: 'won', version: 1, changed_by: '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10' }, 'changed_by'],
    ['a status field as well', { to_status: 'won', status: 'lost', version: 1 }, 'status'],
  ];

  it.each(cases)('%s', async (_name, payload, field) => {
    const request = await ib.seed({ name: `${ib.tag} validation`, consent: true });
    const body = await expectProblem(await change(request.id, payload), 422, 'validation_failed');
    expect(body.errors?.map((e) => e.field)).toContain(field);
    await flush();
    expect(await ib.stored(request.id)).toMatchObject({ status: 'new', version: 1 });
    expect(await ib.statusChanges(request.id)).toHaveLength(0);
    expect(await ib.jobs(request.id)).toHaveLength(0);
    expect(spies.runGhlJobs).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'this is not json'],
    ['an empty body', ''],
    ['a JSON array', '["won"]'],
    ['JSON null', 'null'],
    ['a JSON string', '"won"'],
  ])('%s is 400 bad_request', async (_name, rawBody) => {
    const request = await ib.seed({ name: `${ib.tag} bad body` });
    await expectProblem(await change(request.id, undefined, { rawBody }), 400, 'bad_request');
    expect(await ib.stored(request.id)).toMatchObject({ status: 'new', version: 1 });
  });
});

describe('unknown and pending ids are 404, and nothing is written', () => {
  it('an unknown uuid, an id that is not a uuid, and a request still pending', async () => {
    const pending = await ib.seed({ name: `${ib.tag} pending`, state: 'pending' });
    const valid = { to_status: 'won', version: 1 };
    await expectProblem(await change('00000000-0000-4000-8000-0000000000b5', valid), 404, 'not_found');
    await expectProblem(await change('not-a-uuid', valid), 404, 'not_found');
    await expectProblem(await change("1' or '1'='1", valid), 404, 'not_found');
    await expectProblem(await change(pending.id, valid), 404, 'not_found');
    await flush();
    expect(spies.runGhlJobs).not.toHaveBeenCalled();
    const stored = await staging.db().from('quote_requests').select('status, version').eq('id', pending.id).single();
    expect(stored.data).toEqual({ status: 'new', version: 1 });
    expect(await ib.statusChanges(pending.id)).toHaveLength(0);
  });
});

describe('failures and methods', () => {
  it('a database failure is 500 internal_error with nothing from the database in the response or the log, and no GHL attempt', async () => {
    const request = await ib.seed({ name: `${ib.tag} failure` });
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw).pathname.endsWith('/rpc/change_quote_request_status')) {
        return new Response(JSON.stringify({ code: 'XX000', message: 'boom for Dana Whitfield', details: 'Failing row contains (Dana Whitfield)', hint: 'secret hint' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return real(input, init);
    });
    const output = await captureOutput(async () => {
      const res = await change(request.id, { to_status: 'won', version: 1 });
      const body = await expectProblem(res.clone(), 500, 'internal_error');
      expect(JSON.stringify(body)).not.toMatch(/Dana|Failing row|hint|boom/);
    });
    expect(output).not.toMatch(/Dana|Failing row|secret hint|boom/);
    await flush();
    expect(spies.runGhlJobs).not.toHaveBeenCalled();
  });

  it('every method but POST is a 405 problem with Allow: POST', async () => {
    const request = await ib.seed({ name: `${ib.tag} methods` });
    const res = await statusGet(staffRequest(`/api/quote-requests/${request.id}/status-changes`, staff.token), idParams(request.id));
    await expectProblem(res, 405, 'method_not_allowed');
    expect(res.headers.get('allow')).toBe('POST');
  });
});
