// @vitest-environment node
// PUT /api/quote-requests/{request_id}/quote (operation saveQuote) against the STAGING Supabase project, with a real staff
// session. The write goes through save_quote_request_quote() (version checked, one transaction); these tests read the stored
// row with the service role to prove what the database holds, not only what the API said.
//   AC-006.1  price and note survive a reload      AC-006.2  a note with no price      AC-006.3  the price limits (422)
//   AC-006.4  1,000 characters                      AC-006.5  a stale save is 409       AC-006.6  a new price replaces the old
//   metrics-spec: quote_request_quoted fires once, with the first price ever saved, and never for a note
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as detailGet } from '@/app/api/quote-requests/[request_id]/route';
import { PUT as quotePut, GET as quoteGet, POST as quotePost } from '@/app/api/quote-requests/[request_id]/quote/route';
import { GetQuoteRequestResponse, SaveQuoteResponse } from '@/lib/api/generated/inbox/inbox.zod';
import { captureOutput, expectProblem } from '../../helpers/api';
import { idParams, inboxTools, staffRequest, type StaffSession } from '../../helpers/inbox';
import { setupStaging } from '../../helpers/staging';

const staging = setupStaging();
const ib = inboxTools(staging);

let staff: StaffSession;

beforeAll(async () => {
  staff = await ib.staff('Owner (quote test)');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** PUT the body; `rawBody` sends text as it is. */
function save(id: string, body: unknown, init: { rawBody?: string; token?: string } = {}): Promise<Response> {
  const request = staffRequest(`/api/quote-requests/${id}/quote`, init.token ?? staff.token, init.rawBody === undefined ? { method: 'PUT', body } : { method: 'PUT', rawBody: init.rawBody });
  return Promise.resolve(quotePut(request, idParams(id)));
}

async function okSave(id: string, body: unknown) {
  const res = await save(id, body);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  expect(res.headers.get('x-request-id')).toBeTruthy();
  const raw: unknown = await res.json();
  const parsed = SaveQuoteResponse.parse(raw);
  expect(Object.keys(raw as object)).toHaveLength(21); // the whole QuoteRequestDetail, nothing more
  return parsed;
}

const reload = async (id: string) => {
  const res = await detailGet(staffRequest(`/api/quote-requests/${id}`, staff.token), idParams(id));
  expect(res.status).toBe(200);
  return GetQuoteRequestResponse.parse(await res.json());
};

describe('AC-006.1 and AC-006.2: price and note are stored', () => {
  it('AC-006.1: saves 450.00 and a note, returns the updated request, and a reload shows both; the status stays new', async () => {
    const request = await ib.seed({ name: `${ib.tag} ac1`, submittedAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    const body = await okSave(request.id, { price_cents: 45000, note: 'Replace cartridge, 2 hours, can come Thursday', version: 1 });
    expect(body).toMatchObject({ id: request.id, price_cents: 45000, note: 'Replace cartridge, 2 hours, can come Thursday', version: 2, status: 'new', status_changed_at: null });
    expect(body.last_updated?.by_display_name).toBe(staff.displayName);
    expect(Math.abs(Date.parse(body.last_updated?.at ?? '') - Date.now())).toBeLessThan(60_000);

    const after = await reload(request.id);
    expect(after).toMatchObject({ price_cents: 45000, note: 'Replace cartridge, 2 hours, can come Thursday', version: 2, status: 'new' });
    expect(await ib.stored(request.id)).toMatchObject({ price_cents: 45000, note: 'Replace cartridge, 2 hours, can come Thursday', version: 2, last_staff_update_by: staff.id });
  });

  it('records quote_request_quoted once, with request_id and minutes_since_submit and nothing personal', async () => {
    const request = await ib.seed({ name: `${ib.tag} event`, submittedAt: new Date(Date.now() - 125 * 60_000).toISOString() });
    await okSave(request.id, { price_cents: 45000, note: null, version: 1 });
    const events = await ib.events(request.id, 'quote_request_quoted');
    expect(events).toHaveLength(1);
    expect(events[0]?.user_id).toBe(staff.id);
    const properties = events[0]?.properties as { request_id: string; minutes_since_submit: number };
    expect(Object.keys(properties).sort()).toEqual(['minutes_since_submit', 'request_id']);
    expect(properties.request_id).toBe(request.id);
    expect(properties.minutes_since_submit).toBeGreaterThanOrEqual(124);
    expect(properties.minutes_since_submit).toBeLessThanOrEqual(127);
  });

  it('AC-006.2: a note with no price stores the note, leaves the price empty, and fires no quoted event', async () => {
    const request = await ib.seed({ name: `${ib.tag} ac2` });
    const body = await okSave(request.id, { price_cents: null, note: 'Call back after 5', version: 1 });
    expect(body).toMatchObject({ price_cents: null, note: 'Call back after 5', version: 2 });
    expect(await ib.events(request.id, 'quote_request_quoted')).toHaveLength(0);
    expect(await ib.stored(request.id)).toMatchObject({ price_cents: null, first_quoted_at: null });
  });

  it('the first price fires the event, later prices, clearing and re-pricing do not (the event is the FIRST price ever)', async () => {
    const request = await ib.seed({ name: `${ib.tag} once` });
    let version = 1;
    const steps: Array<Record<string, unknown>> = [
      { price_cents: null, note: 'note first' },
      { price_cents: 45000, note: 'note first' },
      { price_cents: 47500, note: 'note first' },
      { price_cents: null, note: null },
      { price_cents: 50000, note: null },
    ];
    const counts: number[] = [];
    for (const step of steps) {
      const body = await okSave(request.id, { ...step, version });
      version = body.version;
      counts.push((await ib.events(request.id, 'quote_request_quoted')).length);
    }
    expect(counts).toEqual([0, 1, 1, 1, 1]);
    expect(version).toBe(6);
  });

  it('a blank note and a null note both clear the note; a null price clears the price', async () => {
    const request = await ib.seed({ name: `${ib.tag} clear`, priceCents: 1234, note: 'old note' });
    const cleared = await okSave(request.id, { price_cents: null, note: '', version: 1 });
    expect(cleared).toMatchObject({ price_cents: null, note: null, version: 2 });
    const again = await okSave(request.id, { price_cents: 100, note: 'back', version: 2 });
    expect(again).toMatchObject({ price_cents: 100, note: 'back', version: 3 });
    const nulled = await okSave(request.id, { price_cents: 100, note: null, version: 3 });
    expect(nulled.note).toBeNull();
    expect(await ib.stored(request.id)).toMatchObject({ price_cents: 100, note: null });
  });

  it('saving a price never changes the status or its time, and writes no status history', async () => {
    const request = await ib.seed({ name: `${ib.tag} status stays`, status: 'won', statusChangedAt: '2026-03-02T15:00:00.000Z' });
    const body = await okSave(request.id, { price_cents: 99900, note: 'won job', version: 1 });
    expect(body).toMatchObject({ status: 'won', status_changed_at: '2026-03-02T15:00:00.000Z' });
    expect(await ib.statusChanges(request.id)).toHaveLength(0);
    expect(await ib.events(request.id, 'quote_request_status_changed')).toHaveLength(0);
  });

  it('it does not touch the homeowner fields, the consent or the photos (only price, note and the audit columns change)', async () => {
    const request = await ib.seed({ name: `${ib.tag} untouched fields`, consent: true });
    const before = await reload(request.id);
    const after = await okSave(request.id, { price_cents: 1, note: 'x', version: 1 });
    for (const key of ['name', 'phone', 'email', 'address', 'problem', 'urgency', 'submitted_at', 'reference', 'marketing_consent', 'marketing_consent_at', 'photo_count'] as const) {
      expect(after[key]).toEqual(before[key]);
    }
  });
});

describe('AC-006.3: the price limits are 422, and the refused save stores nothing', () => {
  it('0, 100000.00 and 450.555 are refused with the price named; 0.01 and 99999.99 are stored exactly', async () => {
    const request = await ib.seed({ name: `${ib.tag} ac3` });
    let version = 1;
    const refused: Array<[string, number]> = [
      ['0', 0],
      ['100000.00 (10000000 cents)', 10_000_000],
      ['450.555 (45055.5 cents)', 45_055.5],
      ['a negative price', -1],
      ['0.015 (1.5 cents)', 1.5],
      ['a huge number', 1e21],
    ];
    for (const [, cents] of refused) {
      const body = await expectProblem(await save(request.id, { price_cents: cents, note: null, version }), 422, 'validation_failed');
      expect(body.errors?.map((e) => e.field)).toEqual(['price_cents']);
      expect(body.errors?.[0]?.message).toContain('0.01 to 99,999.99');
    }
    expect(await ib.stored(request.id)).toMatchObject({ price_cents: null, version: 1 }); // nothing stored by any refusal

    const low = await okSave(request.id, { price_cents: 1, note: null, version });
    expect(low.price_cents).toBe(1);
    version = low.version;
    const high = await okSave(request.id, { price_cents: 9_999_999, note: null, version });
    expect(high.price_cents).toBe(9_999_999);
    expect((await ib.stored(request.id)).price_cents).toBe(9_999_999);
    // the amounts are exactly 0.01 and 99,999.99 in dollars
    expect(1 / 100).toBe(0.01);
    expect(9_999_999 / 100).toBe(99_999.99);
  });

  it('a price that is not a number is 422 on price_cents', async () => {
    const request = await ib.seed({ name: `${ib.tag} price types` });
    for (const price of ['450', '450.00', true, [], {}, 'abc']) {
      const body = await expectProblem(await save(request.id, { price_cents: price, note: null, version: 1 }), 422, 'validation_failed');
      expect(body.errors?.map((e) => e.field)).toContain('price_cents');
    }
    expect((await ib.stored(request.id)).version).toBe(1);
  });
});

describe('AC-006.4: the note is at most 1,000 characters', () => {
  it('1,000 characters are stored; 1,001 are refused with the note named and nothing stored', async () => {
    const request = await ib.seed({ name: `${ib.tag} ac4` });
    const refused = await expectProblem(await save(request.id, { price_cents: null, note: 'n'.repeat(1001), version: 1 }), 422, 'validation_failed');
    expect(refused.errors?.map((e) => e.field)).toEqual(['note']);
    expect(refused.errors?.[0]?.message).toContain('1,000');
    expect(await ib.stored(request.id)).toMatchObject({ note: null, version: 1 });

    const ok = await okSave(request.id, { price_cents: null, note: 'n'.repeat(1000), version: 1 });
    expect(ok.note).toHaveLength(1000);
  });

  it('characters are counted as the contract and the database count them (code points): 1,000 emoji are stored, 1,001 are refused', async () => {
    const request = await ib.seed({ name: `${ib.tag} emoji` });
    await expectProblem(await save(request.id, { price_cents: null, note: '\u{1F527}'.repeat(1001), version: 1 }), 422, 'validation_failed');
    const ok = await okSave(request.id, { price_cents: null, note: '\u{1F527}'.repeat(1000), version: 1 });
    expect([...(ok.note ?? '')]).toHaveLength(1000);
  });

  it('a note with a NUL character or a lone surrogate (Postgres cannot store them) is 422 on note, not a 500', async () => {
    const request = await ib.seed({ name: `${ib.tag} nul` });
    for (const note of ['bad\u0000note', 'bad\ud800note']) {
      const body = await expectProblem(await save(request.id, { price_cents: null, note, version: 1 }), 422, 'validation_failed');
      expect(body.errors?.map((e) => e.field)).toEqual(['note']);
    }
  });

  it('text that looks like markup, SQL or a script is stored as text and returned as it was typed', async () => {
    const request = await ib.seed({ name: `${ib.tag} markup` });
    const note = `<script>alert(1)</script> '; drop table quote_requests; -- {"a":1} \\ "quoted"`;
    const ok = await okSave(request.id, { price_cents: null, note, version: 1 });
    expect(ok.note).toBe(note);
  });
});

describe('AC-006.5 and AC-006.6: concurrent edits and overwriting', () => {
  it('AC-006.5: a save with a stale version is 409 stale_version and the first save is not overwritten', async () => {
    const request = await ib.seed({ name: `${ib.tag} ac5` });
    // the helper saved a price first, from version 1
    const first = await okSave(request.id, { price_cents: 45000, note: null, version: 1 });
    expect(first.version).toBe(2);
    // the owner, still looking at version 1, saves a note
    const stale = await save(request.id, { price_cents: null, note: 'owner note', version: 1 });
    await expectProblem(stale, 409, 'stale_version');
    expect(await ib.stored(request.id)).toMatchObject({ price_cents: 45000, note: null, version: 2 });
    // after a reload the owner's save goes through
    const reloaded = await reload(request.id);
    const retry = await okSave(request.id, { price_cents: reloaded.price_cents, note: 'owner note', version: reloaded.version });
    expect(retry).toMatchObject({ price_cents: 45000, note: 'owner note', version: 3 });
  });

  it('a version ahead of the stored one is 409 as well', async () => {
    const request = await ib.seed({ name: `${ib.tag} ahead` });
    await expectProblem(await save(request.id, { price_cents: 100, note: null, version: 7 }), 409, 'stale_version');
    expect(await ib.stored(request.id)).toMatchObject({ price_cents: null, version: 1 });
  });

  it('AC-006.6: a new price replaces the old one and the old one is shown nowhere', async () => {
    const request = await ib.seed({ name: `${ib.tag} ac6`, priceCents: 45000 });
    const body = await okSave(request.id, { price_cents: 47500, note: null, version: 1 });
    expect(body.price_cents).toBe(47500);
    expect(JSON.stringify(body)).not.toContain('45000');
    expect(JSON.stringify(await reload(request.id))).not.toContain('45000');
  });

  it('five saves of the same version at once: exactly one wins, four are 409, one event, one new version', async () => {
    const request = await ib.seed({ name: `${ib.tag} race` });
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => save(request.id, { price_cents: n * 1000, note: `writer ${n}`, version: 1 })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    for (const res of results.filter((r) => r.status === 409)) await expectProblem(res, 409, 'stale_version');
    const winner = results.find((r) => r.status === 200);
    const body = SaveQuoteResponse.parse(await winner?.json());
    expect(body.version).toBe(2);
    const stored = await ib.stored(request.id);
    expect(stored.version).toBe(2);
    expect(stored.note).toBe(`writer ${(body.price_cents ?? 0) / 1000}`); // the winner's price and note, together, never a mix
    expect(await ib.events(request.id, 'quote_request_quoted')).toHaveLength(1);
  });
});

describe('validation: 422 naming the field, 400 for a body that is not an object', () => {
  const cases: Array<[string, unknown, string]> = [
    ['no version', { price_cents: 100, note: null }, 'version'],
    ['version 0', { price_cents: 100, note: null, version: 0 }, 'version'],
    ['a version with decimals', { price_cents: 100, note: null, version: 1.5 }, 'version'],
    ['a version as text', { price_cents: 100, note: null, version: '1' }, 'version'],
    ['a null version', { price_cents: 100, note: null, version: null }, 'version'],
    ['no price_cents (the contract requires the key, null clears)', { note: null, version: 1 }, 'price_cents'],
    ['no note', { price_cents: 100, version: 1 }, 'note'],
    ['a note that is a number', { price_cents: 100, note: 5, version: 1 }, 'note'],
    ['a field the contract does not have', { price_cents: 100, note: null, version: 1, estimated_minutes: 30 }, 'estimated_minutes'],
    ['trying to set the status through the price', { price_cents: 100, note: null, version: 1, status: 'won' }, 'status'],
    ['trying to set the owner of the change', { price_cents: 100, note: null, version: 1, last_staff_update_by: '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10' }, 'last_staff_update_by'],
  ];

  it.each(cases)('%s', async (_name, payload, field) => {
    const request = await ib.seed({ name: `${ib.tag} validation` });
    const body = await expectProblem(await save(request.id, payload), 422, 'validation_failed');
    expect(body.errors?.map((e) => e.field)).toContain(field);
    expect(await ib.stored(request.id)).toMatchObject({ price_cents: null, note: null, version: 1, last_staff_update_by: null });
  });

  it.each([
    ['not JSON', 'this is not json'],
    ['an empty body', ''],
    ['a JSON array', '[1,2,3]'],
    ['JSON null', 'null'],
    ['a JSON string', '"hello"'],
    ['a JSON number', '5'],
    ['a body over 64 KB', JSON.stringify({ price_cents: null, note: 'x'.repeat(70_000), version: 1 })],
  ])('%s is 400 bad_request', async (_name, rawBody) => {
    const request = await ib.seed({ name: `${ib.tag} bad body` });
    await expectProblem(await save(request.id, undefined, { rawBody }), 400, 'bad_request');
    expect((await ib.stored(request.id)).version).toBe(1);
  });
});

describe('unknown and pending ids are 404', () => {
  it('an unknown uuid, an id that is not a uuid, and a request still pending', async () => {
    const pending = await ib.seed({ name: `${ib.tag} pending`, state: 'pending' });
    const valid = { price_cents: 100, note: null, version: 1 };
    await expectProblem(await save('00000000-0000-4000-8000-0000000000b4', valid), 404, 'not_found');
    await expectProblem(await save('not-a-uuid', valid), 404, 'not_found');
    await expectProblem(await save(pending.id, valid), 404, 'not_found');
    const stored = await staging.db().from('quote_requests').select('price_cents, version').eq('id', pending.id).single();
    expect(stored.data).toEqual({ price_cents: null, version: 1 });
  });
});

describe('failures and methods', () => {
  it('a check violation raised by the database is a 422 with our own text: no constraint name, row or note text in the response or the log', async () => {
    const request = await ib.seed({ name: `${ib.tag} failure` });
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw).pathname.endsWith('/rpc/save_quote_request_quote')) {
        return new Response(JSON.stringify({ code: '23514', message: 'new row violates check constraint "quote_requests_note_check"', details: 'Failing row contains (secret note text)', hint: null }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return real(input, init);
    });
    const output = await captureOutput(async () => {
      const res = await save(request.id, { price_cents: null, note: 'secret note text', version: 1 });
      const body = await expectProblem(res.clone(), 422, 'validation_failed');
      expect(JSON.stringify(body)).not.toMatch(/secret note text|Failing row|violates/);
    });
    expect(output).not.toMatch(/secret note text|Failing row|violates/);
  });

  it('every method but PUT is a 405 problem with Allow: PUT', async () => {
    const request = await ib.seed({ name: `${ib.tag} methods` });
    for (const handler of [quoteGet, quotePost]) {
      const res = await handler(staffRequest(`/api/quote-requests/${request.id}/quote`, staff.token, { method: handler === quoteGet ? 'GET' : 'POST' }), idParams(request.id));
      await expectProblem(res, 405, 'method_not_allowed');
      expect(res.headers.get('allow')).toBe('PUT');
    }
  });
});
