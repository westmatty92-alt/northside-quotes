// QA2 probes, part 8: the photo bucket and the create route's input rules. These tests spend the shared submission
// limit (5 accepted per 10 minutes per address): the burst in 40-public-form uses the whole window, so the first test
// here waits for it to age out (the wait is the limit being honoured). They create at most four more requests:
//   A  plan 3 photos   full folder, then 4th photo, escapes, overwrite, delete, reads; submitted at the end
//   B  plan 1 photo    unplanned position, oversize, wrong type, a text file wearing a JPEG name, then a real photo
//   C  boundary        one pending request that is updated with every valid edge, and left pending (purged after 24 h)
//   D  mass assignment only if the extra fields were accepted instead of refused
//
//   PRB-70  AC-002.1 uploading is allowed only into the folder of a pending request, for a planned position
//   PRB-71  SECURITY_MODEL invariant 6, threat model "Storage upload": 4th photo, folder escape, overwrite, delete, copy, list, reads
//   PRB-72  AC-002.4 invariant 7: oversize, wrong type, a text file wearing a JPEG name is refused at submit and deleted;
//           a token cannot complete another request
//   PRB-73  AC-002.8 invariant 6: after submit only staff, through a signed URL of 900 seconds, can read; no direct address works
//   PRB-74  boundaries of createQuoteRequest: invalid input is 422 and names the field; every valid edge is accepted; nulls never 500
//   PRB-75  mass assignment on create: extra fields are refused or ignored
import { test, expect } from '../support/fixtures';
import { fetchPublicPage, type Detail } from '../support/api';
import { jpeg } from '../support/files';
import { takeSubmissionSlot } from '../support/budget';
import {
  appApi,
  expectNone,
  homeownerBody,
  isProblemJson,
  line,
  lineWithBody,
  loadState,
  newSupabase,
  newUuid,
  probeTag,
  problemOf,
  recordProbeCreated,
  rowsOf,
  saveState,
  sleep,
  staffToken,
  supabaseTarget,
  vercelId,
  ZERO_UUID,
} from './support';
import type { APIRequestContext, APIResponse, TestInfo } from '@playwright/test';

interface Pending {
  id: string;
  token: string;
  body: Record<string, unknown>;
  paths: string[];
}

// What PRB-70 and PRB-74 hand on lives in the run's state file (see support.ts), so a failing test does not make the
// next ones throw, and a boundary that fails in PRB-71 does not hide what PRB-72 and PRB-73 would have found.
function st() {
  return {
    A: loadState<Pending>('A'),
    B: loadState<Pending>('B'),
    C: loadState<{ id: string; token: string }>('C'),
    jpegBytes: Buffer.from(loadState<string>('jpeg') ?? '', 'base64'),
  };
}

const notStored = (res: APIResponse) => res.status() >= 400; // a refused upload, whichever status Storage chooses

async function freshTokens(anon: APIRequestContext, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i += 10) {
    const pages = await Promise.all(Array.from({ length: Math.min(10, n - i) }, () => fetchPublicPage(anon)));
    for (const p of pages) {
      if (!p.token) throw new Error(`no form token on GET /: ${line('GET /', p.res)}`);
      out.push(p.token);
    }
  }
  return out;
}

async function upload(sb: APIRequestContext, objectPath: string, bytes: Buffer, contentType: string, headers: Record<string, string> = {}): Promise<APIResponse> {
  return sb.post(`/storage/v1/object/quote-photos/${objectPath}`, { data: bytes, headers: { 'content-type': contentType, 'x-upsert': 'false', ...headers } });
}

async function createPending(anon: APIRequestContext, testInfo: TestInfo, name: string, index: number, photos: number, photoBytes: number): Promise<Pending> {
  const [token] = await freshTokens(anon, 1);
  if (!token) throw new Error('no token');
  await sleep(3_600);
  await takeSubmissionSlot(testInfo);
  const body = homeownerBody(`${probeTag()} ${name}`, index, { photos: Array.from({ length: photos }, (_, i) => ({ position: i + 1, content_type: 'image/jpeg', size_bytes: photoBytes })) });
  const res = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': token }, data: body });
  if (res.status() !== 201) throw new Error(`${await lineWithBody(`create ${name}`, res)} expected 201`);
  const json = (await res.json()) as { request_id: string; photo_uploads: Array<{ path: string }> };
  return { id: json.request_id, token, body, paths: json.photo_uploads.map((u) => u.path) };
}

