// @vitest-environment node
// POST /api/quote-requests/{request_id}/submission (submitQuoteRequest) against the STAGING Supabase project: the homeowner's
// whole flow (create, upload to the private bucket with the publishable key, submit), called in-process. Next's after() runs
// the scheduled task at once under test, and the GHL seam (runGhlJobs) is replaced by a spy: no GoHighLevel call is possible.
// Every row and file this file creates is tracked and deleted in afterAll (tests/helpers/staging.ts), which also proves it.
// Acceptance criteria: AC-001.1, .6, .14, .15; AC-002.1 to .5; AC-009.9 (US-001, US-002, US-009).
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createPost } from '@/app/api/quote-requests/route';
import { GET as submitGet, POST as submitPost } from '@/app/api/quote-requests/[request_id]/submission/route';
import { CreateQuoteRequestResponse, SubmitQuoteRequestResponse } from '@/lib/api/generated/public-form/public-form.zod';
import { captureOutput, expectProblem, jpegBytes, jsonRequest, pngBytes, textBytes, webpBytes } from '../../helpers/api';
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
const REFERENCE = /^NQ-[A-HJKMNP-Z2-9]{6}$/;

type Plan = Array<{ position: number; content_type: 'image/jpeg' | 'image/png' | 'image/webp'; size_bytes: number }>;
type Started = { id: string; token: string; ip: string; body: Record<string, unknown> };

beforeEach(() => {
  spies.pending.length = 0;
  spies.runGhlJobs.mockReset().mockResolvedValue({ claimed: 1, succeeded: 1, waiting: 0, failed: 0 });
});

/** createQuoteRequest as the browser does it; returns the pending request's id, token, address and body. */
async function start(plan: Plan = [], overrides: Record<string, unknown> = {}): Promise<Started> {
  const token = staging.token();
  const ip = staging.address();
  const body = staging.body({ photos: plan, ...overrides });
  const res = await createPost(jsonRequest('/api/quote-requests', { headers: { 'x-form-token': token, 'x-real-ip': ip }, body }), undefined);
  expect(res.status).toBe(201);
  const started = CreateQuoteRequestResponse.parse(await res.json());
  staging.trackRequest(started.request_id);
  return { id: started.request_id, token, ip, body };
}

/** The direct upload the browser makes to the private bucket with only the publishable key. */
async function upload(id: string, position: number, bytes: Uint8Array, contentType: string): Promise<void> {
  const put = () => staging.anon().storage.from('quote-photos').upload(`${id}/photo-${position}`, bytes, { contentType, upsert: false });
  let { error } = await put();
  // One retry for a transport failure between this machine and hosted Storage ("fetch failed", QA's BUG-QA1-6), never for an
  // answer from Storage. On the retry a 409 can only mean the first attempt landed.
  if (error && (error as { name?: string }).name === 'StorageUnknownError') {
    console.warn(`upload transport failure (${error.message}); retrying once`);
    ({ error } = await put());
    if (error && ((error as { statusCode?: string }).statusCode === '409' || /already exists|duplicate/i.test(error.message))) error = null;
  }
  expect(error).toBeNull();
}

async function submit(s: { id: string; token?: string | null; ip?: string }, idOverride?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = s.token === undefined ? undefined : s.token;
  if (token) headers['x-form-token'] = token;
  if (s.ip) headers['x-real-ip'] = s.ip;
  const id = idOverride ?? s.id;
  return submitPost(jsonRequest(`/api/quote-requests/${id}/submission`, { headers }), { params: Promise.resolve({ request_id: id }) });
}

const flush = async () => {
  await Promise.all(spies.pending.splice(0));
};

async function row(id: string) {
  const { data, error } = await staging.db().from('quote_requests').select('*').eq('id', id).single();
  expect(error).toBeNull();
  return data!;
}
async function photos(id: string) {
  const { data, error } = await staging.db().from('quote_photos').select('position, storage_path, content_type, size_bytes').eq('request_id', id).order('position');
  expect(error).toBeNull();
  return data ?? [];
}
async function jobs(id: string) {
  const { data, error } = await staging.db().from('ghl_sync_jobs').select('kind, state').eq('request_id', id);
  expect(error).toBeNull();
  return data ?? [];
}
async function events(id: string, name?: string) {
  let query = staging.db().from('events').select('name, properties').eq('request_id', id);
  if (name) query = query.eq('name', name);
  const { data, error } = await query;
  expect(error).toBeNull();
  return data ?? [];
}
async function bucketNames(id: string): Promise<string[]> {
  const { data } = await staging.db().storage.from('quote-photos').list(id);
  return (data ?? []).map((f) => f.name).sort();
}
async function storedBytes(id: string, position: number): Promise<Uint8Array> {
  const { data, error } = await staging.db().storage.from('quote-photos').download(`${id}/photo-${position}`, { cacheNonce: randomUUID() }, { cache: 'no-store' });
  expect(error).toBeNull();
  return new Uint8Array(await data!.arrayBuffer());
}

