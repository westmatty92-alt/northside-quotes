// The public Request a quote page on a phone: validation, kept values, the offers box, photo rules and the
// page's non-functional promises. None of these tests gets a request accepted, so none uses the submission budget.
// Accepted submissions (and the spine) are in spine.phone.spec.ts and submissions.phone.spec.ts.
// Spam-protection abuse (honeypot filled, too-fast send, 6th send) is QA2's @probe work and is not here.
import { test, expect } from './support/fixtures';
import { MAX_PHOTO_BYTES, fakeJpeg, jpeg, padTo, pdf, png } from './support/files';
import { OFFERS_LABEL, RequestForm, validHomeowner } from './support/ui';

test.use({ storageState: { cookies: [], origins: [] } });

async function openForm(page: import('@playwright/test').Page) {
  const form = new RequestForm(page);
  await form.open();
  return form;
}

test.describe('Request a quote: validation (AC-001.2 to AC-001.4, AC-001.16)', () => {
  test('@regression AC-001.2 empty required fields each show their own message and nothing is sent', async ({ page, guard }) => {
    const form = await openForm(page);
    await form.waitForHumanSpeed();
    await form.send.click();
    await expect(page).toHaveURL(/\/$/);
    for (const [label, field] of [
      ['name', form.name],
      ['phone', form.phone],
      ['email', form.email],
      ['address', form.address],
      ['problem', form.problem],
    ] as const) {
      await expect(field, `${label} is marked invalid`).toHaveAttribute('aria-invalid', 'true');
      await expect(field, `${label} has its message next to it`).toHaveAccessibleDescription(/\S+/);
    }
    await expect(page.getByRole('radiogroup').first(), 'urgency shows its own message').toHaveAccessibleDescription(/\S+/);
    await expect(page.getByText(/^NQ-/), 'no reference number is shown').toHaveCount(0);
    await guard.axe('request-page-errors');
  });

  test('@regression AC-001.3 a problem of 9 or 2,001 characters is refused with the allowed length', async ({ page }) => {
    const form = await openForm(page);
    const data = validHomeowner('QA-E2E validation only');
    await form.fill({ ...data, problem: '123456789' });
    await form.waitForHumanSpeed();
    await form.send.click();
    await expect(form.problem).toHaveAttribute('aria-invalid', 'true');
    await expect(form.problem).toHaveAccessibleDescription(/10.*2,?000/);

    await form.problem.fill('x'.repeat(2001));
    await form.send.click();
    await expect(form.problem).toHaveAttribute('aria-invalid', 'true');
    await expect(form.problem).toHaveAccessibleDescription(/10.*2,?000/);
    await expect(page).toHaveURL(/\/$/);
  });

  test('@regression AC-001.4 phone "12345" and email "dana@" are refused beside their fields; the rest is kept', async ({ page }) => {
    const form = await openForm(page);
    const data = validHomeowner('QA-E2E validation only', { phone: '12345', email: 'dana@' });
    await form.fill(data);
    await form.waitForHumanSpeed();
    await form.send.click();
    await expect(form.phone).toHaveAttribute('aria-invalid', 'true');
    await expect(form.email).toHaveAttribute('aria-invalid', 'true');
    await expect(form.phone).toHaveAccessibleDescription(/\S+/);
    await expect(form.email).toHaveAccessibleDescription(/\S+/);
    await expect(form.name).toHaveValue(data.name);
    await expect(form.address).toHaveValue(data.address);
    await expect(form.problem).toHaveValue(data.problem);
    await expect(form.urgency('soon')).toBeChecked();
    await expect(page).toHaveURL(/\/$/);
  });

  test('@regression AC-001.16 a ticked offers box stays ticked, with every entry, when another field is refused', async ({ page }) => {
    const form = await openForm(page);
    const data = validHomeowner('QA-E2E validation only', { email: '', tickOffers: true });
    await form.fill(data);
    await expect(form.offers).toBeChecked();
    await form.waitForHumanSpeed();
    await form.send.click();
    await expect(form.email).toHaveAttribute('aria-invalid', 'true');
    await expect(form.email).toHaveAccessibleDescription(/\S+/);
    await expect(form.offers, 'the offers box is still ticked').toBeChecked();
    await expect(form.name).toHaveValue(data.name);
    await expect(form.phone).toHaveValue(data.phone);
    await expect(form.address).toHaveValue(data.address);
    await expect(form.problem).toHaveValue(data.problem);
  });
});

