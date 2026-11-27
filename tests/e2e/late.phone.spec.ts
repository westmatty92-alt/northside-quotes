// The last submitting tests. They run in the last project ("phone-late") so that, by the time they need their 4
// submission slots, the 10-minute window of the earlier submissions has aged out and nothing has to wait.
//   E  AC-002.6 the network drops while photo 2 uploads
//   F  AC-002.6 REV-2 the same, then photo 2 is swapped for another file and the same token is sent again
//   D  AC-001.17 a direct call with no offers value, and with "maybe", is stored as no
import { createHash } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { newApi, submitDirect } from './support/api';
import { jpeg, png } from './support/files';
import { must } from './support/pool';
import { RequestForm, REF_RE, validHomeowner } from './support/ui';
import { recordCreated, takeSubmissionSlot } from './support/budget';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

test.describe('late submissions', () => {
  test('@regression AC-002.6 when the network drops while photo 2 uploads: the error is beside photo 2, no reference, everything kept, and Send again completes it', async ({
    page,
    staffApi,
    run,
    guard,
  }, testInfo) => {
    guard.allowAbort(/\/storage\/v1\/object\/quote-photos\/[^/]+\/photo-2/);
    const ownerApi = await staffApi('owner');
    const name = run.tag('Upload-drop Robin Singh');
    const form = new RequestForm(page);
    await form.open();
    const photos = [await jpeg(page, 'p1.jpg', 300 * 1024, 10), await jpeg(page, 'p2.jpg', 300 * 1024, 100), await jpeg(page, 'p3.jpg', 300 * 1024, 200)];
    await form.fill(validHomeowner(name, { photos }));
    let drop = true;
    await page.route(/\/storage\/v1\/object\/quote-photos\/[^/]+\/photo-2/, (route) => (drop ? route.abort('failed') : route.continue()));

    await form.submit(testInfo);
    // A photo's row is a list item; its message is an alert inside that same item (as for the refused PDF, AC-002.4).
    const row = page.getByRole('listitem').filter({ hasText: 'p2.jpg' });
    await expect(row.getByRole('alert'), 'the error is next to photo 2').toContainText(/couldn.t|could not|failed|try again|didn.t upload/i);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(REF_RE), 'no reference number').toHaveCount(0);
    await expect(form.name, 'the form is kept').toHaveValue(name);
    await expect(page.getByRole('button', { name: /^Remove/ }), 'the other photos stay in place').toHaveCount(3);
    expect(await ownerApi.byName(name), 'nothing partial appears in the inbox').toHaveLength(0);

    drop = false; // the network is back; the same send completes the same request
    await form.submit();
    const reference = await form.confirmedReference();
    recordCreated({ reference, name, note: 'photo 2 upload dropped, then resent' });
    const stored = await ownerApi.byName(name);
    expect(stored, 'exactly one request').toHaveLength(1);
    expect((await ownerApi.get(must(stored[0], 'the request').id)).photo_count, 'all 3 photos stored').toBe(3);
  });

  test('@regression AC-002.6 REV-2 same-token resend after swapping a photo stores the new photo, not the old one', async ({ page, staffApi, run, guard }, testInfo) => {
    // The contract (createQuoteRequest): the same form token with changed answers updates the pending request and clears
    // uploaded photos so they are uploaded again. Here the answer that changes is the photo plan: photo 2's upload drops,
    // the person removes that photo and adds a PNG of a different size, and sends again with the same page and token.
    guard.allowAbort(/\/storage\/v1\/object\/quote-photos\/[^/]+\/photo-2/);
    const ownerApi = await staffApi('owner');
    const name = run.tag('Swap-resend Riley Chen');
    const form = new RequestForm(page);
    await form.open();
    const p1 = await jpeg(page, 'p1.jpg', 300 * 1024, 10);
    const p2 = await jpeg(page, 'p2.jpg', 310 * 1024, 100);
    const p3 = await jpeg(page, 'p3.jpg', 320 * 1024, 200);
    const swap = await png(page, 'swap.png', 400 * 1024, 150);
    await form.fill(validHomeowner(name, { photos: [p1, p2, p3] }));
    let drop = true;
    await page.route(/\/storage\/v1\/object\/quote-photos\/[^/]+\/photo-2/, (route) => (drop ? route.abort('failed') : route.continue()));

    await form.submit(testInfo);
    const oldRow = page.getByRole('listitem').filter({ hasText: 'p2.jpg' });
    await expect(oldRow.getByRole('alert'), 'the error is next to photo 2').toContainText(/couldn.t|could not|failed|try again|didn.t upload/i);
    await expect(page.getByText(REF_RE), 'no reference number yet').toHaveCount(0);

    // Swap photo 2 for a different file, then send again from the same page (the same token).
    drop = false;
    await oldRow.getByRole('button', { name: /^Remove/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'p2.jpg' })).toHaveCount(0);
    await form.attach([swap]);
    await expect(page.getByRole('listitem').filter({ hasText: 'swap.png' }), 'the new photo is listed').toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Remove/ }), 'three photos again').toHaveCount(3);
    await form.submit();
    const reference = await form.confirmedReference();
    recordCreated({ reference, name, note: 'photo 2 dropped, swapped for a PNG, resent with the same token' });

    const stored = await ownerApi.byName(name);
    expect(stored, 'exactly one request').toHaveLength(1);
    const detail = await ownerApi.get(must(stored[0], 'the request').id);
    expect(detail.photo_count, 'three photos stored').toBe(3);
    expect(detail.photos.map((p) => p.content_type).sort(), 'the stored types follow the swapped plan').toEqual(['image/jpeg', 'image/jpeg', 'image/png']);

    // The bytes must be p1, p3 and the swapped PNG; the removed p2 must be gone. Signed URLs go straight to storage
    // (plain fetch: the preview's bypass header must never be sent to another host).
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const stuck: string[] = [];
    const got: string[] = [];
    for (const photo of detail.photos) {
      const res = await fetch(must(photo.url, `signed url of photo ${photo.position}`));
      expect(res.status, `photo ${photo.position} downloads`).toBe(200);
      got.push(sha(Buffer.from(await res.arrayBuffer())));
    }
    for (const [label, file] of [['p1', p1], ['p3', p3], ['swap', swap]] as const) if (!got.includes(sha(file.buffer))) stuck.push(label);
    expect(stuck, 'every wanted photo is stored with its own bytes').toEqual([]);
    expect(got.includes(sha(p2.buffer)), 'the removed photo is not stored').toBe(false);
  });

  test('@regression AC-001.17 a direct call with no offers value, and one with "maybe", are both stored as consent no', async ({ playwright, staffApi, run }, testInfo) => {
    const ownerApi = await staffApi('owner');
    const anon = await newApi(playwright);
    const results: Array<{ label: string; reference: string; request_id: string }> = [];
    for (const [label, extra] of [
      ['missing', {}],
      ['maybe', { marketing_consent: 'maybe' }],
    ] as const) {
      await takeSubmissionSlot(testInfo);
      const name = run.tag(`Consent ${label} Pat Lee`);
      const body = { name, phone: '905-555-0188', email: `pat.${label}@example.com`, address: '5 Main St W, Hamilton ON', problem: 'Direct call test of the offers value', urgency: 'flexible', website: '', ...extra };
      const sent = await submitDirect(anon, body);
      recordCreated({ reference: sent.reference, name, note: `direct call, offers value ${label}` });
      results.push({ label, ...sent });
    }
    await anon.dispose();
    for (const r of results) {
      const detail = await ownerApi.get(r.request_id);
      expect(detail.marketing_consent, `offers value ${r.label} is stored as no`).toBe(false);
      expect(detail.marketing_consent_at, `no consent time for ${r.label}`).toBeNull();
      expect(detail.ghl.copy.state, `${r.label}: nothing is copied without a clear yes`).toBe('not_copied_no_consent');
    }
  });
});
