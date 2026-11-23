// @vitest-environment node
// GET /api/quote-requests/{request_id} (getQuoteRequest) and GET /api/quote-requests/{request_id}/photos
// (listQuoteRequestPhotos) against the STAGING Supabase project, with a real staff session and real signed URLs.
//   AC-005.3  every field and all 3 photos        AC-005.6  no photos            AC-005.7  Storage down: "Photo unavailable"
//   AC-012.3  fresh signed URLs on demand          AC-010.1 to .4, AC-010.6      the GHL copy state, and no consent
//   AC-017.9 to .11, AC-017.16                     the stage-tag state            AC-015.1, AC-015.2  who last changed it
// Requests, photo files, job rows and throwaway staff are created per test and deleted in afterAll (tests/helpers/staging.ts).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as photosGet } from '@/app/api/quote-requests/[request_id]/photos/route';
import { GET as detailGet } from '@/app/api/quote-requests/[request_id]/route';
import { GetQuoteRequestResponse, ListQuoteRequestPhotosResponse } from '@/lib/api/generated/inbox/inbox.zod';
import { captureOutput, expectProblem } from '../../helpers/api';
import { idParams, inboxTools, staffRequest, type StaffSession } from '../../helpers/inbox';
import { psql, setupStaging } from '../../helpers/staging';

const staging = setupStaging();
const ib = inboxTools(staging);

let staff: StaffSession;

beforeAll(async () => {
  staff = await ib.staff('Owner (detail test)');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DETAIL_KEYS = [
  'address',
  'currency',
  'email',
  'ghl',
  'id',
  'last_updated',
  'marketing_consent',
  'marketing_consent_at',
  'name',
  'note',
  'phone',
  'photo_count',
  'photos',
  'price_cents',
  'problem',
  'reference',
  'status',
  'status_changed_at',
  'submitted_at',
  'urgency',
  'version',
];

const detail = (id: string, token: string | undefined = staff.token) => Promise.resolve(detailGet(staffRequest(`/api/quote-requests/${id}`, token), idParams(id)));
const photos = (id: string, token: string | undefined = staff.token) => Promise.resolve(photosGet(staffRequest(`/api/quote-requests/${id}/photos`, token), idParams(id)));

async function okDetail(id: string) {
  const res = await detail(id);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  expect(res.headers.get('x-request-id')).toBeTruthy();
  expect(res.headers.get('cache-control')).toContain('no-store');
  const raw: unknown = await res.json();
  const body = GetQuoteRequestResponse.parse(raw);
  expect(Object.keys(raw as object).sort()).toEqual(DETAIL_KEYS);
  return body;
}

/** Make the Storage signing endpoint fail the way an outage does; every other call goes to the real server. */
function breakStorageSigning(how: 'status' | 'network') {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(raw).pathname.startsWith('/storage/v1/object/sign')) {
      if (how === 'network') throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ statusCode: '503', error: 'Unavailable', message: 'storage is down' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return real(input, init);
  });
}

const near900 = (expiresAt: string | null) => {
  expect(expiresAt).not.toBeNull();
  expect(Math.abs(Date.parse(expiresAt ?? '') - (Date.now() + 900_000))).toBeLessThan(30_000);
};