test.describe('Request a quote: a send that fails (AC-001.8)', () => {
  test('@regression AC-001.8 when the send fails: "We couldn\'t send your request. Please try again.", every entry and photo kept, no reference number', async ({
    page,
    guard,
  }) => {
    // The failure is answered at the network edge with the contract's 503 service_unavailable body (the staging database is not taken down).
    // "Nothing partial appears in the inbox" is a server rule that this black-box test cannot see: it is the backend's (tests/api).
    guard.allowStatus(/\/api\/quote-requests$/, 503);
    const form = await openForm(page);
    const data = validHomeowner('QA-E2E validation only', { tickOffers: true, photos: [await jpeg(page, 'kept-1.jpg', 100 * 1024)] });
    await form.fill(data);
    await page.route(/\/api\/quote-requests$/, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'about:blank', title: "We couldn't send your request. Please try again.", status: 503, code: 'service_unavailable' }),
      }),
    );
    await form.waitForHumanSpeed();
    await form.send.click();
    await expect(page.getByText("We couldn't send your request. Please try again.").first()).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(/NQ-[A-Z2-9]{6}/), 'no reference number').toHaveCount(0);
    await expect(form.name).toHaveValue(data.name);
    await expect(form.phone).toHaveValue(data.phone);
    await expect(form.email).toHaveValue(data.email);
    await expect(form.address).toHaveValue(data.address);
    await expect(form.problem).toHaveValue(data.problem);
    await expect(form.urgency('soon')).toBeChecked();
    await expect(form.offers, 'the ticked offers box is kept').toBeChecked();
    await expect(page.getByRole('button', { name: /^Remove/ }), 'the photo is kept').toHaveCount(1);
  });
});

test.describe('Request a quote: the offers box and the page (AC-001.15, AC-001.18, FR-1)', () => {
  test('@regression AC-001.15 AC-001.18 the offers box has its label, is unticked on every load, and Space ticks and unticks it', async ({ page, guard }) => {
    const form = await openForm(page);
    await expect(page.getByText(OFFERS_LABEL, { exact: true })).toBeVisible();
    await expect(form.offers).not.toBeChecked();
    expect(await form.offers.getAttribute('required'), 'the box is not required').toBeNull();
    expect(await form.offers.getAttribute('aria-required'), 'the box is not marked required').not.toBe('true');
    await form.offers.focus();
    await page.keyboard.press('Space');
    await expect(form.offers).toBeChecked();
    await page.keyboard.press('Space');
    await expect(form.offers).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(form.offers).toBeChecked();
    await page.reload();
    await expect(form.offers, 'unticked again after a reload: never remembered, never autofilled').not.toBeChecked();
    await guard.axe('request-page-offers');
  });

  test('@regression FR-1 the data-use line and the six labelled fields are on the page, with no urgency preselected', async ({ page }) => {
    const form = await openForm(page);
    await expect(page.getByText('Northside will use these details to reply to your quote request. It will email you offers only if you tick the box.')).toBeVisible();
    for (const label of ['Your name', 'Phone number', 'Email', 'Address of the job', "What's the problem?"]) {
      await expect(page.getByLabel(label, { exact: true }).first()).toBeVisible();
    }
    for (const which of ['emergency', 'soon', 'flexible'] as const) await expect(form.urgency(which)).not.toBeChecked();
    await expect(page.getByRole('link', { name: 'Staff sign-in' }), 'the footer link is the way to sign-in').toBeVisible();
  });

  test('@regression AC-001.11 keyboard-only: focus follows the visual order and the hidden spam field is never reached', async ({ page }) => {
    const form = await openForm(page);
    await form.name.focus();
    const seen: string[] = [];
    for (let i = 0; i < 16; i++) {
      seen.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return '(none)';
          const label = (el as HTMLInputElement).labels?.[0]?.textContent ?? el.getAttribute('aria-label') ?? el.textContent ?? el.tagName;
          return `${label.trim().replace(/\s+/g, ' ')}${el.getAttribute('name') === 'website' ? ' [HONEYPOT]' : ''}`;
        }),
      );
      await page.keyboard.press('Tab');
    }
    expect(seen.join(' | '), 'the honeypot is skipped by Tab').not.toContain('[HONEYPOT]');
    const order = [/Your name/, /Phone number/, /^Email$/, /Address of the job/, /What's the problem\?/, /Emergency|Soon|Flexible/, /Email me offers/, /Send request/];
    let from = 0;
    for (const expected of order) {
      const at = seen.findIndex((s, i) => i >= from && expected.test(s));
      expect(at, `"${expected}" is reached in order; saw: ${seen.join(' | ')}`).toBeGreaterThanOrEqual(0);
      from = at;
    }
  });

  test('@regression AC-003.2 (page side) the spam field is out of sight, out of the tab order and hidden from assistive technology', async ({ page }) => {
    await openForm(page);
    const trap = page.locator('input[name="website"]');
    await expect(trap).toHaveCount(1);
    await expect(trap).toHaveAttribute('tabindex', '-1');
    await expect(trap).toHaveAttribute('autocomplete', /off|new-password|nope/);
    const hidden = await trap.evaluate((el) => !!el.closest('[aria-hidden="true"]') || el.getAttribute('aria-hidden') === 'true');
    expect(hidden, 'the honeypot is aria-hidden').toBe(true);
    await expect(trap).toHaveValue('');
  });

  test('@regression AC-001.10 the form is visible and usable within 3 s on a simulated 4G phone (9 Mbps down and up, 170 ms round trip)', async ({ page }, testInfo) => {
    // The PRD says "simulated 4G" without numbers; this is the WebPageTest "4G" profile (stated in docs/test-plan.md, spec question SQ-2).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: (9 * 1000 * 1000) / 8, uploadThroughput: (9 * 1000 * 1000) / 8 });
    const started = Date.now();
    await page.goto('/', { waitUntil: 'commit' });
    await form_ready(page);
    const elapsed = Date.now() - started;
    await testInfo.attach('load-ms', { body: `${elapsed} ms to a usable form (throttled)`, contentType: 'text/plain' });
    expect(elapsed, 'milliseconds until the form is visible and enabled').toBeLessThan(3_000);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  });
});