/** The upload exactly as the form makes it: a 409 (an object is already at that path) counts as uploaded (src/components/request/photo-upload.ts). */
async function uploadLikeTheForm(id: string, position: number, bytes: Uint8Array, contentType: string): Promise<'stored' | 'already_there'> {
  const { error } = await staging.anon().storage.from('quote-photos').upload(`${id}/photo-${position}`, bytes, { contentType, upsert: false });
  if (!error) return 'stored';
  const e = error as { message: string; statusCode?: string; status?: number };
  expect(e.statusCode === '409' || e.status === 409 || /already exists|duplicate/i.test(e.message)).toBe(true);
  return 'already_there';
}

/** createQuoteRequest again with the same token and address (Send again on the same page). */
const resend = (s: Started, body: Record<string, unknown>) =>
  createPost(jsonRequest('/api/quote-requests', { headers: { 'x-form-token': s.token, 'x-real-ip': s.ip }, body }), undefined);

describe('AC-001.1, AC-001.15, AC-002.5, AC-009.9: no photos, offers box left as loaded (unticked)', () => {
  it('stores the request with a reference, status New, consent no, no job; GHL is never called', async () => {
    const s = await start();
    const res = await submit(s);
    expect(res.status).toBe(200);
    const done = SubmitQuoteRequestResponse.parse(await res.json());
    expect(done).toMatchObject({ request_id: s.id, photo_count: 0 });
    expect(done.reference).toMatch(REFERENCE);

    const stored = await row(s.id);
    expect(stored).toMatchObject({ state: 'submitted', reference: done.reference, status: 'new', marketing_consent: false, marketing_consent_at: null, photo_count: 0 });
    expect(new Date(stored.submitted_at!).toISOString()).toBe(done.submitted_at);
    expect(await photos(s.id)).toHaveLength(0);
    expect(await jobs(s.id)).toHaveLength(0); // AC-009.9: no copy job exists
    expect((await events(s.id)).map((e) => e.name)).toEqual(['quote_request_submitted']);
    expect((await events(s.id, 'quote_request_submitted'))[0]!.properties).toEqual({ request_id: s.id, urgency: 'soon', photo_count: 0, marketing_consent: false });

    await flush();
    expect(spies.runGhlJobs).not.toHaveBeenCalled(); // not even scheduled: nothing was queued
  });
});

describe('AC-001.14: offers box ticked', () => {
  it('stores consent yes with a consent time equal to the time stored, queues one copy job, and runs the first attempt after the response', async () => {
    const s = await start([{ position: 1, content_type: 'image/jpeg', size_bytes: 600 }], { marketing_consent: true });
    await upload(s.id, 1, jpegBytes(), 'image/jpeg');
    const res = await submit(s);
    expect(res.status).toBe(200);
    const done = SubmitQuoteRequestResponse.parse(await res.json());

    const stored = await row(s.id);
    expect(stored).toMatchObject({ state: 'submitted', marketing_consent: true });
    expect(stored.marketing_consent_at).not.toBeNull();
    expect(stored.marketing_consent_at).toBe(stored.submitted_at);
    expect(new Date(stored.marketing_consent_at!).toISOString()).toBe(done.submitted_at);
    expect(await jobs(s.id)).toEqual([{ kind: 'contact_copy', state: 'pending' }]);
    expect((await events(s.id, 'quote_request_submitted'))[0]!.properties).toMatchObject({ marketing_consent: true, photo_count: 1 });

    await flush();
    expect(spies.runGhlJobs).toHaveBeenCalledTimes(1);
    expect(spies.runGhlJobs).toHaveBeenCalledWith({ requestId: s.id });
  });

  it('a failing GHL attempt (the seam throws on a database failure) never changes the 200, and only { error_class, code } is logged', async () => {
    const s = await start([], { marketing_consent: true });
    spies.runGhlJobs.mockRejectedValue(Object.assign(new Error('GHL job store failed: claim_ghl_job Dana Whitfield dana@example.test'), { name: 'GhlStoreError', code: '57014', operation: 'claim' }));
    let res: Response | undefined;
    const output = await captureOutput(async () => {
      res = await submit(s);
      await flush();
    });
    expect((res as Response).status).toBe(200);
    SubmitQuoteRequestResponse.parse(await (res as Response).json());
    expect((await row(s.id)).state).toBe('submitted');
    expect(output).not.toMatch(/Dana|dana@|claim_ghl_job|store failed/);
    const line = output.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.outcome === 'ghl_first_attempt_failed');
    expect(line).toMatchObject({ level: 'error', quote_request_id: s.id, error_class: 'GhlStoreError', code: '57014' });
    expect(Object.keys(line!).sort()).toEqual(['code', 'error_class', 'level', 'outcome', 'quote_request_id', 'request_id']);
  });
});