test.describe('photo bucket and create-route input @probe', () => {
  test('@probe PRB-70 AC-002.1 a homeowner can upload into the folder of her own pending request, for planned positions only', async ({ playwright, page }, testInfo) => {
    await page.goto('about:blank');
    const jpegBytes = (await jpeg(page, 'probe.jpg', 3_000, 30)).buffer;
    saveState('jpeg', jpegBytes.toString('base64'));
    const anon = await appApi(playwright);
    const sb = await newSupabase(playwright);
    const A = await createPending(anon, testInfo, 'storage A', 50, 3, jpegBytes.length);
    saveState('A', A);
    const B = await createPending(anon, testInfo, 'storage B', 51, 1, jpegBytes.length);
    saveState('B', B);
    const failures: string[] = [];
    expect(A.paths, 'the create response plans three upload paths').toHaveLength(3);
    for (const p of A.paths) {
      const res = await upload(sb, p, jpegBytes, 'image/jpeg');
      if (res.status() !== 200) failures.push(`${await lineWithBody(`upload ${p.split('/')[1]}`, res)} expected 200 for a planned photo of her pending request`);
    }
    // B's one planned photo is deliberately NOT uploaded yet: PRB-72 uses its slot for the file-content checks.
    await anon.dispose();
    await sb.dispose();
    await expectNone(testInfo, failures, 'planned uploads');
  });

  test('@probe PRB-71 a 4th photo, a name or folder of someone else, overwrite, delete, copy, move and every read of an unsubmitted photo are refused', async ({ playwright }, testInfo) => {
    const { A, B, jpegBytes } = st();
    if (!A || !B) throw new Error('PRB-70 must run first (it makes the pending requests A and B)');
    const anon = await newSupabase(playwright);
    const staff = await newSupabase(playwright, await staffToken(playwright, 'owner'));
    const app = await appApi(playwright, await staffToken(playwright, 'owner'));
    const failures: string[] = [];
    const folder = A.id;
    const other = newUuid();
    const junk = Buffer.from('this is not a picture\n'.repeat(20));

    const refused: Array<[string, string, Buffer, string, Record<string, string>?]> = [
      ['a 4th photo (photo-4) in a full folder', `${folder}/photo-4`, jpegBytes, 'image/jpeg'],
      ['photo-3 again with a different extension', `${folder}/photo-3.jpg`, jpegBytes, 'image/jpeg'],
      ['photo-0', `${folder}/photo-0`, jpegBytes, 'image/jpeg'],
      ['upper case name', `${folder}/PHOTO-1`, jpegBytes, 'image/jpeg'],
      ['a nested path', `${folder}/sub/photo-1`, jpegBytes, 'image/jpeg'],
      ["someone else's (unknown) folder", `${other}/photo-1`, jpegBytes, 'image/jpeg'],
      ['the bucket root, no folder', 'photo-1', jpegBytes, 'image/jpeg'],
      ['a path that climbs out of the folder into B, to an unplanned position', `${folder}%2F..%2F${B.id}%2Fphoto-2`, jpegBytes, 'image/jpeg'],
      ["B's unplanned position (B planned one photo)", `${B.id}/photo-2`, jpegBytes, 'image/jpeg'],
      ["B's unplanned position 3", `${B.id}/photo-3`, jpegBytes, 'image/jpeg'],
      ['overwrite photo-1 with upsert and text bytes', `${folder}/photo-1`, junk, 'image/jpeg', { 'x-upsert': 'true' }],
      ['overwrite photo-2 without upsert (the object exists)', `${folder}/photo-2`, junk, 'image/jpeg'],
    ];
    for (const [label, objectPath, bytes, type, headers] of refused) {
      const res = await upload(anon, objectPath, bytes, type, headers);
      if (!notStored(res)) failures.push(`CRITICAL ${await lineWithBody(`anon upload: ${label}`, res)} was accepted`);
    }
    const otherBucket = await anon.post(`/storage/v1/object/other-bucket/${folder}/photo-1`, { data: jpegBytes, headers: { 'content-type': 'image/jpeg' } });
    if (!notStored(otherBucket)) failures.push(`${line('anon upload into another bucket', otherBucket)} was accepted`);

    // Delete, copy, move and list: attempted by anon and by staff. None may change or reveal anything.
    for (const [who, client] of [['anon', anon], ['staff', staff]] as const) {
      const del = await client.delete(`/storage/v1/object/quote-photos/${folder}/photo-1`);
      const delBulk = await client.delete('/storage/v1/object/quote-photos', { data: { prefixes: [`${folder}/photo-1`, `${folder}/photo-2`, `${folder}/photo-3`] } });
      for (const [label, res] of [['delete', del], ['bulk delete', delBulk]] as const) {
        if (res.status() === 200) {
          const rows = await rowsOf(res);
          if (rows && rows.length > 0) failures.push(`CRITICAL ${who} ${label} of an unsubmitted photo removed ${rows.length} object(s)`);
        }
      }
      const copy = await client.post('/storage/v1/object/copy', { data: { bucketId: 'quote-photos', sourceKey: `${folder}/photo-1`, destinationKey: `${other}/photo-1` } });
      if (copy.status() >= 200 && copy.status() < 300) failures.push(`CRITICAL ${line(`${who} copy of an unsubmitted photo`, copy)} was accepted`);
      const move = await client.post('/storage/v1/object/move', { data: { bucketId: 'quote-photos', sourceKey: `${folder}/photo-1`, destinationKey: `${other}/photo-1` } });
      if (move.status() >= 200 && move.status() < 300) failures.push(`CRITICAL ${line(`${who} move of an unsubmitted photo`, move)} was accepted`);
      const list = await client.post('/storage/v1/object/list/quote-photos', { data: { prefix: folder, limit: 100 } });
      const names = list.status() === 200 ? await rowsOf(list) : [];
      if (names && names.length > 0) failures.push(`CRITICAL ${who} can list ${names.length} object(s) of an unsubmitted request`);
    }

    // Reads of unsubmitted photos: no address works for anon, and none for staff (no quote_photos row exists yet).
    const reads: Array<[string, APIRequestContext, string]> = [
      ['anon, private address', anon, `/storage/v1/object/quote-photos/${folder}/photo-1`],
      ['anon, public address', anon, `/storage/v1/object/public/quote-photos/${folder}/photo-1`],
      ['anon, authenticated address', anon, `/storage/v1/object/authenticated/quote-photos/${folder}/photo-1`],
      ['staff, private address', staff, `/storage/v1/object/quote-photos/${folder}/photo-1`],
      ['staff, authenticated address', staff, `/storage/v1/object/authenticated/quote-photos/${folder}/photo-1`],
      ['staff, info', staff, `/storage/v1/object/info/quote-photos/${folder}/photo-1`],
    ];
    for (const [label, client, objectPath] of reads) {
      const res = await client.get(objectPath);
      if (res.status() === 200) failures.push(`CRITICAL ${line(`read of an unsubmitted photo [${label}]`, res)} returned the object (${res.headers()['content-type'] ?? 'n/a'})`);
    }
    const signed = await staff.post(`/storage/v1/object/sign/quote-photos/${folder}/photo-1`, { data: { expiresIn: 60 } });
    if (signed.status() === 200) failures.push(`CRITICAL ${line('staff signed URL for an unsubmitted photo', signed)} was created`);
    const signedBatch = await staff.post('/storage/v1/object/sign/quote-photos', { data: { expiresIn: 60, paths: [`${folder}/photo-1`, `${folder}/photo-2`] } });
    if (signedBatch.status() === 200) {
      const rows = (await signedBatch.json()) as Array<{ signedURL?: string | null; error?: string | null }>;
      if (rows.some((r) => r.signedURL)) failures.push(`CRITICAL ${line('staff batch of signed URLs for unsubmitted photos', signedBatch)} created a URL`);
    }

    // The app and the REST API treat the pending request as if it did not exist (invariant 5).
    for (const path of [`/api/quote-requests/${folder}`, `/api/quote-requests/${folder}/photos`]) {
      const res = await app.get(path);
      const problem = await problemOf(res);
      if (res.status() !== 404 || problem?.code !== 'not_found') failures.push(`${await lineWithBody(`staff GET ${path.replace(folder, '{pending id}')}`, res)} expected 404 not_found`);
    }
    for (const [label, table, filter] of [['quote_requests', 'quote_requests', `id=eq.${folder}`], ['quote_photos', 'quote_photos', `request_id=eq.${folder}`]] as const) {
      const res = await staff.get(`/rest/v1/${table}?select=id&${filter}`);
      const rows = await rowsOf(res);
      if (!rows || rows.length > 0) failures.push(`CRITICAL staff REST read of ${label} for a pending request returned ${rows ? rows.length : 'a non-list'} row(s)`);
    }
    const listing = await app.get(`/api/quote-requests?q=${encodeURIComponent('storage A')}&limit=100`);
    const listed = listing.status() === 200 ? ((await listing.json()) as { data: Array<{ id: string }> }).data : [];
    if (listed.some((r) => r.id === folder)) failures.push('CRITICAL the pending request appears in the staff list');

    await anon.dispose();
    await staff.dispose();
    await app.dispose();
    await expectNone(testInfo, failures, 'storage boundaries');
  });

  test('@probe PRB-72 AC-002.4 an oversize file, a wrong type and a text file named like a JPEG never become part of a request; a token cannot complete another request', async ({ playwright }, testInfo) => {
    const { A, B, jpegBytes } = st();
    if (!A || !B) throw new Error('PRB-70 must run first (it makes the pending requests A and B)');
    const anon = await newSupabase(playwright);
    const app = await appApi(playwright);
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const failures: string[] = [];
    const target = `${B.id}/photo-1`;

    // The bucket itself refuses a file over 5,242,880 bytes and any type but JPEG, PNG and WebP.
    const oversize = await upload(anon, target, Buffer.alloc(5_242_881), 'image/jpeg');
    if (!notStored(oversize)) failures.push(`${line('upload of 5,242,881 bytes', oversize)} was accepted`);
    for (const [label, type] of [['application/pdf', 'application/pdf'], ['image/svg+xml', 'image/svg+xml'], ['text/html', 'text/html'], ['application/octet-stream', 'application/octet-stream']] as const) {
      const res = await upload(anon, target, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), type);
      if (!notStored(res)) failures.push(`${line(`upload declared as ${label}`, res)} was accepted`);
    }

    // Another request's token cannot complete B (which is still pending), and B stays invisible to staff.
    const wrong = await app.post(`/api/quote-requests/${B.id}/submission`, { headers: { 'X-Form-Token': A.token } });
    const wrongProblem = await problemOf(wrong);
    if (wrong.status() !== 401 || wrongProblem?.code !== 'form_token_invalid') failures.push(`${await lineWithBody("A's token on B's submission", wrong)} expected 401 form_token_invalid`);
    const stillPending = await owner.get(`/api/quote-requests/${B.id}`);
    if (stillPending.status() !== 404) failures.push(`${line('staff GET of B after the wrong-token submission', stillPending)} expected 404 (B is still pending)`);

    // A text file wearing a JPEG name: the bucket checks only the declared type, so it may be stored; the submit step
    // reads the first bytes, refuses it (422 photo_invalid naming photos[1]), deletes it and leaves nothing visible.
    const junk = Buffer.from('This is plain text, not a picture.\n'.repeat(40));
    const sneaked = await upload(anon, target, junk, 'image/jpeg');
    if (sneaked.status() === 200) {
      const refused = await app.post(`/api/quote-requests/${B.id}/submission`, { headers: { 'X-Form-Token': B.token } });
      const refusedProblem = await problemOf(refused);
      if (refused.status() !== 422 || refusedProblem?.code !== 'photo_invalid') failures.push(`${await lineWithBody('submission with a text file named photo-1', refused)} expected 422 photo_invalid`);
      else if (!refusedProblem.errors?.some((e) => e.field === 'photos[1]')) failures.push(`${line('photo_invalid refusal', refused)} does not name photos[1] in errors[]`);
      const hidden = await owner.get(`/api/quote-requests/${B.id}`);
      if (hidden.status() !== 404) failures.push(`CRITICAL ${line('staff GET of B after a refused photo', hidden)} B became visible with a bad photo`);
      // The refused file was deleted, so the position is free again (a still-present file would answer 409).
      const again = await upload(anon, target, jpegBytes, 'image/jpeg');
      if (again.status() !== 200) failures.push(`${await lineWithBody('upload a real photo into the position the refused file used', again)} expected 200 (the bad file must have been deleted)`);
    } else {
      testInfo.annotations.push({ type: 'note', description: `the text file declared as image/jpeg was refused at upload (${sneaked.status()}), so the submit-time byte check was not exercised` });
      const again = await upload(anon, target, jpegBytes, 'image/jpeg');
      if (again.status() !== 200) failures.push(`${await lineWithBody('upload a real photo into B photo-1', again)} expected 200`);
    }
    const complete = await app.post(`/api/quote-requests/${B.id}/submission`, { headers: { 'X-Form-Token': B.token } });
    if (complete.status() !== 200) failures.push(`${await lineWithBody('submission of B with a real photo', complete)} expected 200`);
    else {
      const sub = (await complete.json()) as { reference: string; photo_count: number };
      if (sub.photo_count !== 1) failures.push(`B completed with ${sub.photo_count} photos, expected 1`);
      recordProbeCreated({ reference: sub.reference, name: String(B.body['name']), note: 'storage probe B: oversize, wrong type and a text file named photo-1 were refused first' });
    }

    await anon.dispose();
    await app.dispose();
    await owner.dispose();
    await expectNone(testInfo, failures, 'photo file rules');
  });

  test('@probe PRB-73 AC-002.8 once submitted, photos are readable only by staff through a 900-second signed URL; no direct address returns them; a changed or missing token fails', async ({ playwright }, testInfo) => {
    const { A, B, jpegBytes } = st();
    if (!A || !B) throw new Error('PRB-70 must run first (it makes the pending requests A and B)');
    const target = supabaseTarget();
    const anonApp = await appApi(playwright);
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const anon = await newSupabase(playwright);
    const staff = await newSupabase(playwright, await staffToken(playwright, 'owner'));
    const plain = await playwright.request.newContext(); // no key, no token, no bypass header
    const failures: string[] = [];

    // Overwrite and delete attempts in PRB-71 must have left A's three photos intact, so it still completes with 3.
    const done = await anonApp.post(`/api/quote-requests/${A.id}/submission`, { headers: { 'X-Form-Token': A.token } });
    if (done.status() !== 200) failures.push(`${await lineWithBody("submission of A after the overwrite, delete and copy attempts", done)} expected 200 (three untouched photos)`);
    else {
      const ref = ((await done.json()) as { reference: string; photo_count: number });
      if (ref.photo_count !== 3) failures.push(`A completed with ${ref.photo_count} photos, expected 3`);
      recordProbeCreated({ reference: ref.reference, name: String(A.body['name']), note: 'storage probe A: three photos, bucket attack attempts' });
    }

    const detailRes = await owner.get(`/api/quote-requests/${A.id}`);
    const detail = detailRes.status() === 200 ? ((await detailRes.json()) as Detail) : null;
    if (!detail) failures.push(`${line('staff GET of A after submit', detailRes)} expected 200`);
    else {
      if (detail.photo_count !== 3 || detail.photos.length !== 3) failures.push(`staff see ${detail.photos.length} photos of A, expected 3`);
      for (const p of detail.photos) {
        if (!p.url) {
          failures.push(`photo ${p.position} has no signed URL`);
          continue;
        }
        const u = new URL(p.url);
        if (u.host !== target.host || !u.pathname.includes('/object/sign/quote-photos/')) failures.push(`photo ${p.position} URL is not a Supabase signed URL (${u.host}${u.pathname.slice(0, 30)})`);
        const lifetime = p.expires_at ? (new Date(p.expires_at).getTime() - Date.now()) / 1000 : NaN;
        if (!(lifetime > 0 && lifetime <= 960)) failures.push(`photo ${p.position} expires in ${Math.round(lifetime)}s, expected at most 900 (plus clock slack)`);
        const ok = await plain.get(p.url);
        if (ok.status() !== 200 || !(ok.headers()['content-type'] ?? '').startsWith('image/')) failures.push(`${line(`signed URL of photo ${p.position}`, ok)} expected 200 and an image`);
        else if ((await ok.body()).subarray(0, 3).toString('hex') !== 'ffd8ff') failures.push(`photo ${p.position} does not start with the JPEG signature`);
        const noToken = new URL(p.url);
        noToken.searchParams.delete('token');
        const bare = await plain.get(noToken.toString());
        if (bare.status() === 200) failures.push(`CRITICAL ${line(`photo ${p.position} signed URL without its token`, bare)} returned the object`);
        const bad = new URL(p.url);
        const t = bad.searchParams.get('token') ?? '';
        bad.searchParams.set('token', `${t.slice(0, -4)}AAAA`);
        const tampered = await plain.get(bad.toString());
        if (tampered.status() === 200) failures.push(`CRITICAL ${line(`photo ${p.position} signed URL with a changed token`, tampered)} returned the object`);
      }
    }

    // The app's photos route: staff 200 with fresh URLs, no session 401.
    const mine = await owner.get(`/api/quote-requests/${A.id}/photos`);
    if (mine.status() !== 200 || ((await mine.json()) as { data: unknown[] }).data.length !== 3) failures.push(`${line('staff GET photos of A', mine)} expected 200 with 3 photos`);
    const noSession = await anonApp.get(`/api/quote-requests/${A.id}/photos`);
    if (noSession.status() !== 401) failures.push(`${line('GET photos with no session', noSession)} expected 401`);

    // Direct addresses, with the public key, with a staff token, and with nothing at all.
    const direct = `${A.id}/photo-1`;
    for (const [label, client, objectPath] of [
      ['anon key, private address', anon, `/storage/v1/object/quote-photos/${direct}`],
      ['anon key, public address', anon, `/storage/v1/object/public/quote-photos/${direct}`],
      ['anon key, authenticated address', anon, `/storage/v1/object/authenticated/quote-photos/${direct}`],
      ['no key at all, private address', plain, `${target.origin}/storage/v1/object/quote-photos/${direct}`],
      ['no key at all, public address', plain, `${target.origin}/storage/v1/object/public/quote-photos/${direct}`],
    ] as const) {
      const res = await client.get(objectPath);
      if (res.status() === 200) failures.push(`CRITICAL ${line(`direct photo address [${label}]`, res)} returned the object`);
    }
    const listAnon = await anon.post('/storage/v1/object/list/quote-photos', { data: { prefix: A.id, limit: 100 } });
    const listedAnon = listAnon.status() === 200 ? await rowsOf(listAnon) : [];
    if (listedAnon && listedAnon.length > 0) failures.push(`CRITICAL the anon key can list ${listedAnon.length} object(s) of a submitted request`);
    // After submit the folder is closed to uploads.
    const late = await upload(anon, `${A.id}/photo-1`, jpegBytes, 'image/jpeg');
    if (!notStored(late)) failures.push(`${line('upload into a submitted request', late)} was accepted`);
    const late4 = await upload(anon, `${A.id}/photo-4`, jpegBytes, 'image/jpeg');
    if (!notStored(late4)) failures.push(`${line('4th photo into a submitted request', late4)} was accepted`);

    await anonApp.dispose();
    await owner.dispose();
    await anon.dispose();
    await staff.dispose();
    await plain.dispose();
    await expectNone(testInfo, failures, 'signed photo access');
  });

  test('@probe PRB-74 AC-003.3 every valid edge of every field is accepted on one pending request (same token, changed answers updates it): name 2 and 100, address 5 and 200, problem 10 and 2000, email 254, phone shapes, every urgency', async ({ playwright }, testInfo) => {
    const anon = await appApi(playwright);
    const [token] = await freshTokens(anon, 1);
    if (!token) throw new Error('no token');
    const failures: string[] = [];
    // First send under 3 seconds: refused (AC-003.3). The same token after 3 seconds is accepted (it takes one slot).
    const fast = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': token }, data: homeownerBody(`${probeTag()} boundary`, 70) });
    if (fast.status() !== 400) failures.push(`${await lineWithBody('send under 3 seconds', fast)} expected 400`);
    await sleep(3_600);
    await takeSubmissionSlot(testInfo);
    const first = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': token }, data: homeownerBody(`${probeTag()} boundary`, 70) });
    if (first.status() !== 201) failures.push(`${await lineWithBody('the same token after 3 seconds (AC-003.3)', first)} expected 201`);
    const requestId = first.status() === 201 ? ((await first.json()) as { request_id: string }).request_id : '';
    if (requestId) saveState('C', { id: requestId, token });

    const base = (extra: Record<string, unknown>) => homeownerBody(`${probeTag()} boundary`, 70, extra);
    const longEmail = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    const valid: Array<[string, Record<string, unknown>]> = [
      ['name 2 characters', base({ name: 'Jo' })],
      ['name 100 characters', base({ name: 'n'.repeat(100) })],
      ['name with accents and emoji', base({ name: 'Zoë Brûlé 🙂' })],
      ['name that is script text', base({ name: '<script>alert(1)</script>' })],
      ['address 5 characters', base({ address: '1 A B' })],
      ['address 200 characters', base({ address: 'a'.repeat(200) })],
      ['problem 10 characters', base({ problem: 'ten chars!' })],
      ['problem 2000 characters', base({ problem: 'p'.repeat(2000) })],
      ['email 254 characters', base({ email: longEmail })],
      ['email with surrounding spaces (trimmed)', base({ email: '  dana@example.com  ' })],
      ['phone (905) 555-0142', base({ phone: '(905) 555-0142' })],
      ['phone +1 905 555 0142', base({ phone: '+1 905 555 0142' })],
      ['phone 905.555.0142', base({ phone: '905.555.0142' })],
      ['phone 9055550142', base({ phone: '9055550142' })],
      ['urgency emergency', base({ urgency: 'emergency' })],
      ['urgency soon', base({ urgency: 'soon' })],
      ['urgency flexible', base({ urgency: 'flexible' })],
      ['one photo planned', base({ photos: [{ position: 1, content_type: 'image/webp', size_bytes: 5_242_880 }] })],
      ['three photos planned', base({ photos: [1, 2, 3].map((position) => ({ position, content_type: 'image/png', size_bytes: 1 })) })],
      ['photos empty', base({ photos: [] })],
    ];
    for (const [label, body] of valid) {
      const res = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': token }, data: body });
      const json = res.status() === 200 ? ((await res.json()) as { request_id?: string; submission_state?: string }) : null;
      if (res.status() !== 200 || json?.request_id !== requestId || json?.submission_state !== 'pending') failures.push(`${await lineWithBody(`valid edge [${label}]`, res)} expected 200 and the same pending request`);
    }
    if (requestId) recordProbeCreated({ reference: null, name: `${probeTag()} boundary`, note: 'pending only: never submitted, invisible to staff, purged by housekeeping after 24 hours' });
    await anon.dispose();
    await expectNone(testInfo, failures, 'valid edges of the create route');
  });

  test('@probe PRB-74b createQuoteRequest invalid input is 422 and names the field; odd text and explicit null never cause a 5xx; malformed bodies are 400', async ({ playwright }, testInfo) => {
    const anon = await appApi(playwright);
    const failures: string[] = [];
    const good = (extra: Record<string, unknown> = {}) => homeownerBody(`${probeTag()} edge`, 60, extra);
    const without = (field: string) => {
      const body = good();
      delete body[field];
      return body;
    };

    // Invalid on purpose: each must be refused with 422 (or 400 for the wrong JSON type) and name the field.
    const invalid: Array<[string, Record<string, unknown>, number[], RegExp]> = [
      ['name empty', good({ name: '' }), [422], /name/],
      ['name 1 character', good({ name: 'A' }), [422], /name/],
      ['name 101 characters', good({ name: 'n'.repeat(101) }), [422], /name/],
      ['name null', good({ name: null }), [400, 422], /name/],
      ['name a number', good({ name: 12345 }), [400, 422], /name/],
      ['name missing', without('name'), [422], /name/],
      ['phone empty', good({ phone: '' }), [422], /phone/],
      ['phone 12345', good({ phone: '12345' }), [422], /phone/],
      ['phone 9 digits', good({ phone: '905555014' }), [422], /phone/],
      ['phone 11 digits', good({ phone: '90555501422' }), [422], /phone/],
      ['phone letters', good({ phone: 'abcdefghij' }), [422], /phone/],
      ['phone 31 characters', good({ phone: '9'.repeat(31) }), [422], /phone/],
      ['phone missing', without('phone'), [422], /phone/],
      ['email empty', good({ email: '' }), [422], /email/],
      ['email dana@', good({ email: 'dana@' }), [422], /email/],
      ['email without @', good({ email: 'dana.example.com' }), [422], /email/],
      ['email 255 characters', good({ email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com` }), [422], /email/],
      ['email missing', without('email'), [422], /email/],
      ['address 4 characters', good({ address: 'abcd' }), [422], /address/],
      ['address 201 characters', good({ address: 'a'.repeat(201) }), [422], /address/],
      ['address missing', without('address'), [422], /address/],
      ['problem 9 characters', good({ problem: 'too short' }), [422], /problem/],
      ['problem 2001 characters', good({ problem: 'p'.repeat(2001) }), [422], /problem/],
      ['problem missing', without('problem'), [422], /problem/],
      ['urgency a fourth value', good({ urgency: 'urgent' }), [422], /urgency/],
      ['urgency empty', good({ urgency: '' }), [422], /urgency/],
      ['urgency null', good({ urgency: null }), [400, 422], /urgency/],
      ['urgency missing', without('urgency'), [422], /urgency/],
      ['4 photos planned', good({ photos: [1, 2, 3, 4].map((position) => ({ position, content_type: 'image/jpeg', size_bytes: 1000 })) }), [422], /photos/],
      ['photo of 5,242,881 bytes', good({ photos: [{ position: 1, content_type: 'image/jpeg', size_bytes: 5_242_881 }] }), [422], /photos/],
      ['photo of 0 bytes', good({ photos: [{ position: 1, content_type: 'image/jpeg', size_bytes: 0 }] }), [422], /photos/],
      ['photo of negative size', good({ photos: [{ position: 1, content_type: 'image/jpeg', size_bytes: -1 }] }), [422], /photos/],
      ['photo of type application/pdf', good({ photos: [{ position: 1, content_type: 'application/pdf', size_bytes: 1000 }] }), [422], /photos/],
      ['photo at position 4', good({ photos: [{ position: 4, content_type: 'image/jpeg', size_bytes: 1000 }] }), [422], /photos/],
      ['photo at position 0', good({ photos: [{ position: 0, content_type: 'image/jpeg', size_bytes: 1000 }] }), [422], /photos/],
      ['two photos at position 1', good({ photos: [{ position: 1, content_type: 'image/jpeg', size_bytes: 1000 }, { position: 1, content_type: 'image/png', size_bytes: 1000 }] }), [422], /photos/],
      ['a photo list that starts at 2', good({ photos: [{ position: 2, content_type: 'image/jpeg', size_bytes: 1000 }] }), [422], /photos/],
      ['an unknown field', good({ nickname: 'x' }), [422], /nickname|unknown|unrecognized|additional/i],
    ];
    // Allowed to be accepted or refused, but never a server error and never a changed or truncated value in the reply.
    const edgy: Array<[string, Record<string, unknown>]> = [
      ['name with a NUL character', good({ name: 'Zo\u0000e Probe' })],
      ['problem with a NUL character', good({ problem: 'The tap drips\u0000 and the cabinet is wet' })],
      // Added after the first fuzz run (QA2): the same two kinds of text in every other string field of the create body.
      ['address with a NUL character', good({ address: '12 Main St\u0000, Hamilton' })],
      ['address with a lone surrogate', good({ address: '12 Main St \udc00, Hamilton' })],
      ['phone with a NUL character', good({ phone: '905-555\u00000142' })],
      ['phone with a lone surrogate', good({ phone: '905-555-\ud8000142' })],
      ['email with a NUL character', good({ email: 'dana\u0000@example.com' })],
      ['email with a lone surrogate', good({ email: 'dana\ud800@example.com' })],
      ['website (honeypot) with a NUL character', good({ website: 'x\u0000y' })],
      ['website (honeypot) with a lone surrogate', good({ website: 'x\ud800y' })],
      ['photo content type with a NUL character', good({ photos: [{ position: 1, content_type: 'image/jpeg\u0000', size_bytes: 1000 }] })],
      ['name that is all emoji', good({ name: '🙂🙂🙂🙂' })],
      ['SQL-looking name', good({ name: "Robert'); DROP TABLE quote_requests;--" })],
      ['PostgREST-looking problem', good({ problem: 'q=eq.1&select=*&or=(id.not.is.null) kitchen tap drips' })],
      ['website null', good({ website: null })],
      ['photos null', good({ photos: null })],
      ['marketing_consent null', good({ marketing_consent: null })],
      ['website 501 characters', good({ website: 'w'.repeat(501) })],
      ['a 1.5 MB padding field', good({ padding: 'x'.repeat(1_500_000) })],
    ];
    // The invalid cases each get a fresh token (a refusal stores nothing). The odd-text and null cases all use the token
    // of the pending request made in PRB-74: a changed answer on a pending request updates it and takes no new slot.
    const existing = st().C;
    const C =
      existing ??
      (await (async () => {
        // PRB-74 did not leave a pending request (it failed or did not run): make one, which takes one slot.
        const made = await createPending(anon, testInfo, 'boundary', 70, 0, 1);
        saveState('C', { id: made.id, token: made.token });
        return { id: made.id, token: made.token };
      })());
    const tokens = await freshTokens(anon, invalid.length + 8);
    await sleep(3_600);
    let t = 0;
    const next = () => {
      const token = tokens[t];
      t += 1;
      if (!token) throw new Error('out of tokens');
      return token;
    };
    for (const [label, body, statuses, field] of invalid) {
      const res = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': next() }, data: body });
      const problem = await problemOf(res);
      if (!statuses.includes(res.status())) failures.push(`${await lineWithBody(`create [${label}]`, res)} expected ${statuses.join(' or ')}`);
      else if (!isProblemJson(res)) failures.push(`${line(`create [${label}]`, res)} not problem+json`);
      else if (res.status() === 422 && !problem?.errors?.some((e) => field.test(e.field))) failures.push(`${line(`create [${label}]`, res)} 422 does not name the field in errors[] (${field.source})`);
    }
    for (const [label, body] of edgy) {
      const res = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': C.token }, data: body });
      if (res.status() >= 500) failures.push(`${await lineWithBody(`create [${label}]`, res)} a server error`);
      else if (res.status() >= 400 && !isProblemJson(res) && res.status() !== 413) failures.push(`${await lineWithBody(`create [${label}]`, res)} an error that is not problem+json`);
      else if (res.status() === 200) failures.push(`INFO [${label}] was accepted as an update (200)`);
    }
    // BUG-QA2-2 regression: an unpaired UTF-16 surrogate is not well-formed text. It must be refused with 422 and the
    // field named in errors[] (never a 500), on a brand-new request and on an update of a pending one.
    for (const [label, token, body, field] of [
      ['name with a lone surrogate (update of the pending request)', C.token, good({ name: 'Zo\ud800e Probe' }), /^name$/],
      ['name with a lone surrogate (create path)', undefined, good({ name: 'Zo\ud800e Probe' }), /^name$/],
      ['problem with a lone surrogate (create path)', undefined, good({ problem: 'The tap drips \udc00 and the cabinet is wet' }), /^problem$/],
      ['address with a lone surrogate (create path)', undefined, good({ address: '12 Main St \ud83d, Hamilton' }), /^address$/],
    ] as const) {
      const res = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': token ?? next() }, data: body });
      const problem = await problemOf(res);
      if (res.status() !== 422) failures.push(`${await lineWithBody(`create [${label}]`, res)} expected 422 (BUG-QA2-2), request id ${vercelId(res)}`);
      else if (!isProblemJson(res)) failures.push(`${line(`create [${label}]`, res)} not problem+json`);
      else if (!problem?.errors?.some((e) => field.test(e.field))) failures.push(`${line(`create [${label}]`, res)} 422 does not name the field in errors[] (${field.source})`);
    }
    // Malformed bodies
    for (const [label, data, type] of [
      ['not JSON', '{not json', 'application/json'],
      ['a JSON array', '[]', 'application/json'],
      ['a JSON string', '"x"', 'application/json'],
      ['JSON null', 'null', 'application/json'],
    ] as const) {
      const res = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': next(), 'content-type': type }, data: Buffer.from(data) });
      if (![400, 422].includes(res.status())) failures.push(`${await lineWithBody(`create [${label}]`, res)} expected 400 or 422`);
    }
    const hard = failures.filter((f) => !f.startsWith('INFO '));
    const info = failures.filter((f) => f.startsWith('INFO '));
    if (info.length > 0) testInfo.annotations.push({ type: 'accepted-edge-cases', description: info.join(' | ').slice(0, 900) });
    await anon.dispose();
    await expectNone(testInfo, hard, 'create-route input rules');
  });

  test('@probe PRB-75 mass assignment on create: status, price, reference, consent time, id, contact id and state sent as extra fields are refused (422) or ignored, never applied', async ({ playwright }, testInfo) => {
    const anon = await appApi(playwright);
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const failures: string[] = [];
    const extras: Record<string, unknown> = {
      status: 'won',
      price_cents: 99999,
      reference: 'NQ-AAAAAA',
      marketing_consent_at: '2000-01-01T00:00:00Z',
      id: ZERO_UUID,
      ghl_contact_id: 'abc123',
      state: 'submitted',
      submitted_at: '2000-01-01T00:00:00Z',
      version: 99,
      submission_key: newUuid(),
    };
    const [token] = await freshTokens(anon, 1);
    if (!token) throw new Error('no token');
    await sleep(3_600);
    const res = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': token }, data: homeownerBody(`${probeTag()} mass`, 80, extras) });
    const outcome = await problemOf(res);
    testInfo.annotations.push({ type: 'mass-assignment-create', description: `all ten extra fields together: ${res.status()} ${outcome?.code ?? '(no problem code)'}${outcome?.errors ? ` naming ${outcome.errors.map((e) => e.field).join(', ').slice(0, 160)}` : ''}` });
    if (res.status() === 422 || res.status() === 400) {
      if (!isProblemJson(res)) failures.push(`${line('create with extra fields', res)} not problem+json`);
      // Refused as a whole: nothing was created, so nothing could have been applied. Each field alone must be refused the same way.
      const alone = await freshTokens(anon, Object.keys(extras).length);
      await sleep(3_600);
      let i = 0;
      for (const [field, value] of Object.entries(extras)) {
        const one = await anon.post('/api/quote-requests', { headers: { 'X-Form-Token': alone[i] ?? '' }, data: homeownerBody(`${probeTag()} mass ${field}`, 81 + i, { [field]: value }) });
        i += 1;
        if (![400, 422].includes(one.status())) failures.push(`${await lineWithBody(`create with only "${field}" as an extra field`, one)} expected 422 (or ignored: see the report if 201)`);
      }
    } else if (res.status() === 201) {
      // Accepted with the extras ignored: complete it and read it back as staff.
      const started = (await res.json()) as { request_id: string };
      const done = await anon.post(`/api/quote-requests/${started.request_id}/submission`, { headers: { 'X-Form-Token': token } });
      if (done.status() !== 200) failures.push(`${await lineWithBody('submission of the request created with extras', done)} expected 200`);
      else {
        const sub = (await done.json()) as { reference: string };
        recordProbeCreated({ reference: sub.reference, name: `${probeTag()} mass`, note: 'created with extra fields, which the server ignored' });
        const detailRes = await owner.get(`/api/quote-requests/${started.request_id}`);
        const d = (await detailRes.json()) as Detail;
        if (d.id === ZERO_UUID) failures.push('CRITICAL the caller chose the request id');
        if (d.reference === 'NQ-AAAAAA') failures.push('CRITICAL the caller chose the reference number');
        if (d.status !== 'new') failures.push(`CRITICAL the caller chose the status (${d.status})`);
        if (d.price_cents !== null) failures.push('CRITICAL the caller set the price');
        if (d.marketing_consent_at !== null || d.marketing_consent !== false) failures.push('CRITICAL the caller set the consent time');
        if (d.version !== 1) failures.push(`the caller chose the version (${d.version})`);
        if (d.submitted_at.startsWith('2000')) failures.push('CRITICAL the caller chose the submitted time');
        if (d.ghl.copy.state !== 'not_copied_no_consent') failures.push('the caller set a GoHighLevel contact link');
      }
    } else {
      failures.push(`${await lineWithBody('create with extra fields', res)} expected 422 (refused) or 201 (extras ignored)`);
    }
    await anon.dispose();
    await owner.dispose();
    await expectNone(testInfo, failures, 'mass assignment on create');
  });

  test('@probe PRB-76 the requests this run stored are the only ones it left visible to staff (and the pending ones are not visible)', async ({ playwright }, testInfo) => {
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const res = await owner.get(`/api/quote-requests?q=${encodeURIComponent(probeTag())}&limit=100`);
    expect(res.status(), line('staff search for this run', res)).toBe(200);
    const names = ((await res.json()) as { data: Array<{ name: string; reference: string }> }).data.filter((r) => r.name.startsWith(probeTag()));
    testInfo.annotations.push({ type: 'visible-probe-requests', description: names.map((n) => n.reference).join(', ') });
    expect(names.length, 'the burst stored 5 and the storage tests completed A and B (plus one if the mass-assignment create was accepted)').toBeGreaterThanOrEqual(7);
    expect(names.some((n) => /boundary|edge/.test(n.name)), 'the boundary request stays pending and must not be visible').toBe(false);
    await owner.dispose();
  });
});