async function form_ready(page: import('@playwright/test').Page) {
  const form = new RequestForm(page);
  await expect(form.name).toBeVisible({ timeout: 3_000 });
  await expect(form.name).toBeEnabled({ timeout: 3_000 });
}

test.describe('Request a quote: photo rules (AC-002.2 to AC-002.4)', () => {
  test('@regression AC-002.2 a 4th photo is not added and the page says "You can add up to 3 photos"', async ({ page }) => {
    const form = await openForm(page);
    const photos = [await jpeg(page, 'one.jpg', 100 * 1024), await png(page, 'two.png'), await jpeg(page, 'three.jpg', 100 * 1024, 40)];
    await form.attach(photos);
    await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(3);
    await expect(page.getByText('You can add up to 3 photos').first()).toBeVisible();
    await form.attach([await jpeg(page, 'four.jpg', 100 * 1024, 90)]).catch(() => undefined); // the picker may be disabled once full
    await expect(page.getByRole('button', { name: /^Remove/ }), 'still 3 photos').toHaveCount(3);
    await expect(page.getByText('four.jpg')).toHaveCount(0);
  });

  test('@regression AC-002.3 a photo of 5,242,881 bytes is refused next to it; 5,242,880 bytes is accepted; other entries are kept', async ({ page }) => {
    const form = await openForm(page);
    const data = validHomeowner('QA-E2E validation only');
    await form.fill(data);
    const base = await jpeg(page, 'seed.jpg', 100 * 1024);
    await form.attach([{ name: 'exactly-5mb.jpg', mimeType: 'image/jpeg', buffer: padTo(base.buffer, MAX_PHOTO_BYTES) }]);
    await expect(page.getByText('exactly-5mb.jpg').first()).toBeVisible();
    await expect(page.getByText('Each photo must be 5 MB or smaller'), 'exactly 5 MB is allowed').toHaveCount(0);
    await form.attach([{ name: 'one-byte-over.jpg', mimeType: 'image/jpeg', buffer: padTo(base.buffer, MAX_PHOTO_BYTES + 1) }]);
    await expect(page.getByText('Each photo must be 5 MB or smaller').first()).toBeVisible();
    await expect(form.name).toHaveValue(data.name);
    await expect(form.problem).toHaveValue(data.problem);
    await expect(page.getByText('exactly-5mb.jpg').first(), 'the good photo is kept').toBeVisible();
  });

  test('@regression AC-002.4 a PDF and a text file renamed leak.jpg are refused with "Photos must be JPEG, PNG or WebP"', async ({ page }) => {
    const form = await openForm(page);
    await form.attach([pdf('quote.pdf')]);
    await expect(page.getByText('Photos must be JPEG, PNG or WebP').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Remove photo quote\.pdf|^Remove quote\.pdf/ }), 'the PDF is not kept').toHaveCount(0);
    await form.attach([fakeJpeg('leak.jpg')]);
    await expect(page.getByText('Photos must be JPEG, PNG or WebP').first(), 'a renamed text file is caught by its content').toBeVisible();
    await expect(page.getByRole('button', { name: /^Remove photo leak\.jpg|^Remove leak\.jpg/ }), 'the renamed text file is not kept').toHaveCount(0);
  });
});