describe('AC-002.1: photos are checked by their bytes and stored with the request', () => {
  it('stores a JPEG, a PNG and a WebP with the type their bytes say and their real size', async () => {
    // the plan states each file's real size, as the form does (size_bytes = File.size); REV-2 CQ-2 refuses a size that differs
    const s = await start([
      { position: 1, content_type: 'image/jpeg', size_bytes: 800 },
      { position: 2, content_type: 'image/png', size_bytes: 900 },
      { position: 3, content_type: 'image/webp', size_bytes: 1000 },
    ]);
    await upload(s.id, 1, jpegBytes(800), 'image/jpeg');
    await upload(s.id, 2, pngBytes(640, 480, 900), 'image/png');
    await upload(s.id, 3, webpBytes(640, 480, 1000), 'image/webp');
    const res = await submit(s);
    expect(res.status).toBe(200);
    expect(SubmitQuoteRequestResponse.parse(await res.json()).photo_count).toBe(3);
    expect(await photos(s.id)).toEqual([
      { position: 1, storage_path: `${s.id}/photo-1`, content_type: 'image/jpeg', size_bytes: 800 },
      { position: 2, storage_path: `${s.id}/photo-2`, content_type: 'image/png', size_bytes: 900 },
      { position: 3, storage_path: `${s.id}/photo-3`, content_type: 'image/webp', size_bytes: 1000 },
    ]);
  });

  it('AC-002.3: a photo of exactly 5,242,880 bytes is accepted; the bucket itself refuses one byte more', async () => {
    const s = await start([{ position: 1, content_type: 'image/jpeg', size_bytes: 5_242_880 }]);
    await upload(s.id, 1, jpegBytes(5_242_880), 'image/jpeg');
    const res = await submit(s);
    expect(res.status).toBe(200);
    expect((await photos(s.id))[0]).toMatchObject({ position: 1, size_bytes: 5_242_880 });

    const refused = await start([{ position: 1, content_type: 'image/jpeg', size_bytes: 5_242_880 }]);
    const { error } = await staging.anon().storage.from('quote-photos').upload(`${refused.id}/photo-1`, jpegBytes(5_242_881), { contentType: 'image/jpeg', upsert: false });
    expect(error).not.toBeNull();
    expect(await bucketNames(refused.id)).toEqual([]);
  });
});