describe('AC-005.3: every submitted field, and all 3 photos', () => {
  it('returns the request in full, with 3 signed photo URLs that open, in position order', async () => {
    const request = await ib.seed({
      name: `${ib.tag} Dana Whitfield`,
      submittedAt: '2026-03-02T14:10:00.000Z',
      urgency: 'emergency',
      status: 'quoted',
      statusChangedAt: '2026-03-02T15:02:00.000Z',
      priceCents: 45000,
      note: 'Replace cartridge, 2 hours, can come Thursday',
      photoCount: 3,
      consent: true,
    });
    await ib.photo(request.id, 2, 'image/png');
    await ib.photo(request.id, 1, 'image/jpeg');
    await ib.photo(request.id, 3, 'image/webp');

    const body = await okDetail(request.id);
    expect(body).toMatchObject({
      id: request.id,
      reference: request.reference,
      name: `${ib.tag} Dana Whitfield`,
      phone: request.phone,
      email: request.email,
      address: '14 Test Street, Hamilton ON',
      problem: 'The test tap drips constantly under the sink',
      urgency: 'emergency',
      status: 'quoted',
      status_changed_at: '2026-03-02T15:02:00.000Z',
      submitted_at: '2026-03-02T14:10:00.000Z',
      price_cents: 45000,
      currency: 'CAD',
      note: 'Replace cartridge, 2 hours, can come Thursday',
      photo_count: 3,
      last_updated: null,
      version: 1,
    });
    expect(body.photos.map((p) => [p.position, p.content_type])).toEqual([
      [1, 'image/jpeg'],
      [2, 'image/png'],
      [3, 'image/webp'],
    ]);
    for (const photo of body.photos) {
      expect(photo.url).toContain(`/storage/v1/object/sign/quote-photos/${request.id}/photo-${photo.position}?token=`);
      near900(photo.expires_at);
    }
    // the signed URL is what the browser's <img> loads: it must open with no other credential
    const first = body.photos[0];
    const opened = await fetch(first?.url ?? '');
    expect(opened.status).toBe(200);
    expect(opened.headers.get('content-type')).toBe('image/jpeg');
    expect([...new Uint8Array(await opened.arrayBuffer()).slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('AC-005.6: a request with no photos has photos [] and photo_count 0', async () => {
    const request = await ib.seed({ name: `${ib.tag} no photos` });
    const body = await okDetail(request.id);
    expect(body.photos).toEqual([]);
    expect(body.photo_count).toBe(0);
    expect(body.price_cents).toBeNull();
    expect(body.note).toBeNull();
    expect(body.status_changed_at).toBeNull();
  });

  it('a photo is never reachable without a signature: the object path alone is refused', async () => {
    const request = await ib.seed({ name: `${ib.tag} private`, photoCount: 1 });
    await ib.photo(request.id, 1);
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    const plain = await fetch(`${url.origin}/storage/v1/object/quote-photos/${request.id}/photo-1`);
    expect(plain.status).toBeGreaterThanOrEqual(400);
    const publicUrl = await fetch(`${url.origin}/storage/v1/object/public/quote-photos/${request.id}/photo-1`);
    expect(publicUrl.status).toBeGreaterThanOrEqual(400);
  });
});

describe('AC-005.7: photo storage unreachable', () => {
  it.each([
    ['answers 503', 'status'],
    ['cannot be reached at all', 'network'],
  ] as const)('Storage %s: the request is still returned, every photo has url null and expires_at null', async (_name, how) => {
    const request = await ib.seed({ name: `${ib.tag} storage down ${how}`, photoCount: 2 });
    await ib.photo(request.id, 1);
    await ib.photo(request.id, 2);
    breakStorageSigning(how);
    const output = await captureOutput(async () => {
      const body = await okDetail(request.id);
      expect(body.name).toBe(`${ib.tag} storage down ${how}`);
      expect(body.photo_count).toBe(2);
      expect(body.photos).toEqual([
        { position: 1, content_type: 'image/jpeg', url: null, expires_at: null },
        { position: 2, content_type: 'image/jpeg', url: null, expires_at: null },
      ]);
    });
    expect(output).not.toContain('storage is down');
    expect(output).toContain('photo_signing_failed');
  });

  it('one photo that cannot be signed (its file is missing) is url null and the others still open', async () => {
    const request = await ib.seed({ name: `${ib.tag} one missing`, photoCount: 2 });
    await ib.photo(request.id, 1);
    const missing = await staging
      .db()
      .from('quote_photos')
      .insert({ request_id: request.id, position: 2, storage_path: `${request.id}/photo-2`, content_type: 'image/jpeg', size_bytes: 600 });
    expect(missing.error).toBeNull();
    const body = await okDetail(request.id);
    expect(body.photos[0]?.url).toContain('/storage/v1/object/sign/');
    expect(body.photos[1]).toEqual({ position: 2, content_type: 'image/jpeg', url: null, expires_at: null });
  });

  it('the photos endpoint answers the same way when Storage is down', async () => {
    const request = await ib.seed({ name: `${ib.tag} photos down`, photoCount: 1 });
    await ib.photo(request.id, 1);
    breakStorageSigning('status');
    const res = await photos(request.id);
    expect(res.status).toBe(200);
    expect(ListQuoteRequestPhotosResponse.parse(await res.json()).data).toEqual([{ position: 1, content_type: 'image/jpeg', url: null, expires_at: null }]);
  });
});

describe('AC-012.3: fresh signed URLs whenever the viewer asks', () => {
  it('lists the photos in position order, each with a URL that opens and expires in 900 seconds, on every call', async () => {
    const request = await ib.seed({ name: `${ib.tag} viewer`, photoCount: 3 });
    for (const position of [3, 1, 2]) await ib.photo(request.id, position);

    for (let round = 0; round < 2; round += 1) {
      const res = await photos(request.id);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('x-request-id')).toBeTruthy();
      expect(res.headers.get('cache-control')).toContain('no-store');
      const raw: unknown = await res.json();
      const body = ListQuoteRequestPhotosResponse.parse(raw);
      expect(Object.keys(raw as object)).toEqual(['data']);
      expect(body.data.map((p) => p.position)).toEqual([1, 2, 3]);
      for (const photo of body.data) {
        expect(Object.keys(photo).sort()).toEqual(['content_type', 'expires_at', 'position', 'url']);
        near900(photo.expires_at);
        expect((await fetch(photo.url ?? '')).status).toBe(200);
      }
    }
  });

  it('a request with no photos is { data: [] }', async () => {
    const request = await ib.seed({ name: `${ib.tag} viewer none` });
    const res = await photos(request.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it('a signed URL is not written to the log', async () => {
    const request = await ib.seed({ name: `${ib.tag} viewer log`, photoCount: 1 });
    await ib.photo(request.id, 1);
    const output = await captureOutput(async () => {
      expect((await photos(request.id)).status).toBe(200);
      expect((await detail(request.id)).status).toBe(200);
    });
    expect(output).not.toMatch(/token=|\/storage\/v1\/object\/sign|eyJ/);
  });
});

describe('unknown and pending ids are 404 (existence is not revealed)', () => {
  it('an unknown uuid', async () => {
    const id = '00000000-0000-4000-8000-0000000000b3'; // well-formed, never issued
    await expectProblem(await detail(id), 404, 'not_found');
    await expectProblem(await photos(id), 404, 'not_found');
  });

  it('an id that is not a uuid, including SQL and filter text', async () => {
    for (const id of ['abc', '123', "1' or '1'='1", 'x),id.neq.(y', '../../etc/passwd', 'ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ']) {
      await expectProblem(await detail(id), 404, 'not_found');
      await expectProblem(await photos(id), 404, 'not_found');
    }
  });

  it('a request still pending, even with a photo row recorded for it', async () => {
    const pending = await ib.seed({ name: `${ib.tag} pending`, state: 'pending', photoCount: 1 });
    await ib.photo(pending.id, 1);
    await expectProblem(await detail(pending.id), 404, 'not_found');
    await expectProblem(await photos(pending.id), 404, 'not_found');
  });
});

describe('the GoHighLevel state on the request (docs/architecture.md "GHL state shown on SCR-06")', () => {
  it('AC-010.6 and AC-017.16: an unticked request is not_copied_no_consent with at null and stage_tag null', async () => {
    const request = await ib.seed({ name: `${ib.tag} no consent`, consent: false });
    const body = await okDetail(request.id);
    expect(body.marketing_consent).toBe(false);
    expect(body.marketing_consent_at).toBeNull();
    expect(body.ghl).toEqual({ copy: { state: 'not_copied_no_consent', at: null }, stage_tag: null });
  });

  it('a ticked request returns marketing_consent true and the time of consent (the time it was stored)', async () => {
    const request = await ib.seed({ name: `${ib.tag} consent`, consent: true, submittedAt: '2026-03-02T14:10:00.000Z' });
    const body = await okDetail(request.id);
    expect(body.marketing_consent).toBe(true);
    expect(body.marketing_consent_at).toBe('2026-03-02T14:10:00.000Z');
  });

  it('an unticked request shows no GHL state even when stray job rows exist for its status history', async () => {
    // the database refuses a job for an unticked request, so none can exist; the answer must still be the no-consent one
    const request = await ib.seed({ name: `${ib.tag} no consent jobs`, consent: false, status: 'won' });
    const refused = await staging.db().from('ghl_sync_jobs').insert({ request_id: request.id, kind: 'contact_copy', state: 'succeeded' });
    expect(refused.error).not.toBeNull(); // trigger ghl_sync_jobs_require_consent (invariant 18)
    expect((await okDetail(request.id)).ghl.stage_tag).toBeNull();
  });

  type Job = Parameters<typeof ib.job>[1];
  const T1 = '2026-03-02T15:00:01.000Z';
  const T2 = '2026-03-02T16:30:02.000Z';
  const cases: Array<{ name: string; ac: string; jobs: Job[]; copy: { state: string; at: string | null }; tag: { state: string; at: string | null } }> = [
    { name: 'copy succeeded, no stage-tag job: the tag follows the copy', ac: 'AC-010.1', jobs: [{ kind: 'contact_copy', state: 'succeeded', lastAttemptAt: T1 }], copy: { state: 'copied', at: T1 }, tag: { state: 'up_to_date', at: T1 } },
    { name: 'copy pending, no attempt yet', ac: 'AC-010.4', jobs: [{ kind: 'contact_copy', state: 'pending' }], copy: { state: 'waiting', at: null }, tag: { state: 'waiting', at: null } },
    { name: 'copy waiting to retry after an attempt', ac: 'AC-010.4', jobs: [{ kind: 'contact_copy', state: 'waiting', lastAttemptAt: T1 }], copy: { state: 'waiting', at: T1 }, tag: { state: 'waiting', at: T1 } },
    { name: 'copy failed after its retries', ac: 'AC-010.3', jobs: [{ kind: 'contact_copy', state: 'failed', lastAttemptAt: T2 }], copy: { state: 'failed', at: T2 }, tag: { state: 'failed', at: T2 } },
    { name: 'copy done and the stage tag succeeded', ac: 'AC-017.1', jobs: [{ kind: 'contact_copy', state: 'succeeded', lastAttemptAt: T1 }, { kind: 'stage_tag', state: 'succeeded', targetStatus: 'quoted', lastAttemptAt: T2 }], copy: { state: 'copied', at: T1 }, tag: { state: 'up_to_date', at: T2 } },
    { name: 'stage tag pending, not tried yet', ac: 'AC-017.9', jobs: [{ kind: 'contact_copy', state: 'succeeded', lastAttemptAt: T1 }, { kind: 'stage_tag', state: 'pending', targetStatus: 'won' }], copy: { state: 'copied', at: T1 }, tag: { state: 'waiting', at: null } },
    { name: 'stage tag waiting to retry (GHL server error)', ac: 'AC-017.9', jobs: [{ kind: 'contact_copy', state: 'succeeded', lastAttemptAt: T1 }, { kind: 'stage_tag', state: 'waiting', targetStatus: 'won', lastAttemptAt: T2 }], copy: { state: 'copied', at: T1 }, tag: { state: 'waiting', at: T2 } },
    { name: 'stage tag failed (token refused, or 5 retries used)', ac: 'AC-017.10, AC-017.11', jobs: [{ kind: 'contact_copy', state: 'succeeded', lastAttemptAt: T1 }, { kind: 'stage_tag', state: 'failed', targetStatus: 'won', lastAttemptAt: T2 }], copy: { state: 'copied', at: T1 }, tag: { state: 'failed', at: T2 } },
    {
      name: 'the newest non-superseded stage-tag job decides over an older succeeded one',
      ac: 'AC-017.9',
      jobs: [
        { kind: 'contact_copy', state: 'succeeded', lastAttemptAt: T1 },
        { kind: 'stage_tag', state: 'succeeded', targetStatus: 'quoted', lastAttemptAt: T1, createdAt: '2026-03-02T15:10:00.000Z' },
        { kind: 'stage_tag', state: 'waiting', targetStatus: 'won', lastAttemptAt: T2, createdAt: '2026-03-02T16:00:00.000Z' },
      ],
      copy: { state: 'copied', at: T1 },
      tag: { state: 'waiting', at: T2 },
    },
    {
      name: 'a superseded stage-tag job, even the newest, is ignored',
      ac: 'AC-017.6',
      jobs: [
        { kind: 'contact_copy', state: 'succeeded', lastAttemptAt: T1 },
        { kind: 'stage_tag', state: 'succeeded', targetStatus: 'quoted', lastAttemptAt: T2, createdAt: '2026-03-02T15:10:00.000Z' },
        { kind: 'stage_tag', state: 'superseded', targetStatus: 'won', createdAt: '2026-03-02T16:00:00.000Z' },
      ],
      copy: { state: 'copied', at: T1 },
      tag: { state: 'up_to_date', at: T2 },
    },
    { name: 'only a superseded stage-tag job: the tag follows the copy', ac: 'AC-017.6', jobs: [{ kind: 'contact_copy', state: 'succeeded', lastAttemptAt: T1 }, { kind: 'stage_tag', state: 'superseded', targetStatus: 'won' }], copy: { state: 'copied', at: T1 }, tag: { state: 'up_to_date', at: T1 } },
    { name: 'a ticked request with no job rows at all is waiting, never an error', ac: 'AC-010.4', jobs: [], copy: { state: 'waiting', at: null }, tag: { state: 'waiting', at: null } },
  ];

  it.each(cases)('$ac: $name', async ({ name, jobs, copy, tag }) => {
    const request = await ib.seed({ name: `${ib.tag} ghl ${name}`.slice(0, 90), consent: true });
    for (const job of jobs) await ib.job(request.id, job);
    const body = await okDetail(request.id);
    expect(body.ghl).toEqual({ copy, stage_tag: tag });
  });
});

describe('AC-015.1 and AC-015.2: who last changed it', () => {
  it('a request nobody has changed has last_updated null ("Not updated yet")', async () => {
    const request = await ib.seed({ name: `${ib.tag} untouched` });
    expect((await okDetail(request.id)).last_updated).toBeNull();
  });

  it('shows the display name and time of the last change; null name once that staff account is removed', async () => {
    const helper = await staging.createUser({ staff: true, displayName: 'Office helper' });
    const request = await ib.seed({ name: `${ib.tag} touched` });
    const at = '2026-03-02T14:05:00.000Z';
    const updated = await staging.db().from('quote_requests').update({ last_staff_update_by: helper.id, last_staff_update_at: at }).eq('id', request.id);
    expect(updated.error).toBeNull();

    expect((await okDetail(request.id)).last_updated).toEqual({ by_display_name: 'Office helper', at });

    psql(`delete from public.staff where user_id = '${helper.id}'`);
    expect((await okDetail(request.id)).last_updated).toEqual({ by_display_name: null, at });
  });
});

describe('failures are 500 internal_error with nothing from the database in the response or the log', () => {
  it('a failing read of the request', async () => {
    const request = await ib.seed({ name: `${ib.tag} db failure` });
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw).pathname.endsWith('/rest/v1/quote_requests')) {
        return new Response(JSON.stringify({ code: 'XX000', message: 'boom for Dana Whitfield 4165550123', details: 'Failing row contains (Dana Whitfield)', hint: 'secret hint' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return real(input, init);
    });
    const output = await captureOutput(async () => {
      const res = await detail(request.id);
      const body = await expectProblem(res.clone(), 500, 'internal_error');
      expect(JSON.stringify(body)).not.toMatch(/Dana|4165550123|Failing row|hint|boom/);
    });
    expect(output).not.toMatch(/Dana|4165550123|Failing row|secret hint|boom/);
    expect(output).toContain('"error_class":"postgrest"');
    expect(output).toContain('"code":"XX000"');
  });
});
