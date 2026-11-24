// The last submitting tests. They run in the last project ("phone-late") so that, by the time they need their 3
// submission slots, the 10-minute window of the earlier submissions has aged out and nothing has to wait.
//   E  AC-002.6 the network drops while photo 2 uploads
//   D  AC-001.17 a direct call with no offers value, and with "maybe", is stored as no
import { test, expect } from './support/fixtures';
import { newApi, submitDirect } from './support/api';
import { jpeg } from './support/files';
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