describe('AC-001.6: submitting twice stores one request and one reference', () => {
  it('a second submit returns the same reference and submitted time, one event, one job, and no second GHL attempt', async () => {
    const s = await start([], { marketing_consent: true });
    const first = SubmitQuoteRequestResponse.parse(await (await submit(s)).json());
    const second = await submit(s);
    expect(second.status).toBe(200);
    expect(SubmitQuoteRequestResponse.parse(await second.json())).toEqual(first);
    expect(await events(s.id, 'quote_request_submitted')).toHaveLength(1);
    expect(await jobs(s.id)).toHaveLength(1);
    await flush();
    expect(spies.runGhlJobs).toHaveBeenCalledTimes(1);
  });

  it('two submits at the same moment give the same reference, one event, one job and one GHL attempt', async () => {
    const s = await start([{ position: 1, content_type: 'image/png', size_bytes: 600 }], { marketing_consent: true });
    await upload(s.id, 1, pngBytes(), 'image/png');
    const [a, b] = await Promise.all([submit(s), submit(s)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const [one, two] = [SubmitQuoteRequestResponse.parse(await a.json()), SubmitQuoteRequestResponse.parse(await b.json())];
    expect(one.reference).toBe(two.reference);
    expect(await events(s.id, 'quote_request_submitted')).toHaveLength(1);
    expect(await jobs(s.id)).toHaveLength(1);
    expect(await photos(s.id)).toHaveLength(1);
    await flush();
    expect(spies.runGhlJobs).toHaveBeenCalledTimes(1);
  });
});

describe('a bad or missing photo is refused with an error per photo, removed, and nothing becomes visible (invariants 5 and 7)', () => {
  it('AC-002.4: a text file renamed to leak.jpg is a 422 photo_invalid on photos[1], is deleted from the bucket, and the request stays pending; a good photo then completes it', async () => {
    const s = await start([{ position: 1, content_type: 'image/jpeg', size_bytes: 600 }]);
    await upload(s.id, 1, textBytes(), 'image/jpeg');
    const res = await submit(s);
    const problem = await expectProblem(res, 422, 'photo_invalid');
    expect(problem.title).toBe('A photo could not be used');
    expect(problem.errors).toEqual([{ field: 'photos[1]', message: 'Photos must be JPEG, PNG or WebP' }]);

    expect(await bucketNames(s.id)).toEqual([]); // removed
    expect(await row(s.id)).toMatchObject({ state: 'pending', reference: null });
    expect(await photos(s.id)).toHaveLength(0);
    expect(await events(s.id, 'quote_request_submitted')).toHaveLength(0);
    expect((await events(s.id, 'photo_upload_failed')).map((e) => e.properties)).toEqual([{ reason: 'bad_type', photo_index: 1 }]);
    await flush();
    expect(spies.runGhlJobs).not.toHaveBeenCalled();

    await upload(s.id, 1, jpegBytes(), 'image/jpeg'); // AC-002.6: send again and it completes
    const retry = await submit(s);
    const retryBody = await retry.text();
    expect(retry.status, retryBody).toBe(200); // the problem body names the cause if this ever fails
    expect(SubmitQuoteRequestResponse.parse(JSON.parse(retryBody)).photo_count).toBe(1);
  });

  it('a refused photo replaced at the same path straight away is checked by its NEW bytes (no stale read from the Storage cache), 10 times over', async () => {
    // Before the fix, the submit after the replacement sometimes read the removed file back from the CDN and refused (and
    // deleted) the good photo. It is intermittent on staging, so ten independent cycles run at once.
    const cycles = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const s = await start([{ position: 1, content_type: 'image/jpeg', size_bytes: 600 }]);
        await upload(s.id, 1, textBytes(), 'image/jpeg');
        await expectProblem(await submit(s), 422, 'photo_invalid');
        await upload(s.id, 1, jpegBytes(600), 'image/jpeg');
        const retry = await submit(s);
        return { status: retry.status, body: await retry.text(), id: s.id };
      }),
    );
    expect(cycles.map((c) => (c.status === 200 ? 200 : `${c.status} ${c.body}`))).toEqual(Array(10).fill(200));
    for (const c of cycles) expect(await photos(c.id)).toEqual([{ position: 1, storage_path: `${c.id}/photo-1`, content_type: 'image/jpeg', size_bytes: 600 }]);
  });

  it('a PNG and a WebP that declare more than 12,000 pixels on a side are refused as photo_invalid (decompression bomb)', async () => {
    const s = await start([
      { position: 1, content_type: 'image/png', size_bytes: 600 },
      { position: 2, content_type: 'image/webp', size_bytes: 600 },
    ]);
    await upload(s.id, 1, pngBytes(12_001, 100), 'image/png');
    await upload(s.id, 2, webpBytes(100, 12_001), 'image/webp');
    const problem = await expectProblem(await submit(s), 422, 'photo_invalid');
    expect(problem.errors?.map((e) => e.field)).toEqual(['photos[1]', 'photos[2]']);
    expect(await bucketNames(s.id)).toEqual([]);
    expect((await events(s.id, 'photo_upload_failed')).map((e) => e.properties).sort((a, b) => Number((a as { photo_index: number }).photo_index) - Number((b as { photo_index: number }).photo_index))).toEqual([
      { reason: 'too_large', photo_index: 1 },
      { reason: 'too_large', photo_index: 2 },
    ]);
  });

  it('a planned photo that never arrived is a 422 photo_missing on its position, with a storage_error event, and the retry completes', async () => {
    const s = await start([
      { position: 1, content_type: 'image/jpeg', size_bytes: 600 },
      { position: 2, content_type: 'image/jpeg', size_bytes: 600 },
    ]);
    await upload(s.id, 1, jpegBytes(), 'image/jpeg');
    const problem = await expectProblem(await submit(s), 422, 'photo_missing');
    expect(problem.errors).toEqual([{ field: 'photos[2]', message: "This photo didn't upload. Please add it again." }]);
    expect(await row(s.id)).toMatchObject({ state: 'pending' });
    expect((await events(s.id, 'photo_upload_failed')).map((e) => e.properties)).toEqual([{ reason: 'storage_error', photo_index: 2 }]);

    await upload(s.id, 2, jpegBytes(), 'image/jpeg');
    expect((await submit(s)).status).toBe(200);
  });

  it('every bad photo is named at once, a good one among them is untouched, and the code is photo_invalid when any is invalid', async () => {
    const s = await start([
      { position: 1, content_type: 'image/jpeg', size_bytes: 600 },
      { position: 2, content_type: 'image/jpeg', size_bytes: 600 },
      { position: 3, content_type: 'image/png', size_bytes: 600 },
    ]);
    await upload(s.id, 1, textBytes(), 'image/jpeg');
    await upload(s.id, 2, jpegBytes(), 'image/jpeg');
    await upload(s.id, 3, pngBytes(12_001, 1), 'image/png');
    const problem = await expectProblem(await submit(s), 422, 'photo_invalid');
    expect(problem.errors?.map((e) => e.field)).toEqual(['photos[1]', 'photos[3]']);
    expect(await bucketNames(s.id)).toEqual(['photo-2']);
    expect(await row(s.id)).toMatchObject({ state: 'pending' });
  });
});

