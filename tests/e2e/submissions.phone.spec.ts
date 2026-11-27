// Tests in which the server accepts requests. Each takes submission slots from the shared budget (5 per 10 minutes
// per network address, support/budget.ts) and no test here retries, so no slot is spent twice.
//   A  AC-001.14 ticked box, AC-001.3 (10 characters accepted), AC-001.5 script text stays text, AC-002.5 no photos,
//      AC-005.3 detail links, AC-001.9 (no GoHighLevel token is set on staging: the request is still confirmed)
//   B  AC-001.7 same phone twice, S0 "Back and resend never merges two requests"
//   C  AC-001.6 double tap, AC-002.3 exact 5 MB limit x3, AC-002.7 confirmation within 20 s on a simulated 4G phone
// (AC-002.6 and AC-001.17 are in late.phone.spec.ts.)  Together with the spine this is exactly 5 accepted requests.
import { test, expect } from './support/fixtures';
import { MAX_PHOTO_BYTES, jpeg, png, webp, padTo } from './support/files';
import { must } from './support/pool';
import { RequestForm, REF_RE, submitAndConfirm, validHomeowner } from './support/ui';
import { recordCreated, takeSubmissionSlot } from './support/budget';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

test.describe('accepted submissions', () => {
  test('@regression AC-001.14 AC-001.3 AC-001.5 AC-002.5 AC-001.9 a ticked request with a 10-character problem, script text in the name and no photos', async ({
    page,
    openStaff,
    run,
  }, testInfo) => {
    const name = run.tag("Zoë O'Brien <script>alert(1)</script>");
    let dialogs = 0;
    page.on('dialog', async (d) => {
      dialogs++;
      await d.dismiss();
    });
    const form = new RequestForm(page);
    await form.open();
    const reference = await submitAndConfirm(form, validHomeowner(name, { problem: '0123456789', tickOffers: true }), testInfo, 'ticked offers, XSS name, no photos');
    expect(reference).toMatch(REF_RE);

    const owner = await openStaff('owner');
    owner.page.on('dialog', async (d) => {
      dialogs++;
      await d.dismiss();
    });
    await owner.page.goto('/requests');
    await expect(owner.page.getByRole('link', { name: REF_RE }).first()).toContainText(reference);
    await expect(owner.page.getByText(name, { exact: false }).first(), 'AC-001.5 the name is drawn as plain text').toBeVisible();

    await owner.page.getByRole('link', { name: reference }).first().click();
    await expect(owner.page.getByRole('heading', { level: 1 })).toContainText('<script>alert(1)</script>');
    await expect(owner.page.locator('main script')).toHaveCount(0);
    await expect(owner.page.getByText('No photos')).toBeVisible(); // AC-002.5, AC-005.6
    await expect(owner.page.locator('a[href^="tel:"]').first(), 'phone is a tap-to-call link').toHaveAttribute('href', /tel:\+?1?\(?905/);
    await expect(owner.page.locator('a[href^="mailto:"]').first(), 'email is an email link').toHaveAttribute('href', 'mailto:dana@example.com');
    await expect(owner.page.getByText('Not copied: no offers consent'), 'ticked request is not shown as unconsented').toHaveCount(0);
    await expect(owner.page.getByText(/Copied to GoHighLevel|Waiting to retry|Copy to GoHighLevel failed/).first(), 'a ticked request shows a copy state').toBeVisible();

    const id = owner.page.url().split('/').pop() as string;
    const stored = await owner.api.get(id);
    expect(stored.marketing_consent, 'AC-001.14 consent yes').toBe(true);
    expect(Math.abs(Date.parse(stored.marketing_consent_at ?? '') - Date.parse(stored.submitted_at)), 'consent time is the time the request was stored (ms)').toBeLessThan(2_000);
    expect(stored.status).toBe('new');
    expect(stored.photo_count).toBe(0);
    expect(stored.problem).toBe('0123456789');
    expect(stored.name, 'stored exactly as typed').toBe(name);
    expect(dialogs, 'no script ran (AC-001.5)').toBe(0);
  });

  test('@regression AC-001.7 S0 Back and resend: the same phone twice makes two requests, never a merge', async ({ page, staffApi, run, guard }, testInfo) => {
    guard.allowStatus(/\/api\/quote-requests/, 409); // the documented 409 form_already_used, if the page meets it
    const ownerApi = await staffApi('owner');
    const a = validHomeowner(run.tag('Back-resend A Alex Morgan'), { phone: '905-555-0177', email: 'alex.a@example.com', address: '11 James St N, Hamilton ON' });
    const b = validHomeowner(run.tag('Back-resend B Alex Morgan'), { phone: '905-555-0177', email: 'alex.b@example.com', address: '22 King St E, Hamilton ON', problem: 'Second request: toilet runs all night long' });

    const form = new RequestForm(page);
    await form.open();
    const refA = await submitAndConfirm(form, a, testInfo, 'back-and-resend A');

    await page.goBack();
    await expect(form.name).toBeVisible();
    // Back renders the form anew with a new token; FR-8 counts 3 s from that render, so the clock starts again here
    // (attempt 3: with the old clock the resend went out under 3 s later and got a 400 the first time).
    form.restartClock();
    await form.fill(b);
    await form.submit(testInfo);
    // S0: two requests with two references, or one 409 then a success with a fresh token; never a merge.
    const outcome = await Promise.race([
      page.waitForURL(/\/request-sent/).then(() => 'sent' as const),
      page.getByText(/We couldn't send your request/).first().waitFor().then(() => 'refused' as const),
    ]);
    if (outcome === 'refused') {
      await expect(form.name, 'values are kept after a refused resend').toHaveValue(b.name);
      await form.submit(testInfo);
    }
    const refB = await form.confirmedReference();
    recordCreated({ reference: refB, name: b.name, note: 'back-and-resend B' });
    expect(refB, 'two different reference numbers').not.toBe(refA);

    const storedA = must((await ownerApi.byName(a.name))[0], 'request A in the list');
    const storedB = must((await ownerApi.byName(b.name))[0], 'request B in the list');
    expect(storedA.reference).toBe(refA);
    expect(storedB.reference).toBe(refB);
    const detailA = await ownerApi.get(storedA.id);
    const detailB = await ownerApi.get(storedB.id);
    expect(detailA.address, "A keeps A's address").toBe(a.address);
    expect(detailA.email, "A keeps A's email").toBe(a.email);
    expect(detailB.address, "B has B's address").toBe(b.address);
    expect(detailB.problem).toBe(b.problem);
    expect(detailA.phone).toBe(detailB.phone);
  });

  test('@regression AC-001.6 AC-002.3 AC-002.7 a double tap on Send makes one request; three 5,242,880-byte photos confirm within 20 s on 4G', async ({
    page,
    staffApi,
    run,
    guard,
  }, testInfo) => {
    test.setTimeout(300_000);
    const ownerApi = await staffApi('owner');
    const name = run.tag('Double-tap Sam Patel');
    const form = new RequestForm(page);
    await form.open();
    const seedJpeg = await jpeg(page, 'seed.jpg', 50 * 1024, 30);
    const seedPng = await png(page, 'seed.png', 50 * 1024, 60);
    const seedWebp = await webp(page, 'seed.webp', 50 * 1024, 90);
    const photos = [
      { name: 'limit-1.jpg', mimeType: 'image/jpeg', buffer: padTo(seedJpeg.buffer, MAX_PHOTO_BYTES) },
      { name: 'limit-2.png', mimeType: 'image/png', buffer: padTo(seedPng.buffer, MAX_PHOTO_BYTES) },
      { name: 'limit-3.webp', mimeType: 'image/webp', buffer: padTo(seedWebp.buffer, MAX_PHOTO_BYTES) },
    ];
    await form.fill(validHomeowner(name, { photos }));
    await expect(page.getByText(/Each photo must be 5 MB or smaller/), 'exactly 5 MB is accepted three times').toHaveCount(0);
    await guard.axe('request-page-three-large-photos');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: (9 * 1000 * 1000) / 8, uploadThroughput: (9 * 1000 * 1000) / 8 });

    await takeSubmissionSlot(testInfo);
    await form.waitForHumanSpeed();
    const tapped = Date.now();
    await form.send.dblclick({ delay: 40 }); // two taps inside one second
    // Wait longer than the AC's 20 s so a slow send is reported as the 20 s failure below, not as a missing page.
    const reference = await form.confirmedReference(60_000);
    const elapsed = Date.now() - tapped;
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    recordCreated({ reference, name, note: 'double tap, 3 x 5,242,880 byte photos' });
    await testInfo.attach('confirm-ms', { body: `${elapsed} ms from the tap to the confirmation (simulated 4G, 15 MB of photos)`, contentType: 'text/plain' });
    console.log(`[qa] AC-002.7 confirm-ms=${elapsed} (4G profile: 9 Mbps, 170 ms, 3 x 5,242,880 bytes)`);
    expect(elapsed, 'AC-002.7 milliseconds from Send to the confirmation').toBeLessThan(20_000);

    const matches = await ownerApi.byName(name);
    expect(matches, 'AC-001.6 exactly one request with this name').toHaveLength(1);
    const only = must(matches[0], 'the double-tap request');
    expect(only.reference).toBe(reference);
    const detail = await ownerApi.get(only.id);
    expect(detail.photo_count, 'all 3 photos are stored with the request').toBe(3);
    expect(detail.photos.map((p) => p.content_type).sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(detail.marketing_consent, 'AC-001.15 untouched box is stored as no').toBe(false);
    expect(detail.marketing_consent_at).toBeNull();
  });

});