describe('REV-2: a photo swapped before Send again is the one stored, never the earlier upload (AC-002.1, AC-002.6)', () => {
  it.each([
    ['another size', { position: 1, content_type: 'image/jpeg', size_bytes: 601 }, jpegBytes(601), 'image/jpeg'],
    ['another type at the same size', { position: 1, content_type: 'image/png', size_bytes: 600 }, pngBytes(1, 1, 600), 'image/png'],
  ] as const)('pending: X uploaded, then the same token and photo count with Y (%s) clears X, and Y is what gets stored', async (_label, planY, bytesY, typeY) => {
    const s = await start([{ position: 1, content_type: 'image/jpeg', size_bytes: 600 }]);
    await upload(s.id, 1, jpegBytes(600), 'image/jpeg'); // X

    const res = await resend(s, { ...s.body, photos: [planY] });
    expect(res.status).toBe(200);
    const again = CreateQuoteRequestResponse.parse(await res.json());
    expect(again).toMatchObject({ request_id: s.id, submission_state: 'pending' });
    expect(again.photo_uploads).toEqual([{ position: 1, bucket: 'quote-photos', path: `${s.id}/photo-1`, content_type: typeY }]);
    expect(await bucketNames(s.id)).toEqual([]); // the changed plan is `updated`, which removes X

    await uploadLikeTheForm(s.id, 1, bytesY, typeY); // Y; a 409 here would mean X is still there (the bug)
    const done = await submit(s);
    expect(done.status).toBe(200);
    expect(await photos(s.id)).toEqual([{ position: 1, storage_path: `${s.id}/photo-1`, content_type: typeY, size_bytes: bytesY.length }]);
    expect(await storedBytes(s.id, 1)).toEqual(bytesY);
    expect((await row(s.id)).photo_plan).toEqual([planY]);
  });

  it('submitted: the same token with a different photo plan is a 409 form_already_used, and the stored photo is unchanged', async () => {
    const plan: Plan = [{ position: 1, content_type: 'image/jpeg', size_bytes: 600 }];
    const s = await start(plan);
    await upload(s.id, 1, jpegBytes(600), 'image/jpeg');
    expect((await submit(s)).status).toBe(200);

    await expectProblem(await resend(s, { ...s.body, photos: [{ position: 1, content_type: 'image/jpeg', size_bytes: 601 }] }), 409, 'form_already_used');
    const same = await resend(s, s.body); // the unchanged resend still answers with the reference
    expect(same.status).toBe(200);
    expect(CreateQuoteRequestResponse.parse(await same.json())).toMatchObject({ request_id: s.id, submission_state: 'submitted' });
    expect(await photos(s.id)).toEqual([{ position: 1, storage_path: `${s.id}/photo-1`, content_type: 'image/jpeg', size_bytes: 600 }]);
    expect(await bucketNames(s.id)).toEqual(['photo-1']);
  });

  it('CQ-3b: an unchanged resend after photo 1 went up through the real Storage API keeps it (Storage stamps uploads with the database clock)', async () => {
    const plan: Plan = [
      { position: 1, content_type: 'image/jpeg', size_bytes: 600 },
      { position: 2, content_type: 'image/png', size_bytes: 600 },
    ];
    const s = await start(plan);
    const pending = await row(s.id);
    expect(pending.photo_plan).toEqual(plan); // CQ-1: the validated plan reached start_quote_request

    await upload(s.id, 1, jpegBytes(600), 'image/jpeg'); // through the Storage API with the publishable key, as the browser does
    const listed = (await staging.db().storage.from('quote-photos').list(s.id)).data ?? [];
    expect(listed.map((f) => f.name)).toEqual(['photo-1']);
    expect(listed[0]!.created_at).toEqual(expect.any(String));
    expect(Date.parse(listed[0]!.created_at ?? '')).toBeGreaterThanOrEqual(Date.parse(pending.photos_planned_at)); // not "left over"

    // AC-002.6: photo 2 failed; she taps Send again with nothing changed
    const res = await resend(s, s.body);
    expect(res.status).toBe(200);
    expect(CreateQuoteRequestResponse.parse(await res.json())).toMatchObject({ request_id: s.id, submission_state: 'pending' });
    expect(await bucketNames(s.id)).toEqual(['photo-1']); // replayed, not updated: the upload is kept
    expect((await row(s.id)).photos_planned_at).toBe(pending.photos_planned_at);

    await upload(s.id, 2, pngBytes(1, 1, 600), 'image/png');
    const done = await submit(s);
    expect(done.status).toBe(200);
    expect(SubmitQuoteRequestResponse.parse(await done.json()).photo_count).toBe(2);
  });
});

describe('REV-2 CQ-2: a stored photo whose size differs from the plan is refused (defence in depth)', () => {
  it('plan 600 bytes, stored 700: 422 photo_invalid on photos[1], the object is removed and recorded, and the right photo then completes it', async () => {
    const s = await start([{ position: 1, content_type: 'image/jpeg', size_bytes: 600 }]);
    await upload(s.id, 1, jpegBytes(700), 'image/jpeg');
    const problem = await expectProblem(await submit(s), 422, 'photo_invalid');
    expect(problem.errors).toEqual([{ field: 'photos[1]', message: "This photo didn't upload. Please add it again." }]);
    expect(await bucketNames(s.id)).toEqual([]);
    expect(await row(s.id)).toMatchObject({ state: 'pending', reference: null });
    expect(await photos(s.id)).toHaveLength(0);
    expect((await events(s.id, 'photo_upload_failed')).map((e) => e.properties)).toEqual([{ reason: 'storage_error', photo_index: 1 }]);

    await upload(s.id, 1, jpegBytes(600), 'image/jpeg');
    expect((await submit(s)).status).toBe(200);
    expect(await photos(s.id)).toEqual([{ position: 1, storage_path: `${s.id}/photo-1`, content_type: 'image/jpeg', size_bytes: 600 }]);
  });

  it('only the size is compared: a declared type that differs from the bytes is stored with the type the bytes say', async () => {
    const s = await start([{ position: 1, content_type: 'image/jpeg', size_bytes: 600 }]);
    await upload(s.id, 1, pngBytes(1, 1, 600), 'image/jpeg');
    expect((await submit(s)).status).toBe(200);
    expect((await photos(s.id))[0]).toMatchObject({ content_type: 'image/png', size_bytes: 600 });
  });

  it('a request stored without a plan (started before the route sent plans) is not compared: the photo count decides, as before', async () => {
    const s = await start([{ position: 1, content_type: 'image/jpeg', size_bytes: 600 }]);
    expect((await staging.db().from('quote_requests').update({ photo_plan: null }).eq('id', s.id)).error).toBeNull();
    await upload(s.id, 1, jpegBytes(700), 'image/jpeg');
    expect((await submit(s)).status).toBe(200);
    expect((await photos(s.id))[0]).toMatchObject({ size_bytes: 700 });
  });
});

describe('the token must be the one that created the request (SEC-2) and the id must exist', () => {
  it('another valid token is a 401 form_token_invalid, a missing or tampered one too, and the request stays pending', async () => {
    const s = await start();
    const other = staging.token();
    await expectProblem(await submit({ ...s, token: other }), 401, 'form_token_invalid');
    await expectProblem(await submit({ ...s, token: null }), 401, 'form_token_invalid');
    const parts = s.token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]!.startsWith('A') ? 'B' : 'A'}${parts[3]!.slice(1)}`;
    await expectProblem(await submit({ ...s, token: tampered }), 401, 'form_token_invalid');
    expect(await row(s.id)).toMatchObject({ state: 'pending', reference: null });
    expect((await submit(s)).status).toBe(200); // its own token still works
  });

  it('a token older than 24 hours is a 400 form_expired; one under 3 seconds old is the generic 400 submission_refused', async () => {
    const s = await start();
    await expectProblem(await submit({ ...s, token: staging.token(25 * 60 * 60 * 1000) }), 400, 'form_expired');
    await expectProblem(await submit({ ...s, token: staging.token(100) }), 400, 'submission_refused');
  });

  it('an unknown or malformed request id is a 404 not_found for a good token', async () => {
    const s = await start();
    await expectProblem(await submit(s, '00000000-0000-4000-8000-000000000000'), 404, 'not_found');
    await expectProblem(await submit(s, 'not-a-uuid'), 404, 'not_found');
    await expectProblem(await submit(s, "1'; drop table quote_requests; --"), 404, 'not_found');
  });

  it('any other method is a 405 problem with an Allow header', async () => {
    const s = await start();
    const res = await submitGet(jsonRequest(`/api/quote-requests/${s.id}/submission`, { method: 'GET' }), { params: Promise.resolve({ request_id: s.id }) });
    await expectProblem(res, 405, 'method_not_allowed');
    expect(res.headers.get('allow')).toBe('POST');
  });
});

describe('after a completed submission the token is spent (SEC-2, contract createQuoteRequest)', () => {
  it('the same token and answers again is a 200 that carries the reference and no uploads; changed answers are a 409 form_already_used and change nothing', async () => {
    const s = await start([], { marketing_consent: false });
    const done = SubmitQuoteRequestResponse.parse(await (await submit(s)).json());
    const again = await createPost(jsonRequest('/api/quote-requests', { headers: { 'x-form-token': s.token, 'x-real-ip': s.ip }, body: s.body }), undefined);
    expect(again.status).toBe(200);
    expect(CreateQuoteRequestResponse.parse(await again.json())).toEqual({ request_id: s.id, submission_state: 'submitted', reference: done.reference, photo_uploads: [], upload_expires_at: null });

    const other = await createPost(
      jsonRequest('/api/quote-requests', { headers: { 'x-form-token': s.token, 'x-real-ip': s.ip }, body: { ...s.body, name: 'Someone Else', problem: 'Homeowner B must never be merged into A' } }),
      undefined,
    );
    const problem = await expectProblem(other, 409, 'form_already_used');
    expect(problem.title).toBe("We couldn't send your request. Please try again.");
    expect(await row(s.id)).toMatchObject({ name: 'Rehearsal Tester', problem: 'The test tap drips constantly under the sink', state: 'submitted' });
  });
});

describe('a missing or short signing secret fails closed on submit too (invariant 15)', () => {
  it.each([
    ['unset', undefined],
    ['31 characters', 'x'.repeat(31)],
  ])('APP_SIGNING_SECRET %s gives 503 service_unavailable and completes nothing', async (_label, value) => {
    const s = await start();
    vi.stubEnv('APP_SIGNING_SECRET', value);
    try {
      await expectProblem(await submit(s), 503, 'service_unavailable');
    } finally {
      vi.stubEnv('APP_SIGNING_SECRET', staging.secrets.signing);
    }
    expect(await row(s.id)).toMatchObject({ state: 'pending' });
  });
});
