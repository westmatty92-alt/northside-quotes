// Request detail (SCR-06) and the photo viewer (SCR-08): price and note, the stale-version 409, failure messages,
// the "Not copied: no offers consent" state, last updated, and the full-size photo dialog.
// Live GoHighLevel behaviour (copied, waiting, failed, stage tags) is NOT covered here: GHL_LOCATION_ID and the token
// are unset on staging, so it is covered offline by the INT1/INT2 simulator tests and is "unverified" live.
import { test, expect, renewSession } from './support/fixtures';
import { describe } from './support/api';
import { statePath } from './support/env';
import { pathIs } from './support/paths';
import { clearQuote, pick, pickAt } from './support/pool';
import { REF_RE, photoThumb, photoThumbs } from './support/ui';
import type { Page } from '@playwright/test';

test.use({ storageState: statePath('owner') });

const saveButton = (page: Page) => page.getByRole('button', { name: /Save price and note|Try saving again/ });
const price = (page: Page) => page.getByLabel(/^Price/);
const note = (page: Page) => page.getByLabel(/^Note/);
const PRICE_MESSAGE = 'Enter an amount from 0.01 to 99,999.99 with at most 2 decimals';
const SAVE_FAILED = "Couldn't save. Try again.";
const CHANGED = 'This request was changed by someone else. Reload to see the latest.';

test.describe('price and note (US-006)', () => {
  test('@regression AC-006.3 price 0 and 100000.00 and 450.555 are refused; 0.01 and 99999.99 are stored exactly as typed', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await clearQuote(api, request.id);
    await page.goto(`/requests/${request.id}`);

    for (const refused of ['0', '100000.00', '450.555']) {
      await price(page).fill(refused);
      await saveButton(page).click();
      await expect(page.getByText(PRICE_MESSAGE).first(), `${refused} is refused with the allowed range`).toBeVisible();
      await expect(price(page), 'what she typed stays').toHaveValue(refused);
      expect((await api.get(request.id)).price_cents, `${refused} stored nothing`).toBeNull();
    }
    for (const [typed, cents] of [['0.01', 1], ['99999.99', 9_999_999]] as const) {
      await price(page).fill(typed);
      await saveButton(page).click();
      await expect(page.getByText(/Saved\./).first()).toBeVisible();
      expect((await api.get(request.id)).price_cents, `${typed} is stored to the cent`).toBe(cents);
    }
  });

  test('@regression AC-006.2 AC-006.6 a note with no price is stored; a new price replaces the old one and the old one is shown nowhere', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await clearQuote(api, request.id);
    await page.goto(`/requests/${request.id}`);
    await note(page).fill('Note only, no price yet');
    await saveButton(page).click();
    await expect(page.getByText(/Saved\./).first()).toBeVisible();
    const noteOnly = await api.get(request.id);
    expect(noteOnly.price_cents, 'the price stays empty').toBeNull();
    expect(noteOnly.note).toBe('Note only, no price yet');

    await price(page).fill('450.00');
    await saveButton(page).click();
    await expect(page.getByText(/Saved\./).first()).toBeVisible();
    await price(page).fill('475.00');
    await saveButton(page).click();
    await expect(page.getByRole('form', { name: 'Your quote' })).toContainText(/\$\s*475\.00\s*CAD/);
    await expect(page.locator('main'), 'the previous price is shown nowhere').not.toContainText('450.00');
    expect((await api.get(request.id)).price_cents).toBe(47_500);
  });

  test('@regression AC-006.4 a note of 1,001 characters is refused with the limit and the text stays', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await clearQuote(api, request.id);
    await page.goto(`/requests/${request.id}`);
    const long = 'n'.repeat(1001);
    await note(page).fill(long);
    await saveButton(page).click();
    await expect(page.getByText(/Notes can be up to 1,000 characters/).first()).toBeVisible();
    await expect(note(page)).toHaveValue(long);
    expect((await api.get(request.id)).note, 'nothing stored').toBeNull();
    await note(page).fill('n'.repeat(1000));
    await saveButton(page).click();
    await expect(page.getByText(/Saved\./).first(), '1,000 characters is accepted').toBeVisible();
  });

  test('@regression AC-006.5 the stale-version 409: the helper saves first, the owner is told to reload and nothing is overwritten', async ({
    page,
    openStaff,
    staffApi,
    guard,
  }) => {
    guard.allowStatus(/\/api\/quote-requests\/[0-9a-f-]{36}\/quote$/, 409);
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await clearQuote(api, request.id);

    await page.goto(`/requests/${request.id}`); // the owner opens it first
    await expect(price(page)).toBeVisible();
    const helper = await openStaff('helper'); // then the helper opens it, and saves a price
    await helper.page.goto(`/requests/${request.id}`);
    await price(helper.page).fill('111.11');
    await saveButton(helper.page).click();
    await expect(helper.page.getByText(/Saved\./).first()).toBeVisible();

    await note(page).fill('The owner note that must not win');
    await saveButton(page).click(); // the owner still holds the old version
    await expect(page.getByText(CHANGED).first()).toBeVisible();
    const stored = await api.get(request.id);
    expect(stored.price_cents, "the helper's price is not overwritten").toBe(11_111);
    expect(stored.note, "the owner's stale note was not stored").not.toBe('The owner note that must not win');
    await expect(page.getByRole('button', { name: 'Reload' }), 'a Reload button is offered').toBeVisible();
  });

  test('@regression AC-006.7 when the network drops during a save: "Couldn\'t save. Try again.", values stay, nothing stored', async ({ page, staffApi, guard }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await clearQuote(api, request.id);
    guard.allowAbort(/\/quote$/);
    await page.goto(`/requests/${request.id}`);
    await page.route(/\/quote$/, (route) => route.abort('failed'));
    await price(page).fill('300.00');
    await note(page).fill('Typed while the network is down');
    await saveButton(page).click();
    await expect(page.getByText(SAVE_FAILED).first()).toBeVisible();
    await expect(price(page)).toHaveValue('300.00');
    await expect(note(page)).toHaveValue('Typed while the network is down');
    const stored = await api.get(request.id);
    expect(stored.price_cents).toBeNull();
    expect(stored.note).toBeNull();
    await expect(page.getByRole('button', { name: 'Try saving again' })).toBeVisible();
  });

  test('@regression AC-006.1 AC-015.1 a saved price and note survive a reload and "Last updated by Owner" is shown', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await clearQuote(api, request.id);
    await page.goto(`/requests/${request.id}`);
    await price(page).fill('450.00');
    await note(page).fill('Replace cartridge, 2 hours, can come Thursday');
    await saveButton(page).click();
    await expect(page.getByText(/Saved\./).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('form', { name: 'Your quote' })).toContainText(/\$\s*450\.00\s*CAD/);
    await expect(note(page)).toHaveValue('Replace cartridge, 2 hours, can come Thursday');
    await expect(page.getByText(/Last updated by Owner at/)).toBeVisible();
  });

  test('@regression AC-015.2 a request nobody has changed says "Not updated yet"', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const untouched = await pick(api, (d) => d.last_updated === null, 'one nobody has changed yet');
    await page.goto(`/requests/${untouched.id}`);
    await expect(page.getByText('Not updated yet')).toBeVisible();
  });
});

test.describe('the detail screen (US-005, US-007, US-010)', () => {
  test('@regression AC-005.3 AC-016.5 every submitted field, tap-to-call and email links, and the photos', async ({ page, staffApi, guard }) => {
    const api = await staffApi('owner');
    const request = await pick(api, (d) => d.photo_count === 3, 'one with 3 photos');
    await page.goto(`/requests/${request.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(request.name);
    await expect(page.locator('main')).toContainText(request.reference);
    await expect(page.locator('main')).toContainText(request.address);
    await expect(page.locator('main')).toContainText(request.problem);
    await expect(page.locator('main')).toContainText(/Emergency|Soon|Flexible/i);
    await expect(page.locator('a[href^="tel:"]').first()).toBeVisible();
    await expect(page.locator('a[href^="mailto:"]').first()).toHaveAttribute('href', `mailto:${request.email}`);
    await expect(photoThumbs(page, 3)).toHaveCount(3);
    await guard.axe('request-detail-with-photos');
  });

  test('@regression design wording: each photo button is named "Open photo N of 3 at full size" (design-specs, PhotoThumb and Screen readers)', async ({
    page,
    staffApi,
  }) => {
    const api = await staffApi('owner');
    const request = await pick(api, (d) => d.photo_count === 3, 'one with 3 photos');
    await page.goto(`/requests/${request.id}`);
    await expect(page.getByRole('button', { name: /^Open photo \d of 3 at full size$/ })).toHaveCount(3);
  });

  test('@regression AC-005.7 when photo storage cannot be reached each photo slot says "Photo unavailable" and the rest of the request is shown', async ({
    page,
    staffApi,
    guard,
  }, testInfo) => {
    // Simulated at the network edge: every request for the stored photo files fails. The server-side case (a URL that could not be signed) is the API's `url: null`.
    guard.allowAbort(/\/storage\/v1\/object\//);
    const api = await staffApi('owner');
    const request = await pick(api, (d) => d.photo_count === 3, 'one with 3 photos');
    await page.route(/\/storage\/v1\/object\//, (route) => route.abort('failed'));
    await page.goto(`/requests/${request.id}`);
    await expect(page.getByRole('region', { name: /^Photos/ })).toBeVisible();
    // Evidence for the ticket: the photo region's structure with every URL and token removed.
    const structure = await page.getByRole('region', { name: /^Photos/ }).evaluate((el) =>
      el.innerHTML.replace(/(src|srcset|href)="[^"]*"/g, '$1="<removed>"').replace(/\s+class="[^"]*"/g, ''),
    );
    await testInfo.attach('photo-region-structure', { body: structure, contentType: 'text/html' });
    await expect(page.getByText('Photo unavailable')).toHaveCount(3);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(request.name);
    await expect(page.locator('main')).toContainText(request.problem);
  });

  test('@regression AC-007.4 choosing the status a request already has changes nothing and stores no new change time', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'quoted', () => true, 'available');
    const before = await api.get(request.id);
    await page.goto(`/requests/${request.id}`);
    await page.getByRole('radio', { name: 'Quoted', exact: true }).or(page.getByRole('button', { name: 'Quoted', exact: true })).click();
    await page.waitForLoadState('networkidle'); // let any (wrongly) triggered save finish before reading the stored state
    const after = await api.get(request.id);
    expect(after.status).toBe('quoted');
    expect(after.status_changed_at, 'no new change time').toBe(before.status_changed_at);
    expect(after.version, 'no new version').toBe(before.version);
  });

  test('@regression AC-010.6 AC-017.16 AC-014.4 an unticked request shows "Not copied: no offers consent" with no Retry and no stage-tag line, in any status', async ({
    page,
    staffApi,
  }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', (d) => d.marketing_consent === false, 'one whose offers box was unticked');
    await page.goto(`/requests/${request.id}`);
    await expect(page.getByText('Not copied: no offers consent')).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry/ })).toHaveCount(0);
    await expect(page.getByText(/Stage tag/)).toHaveCount(0);

    await page.getByRole('radio', { name: 'Won', exact: true }).or(page.getByRole('button', { name: 'Won', exact: true })).click();
    await expect.poll(async () => (await api.get(request.id)).status).toBe('won');
    await expect(page.getByText('Not copied: no offers consent'), 'still the same after a status change').toBeVisible();
    await expect(page.getByText(/Stage tag/), 'no stage-tag line appears').toHaveCount(0);
    await expect(page.getByRole('button', { name: /Retry/ })).toHaveCount(0);

    const detail = await api.get(request.id);
    expect(detail.ghl.copy.state).toBe('not_copied_no_consent');
    expect(detail.ghl.stage_tag).toBeNull();
  });

  test('@regression AC-014.4 a retry asked for directly on an unticked request is refused with 409 not_retryable', async ({ staffApi }) => {
    const api = await staffApi('owner');
    const request = await pick(api, (d) => d.marketing_consent === false, 'one whose offers box was unticked');
    const res = await api.request.post(`/api/quote-requests/${request.id}/ghl-copy-retries`);
    expect(res.status(), await describe(res)).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('not_retryable');
    expect((await api.get(request.id)).ghl.copy.state, 'nothing was created').toBe('not_copied_no_consent');
  });

  test('@regression AC-002.8 (signed side) the photo links the owner is given open without any other credential and are images', async ({ staffApi, playwright }) => {
    const api = await staffApi('owner');
    const request = await pick(api, (d) => d.photo_count >= 1, 'one with a photo');
    const listed = await api.request.get(`/api/quote-requests/${request.id}/photos`);
    expect(listed.status(), await describe(listed)).toBe(200);
    const body = (await listed.json()) as { data: Array<{ url: string | null; content_type: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    const plain = await playwright.request.newContext(); // no cookies, no bearer, no bypass header
    for (const photo of body.data) {
      expect(photo.url, 'a signed URL, not "Photo unavailable"').not.toBeNull();
      const res = await plain.get(photo.url as string);
      expect(res.status(), `photo ${photo.content_type}`).toBe(200);
      expect(res.headers()['content-type'] ?? '').toMatch(/^image\//);
    }
    await plain.dispose();
  });
});

test.describe('photo viewer (US-012, SCR-08)', () => {
  test('@regression AC-012.1 AC-012.2 the second thumbnail opens full size, arrows move on, Escape closes and focus goes back to the thumbnail', async ({
    page,
    staffApi,
    guard,
  }) => {
    const api = await staffApi('owner');
    const request = await pick(api, (d) => d.photo_count === 3, 'one with 3 photos');
    await page.goto(`/requests/${request.id}`);
    const thumbs = photoThumbs(page, 3);
    const second = thumbs.nth(1);
    await second.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await second.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Photo 2 of 3')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' }), 'focus moves to Close on open').toBeFocused();
    await expect(dialog.getByRole('img').first(), 'the photo loads').toBeVisible();
    expect(await dialog.getByRole('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth), 'the photo has decoded').toBeGreaterThan(0);
    await guard.axe('photo-viewer');

    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('Photo 3 of 3')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Next photo' }), 'no wrap-around: Next is paused on the last photo').toBeDisabled();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByText('Photo 1 of 3')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Previous photo' }), 'Previous is paused on the first photo').toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(request.name);
    await expect(second, 'focus returns to the thumbnail that opened the viewer').toBeFocused();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore), 'same scroll position').toBeLessThanOrEqual(2);
  });

  // Split out of the test above in attempt 3: the trap check failed first and stopped that test before its Escape,
  // focus-return and scroll-position checks ran. Same assertion as before, now on its own.
  test('@regression design: focus is trapped inside the open photo viewer (design-specs SCR-08 "Keyboard path")', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pick(api, (d) => d.photo_count === 3, 'one with 3 photos');
    await page.goto(`/requests/${request.id}`);
    await photoThumb(page, 2, 3).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' }), 'focus moves to Close on open').toBeFocused();
    const focusedNow = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return 'nothing';
        const label = el.getAttribute('aria-label') ?? (el.tagName === 'BODY' ? '(page body)' : (el.textContent?.trim().slice(0, 40) ?? ''));
        return `<${el.tagName.toLowerCase()}> "${label}" inside dialog: ${!!el.closest('dialog, [role="dialog"]')}`;
      });
    const trail: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      trail.push(`Tab ${i + 1}: ${await focusedNow()}`);
      expect(await dialog.locator(':focus').count(), `Tab ${i + 1} keeps focus inside the dialog. Focus trail: ${trail.join(' | ')}`).toBe(1);
    }
  });

  test('@regression AC-012.2 the Close button closes the viewer and focus goes back to the thumbnail that opened it', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pick(api, (d) => d.photo_count >= 2, 'one with at least 2 photos');
    await page.goto(`/requests/${request.id}`);
    const thumb = photoThumb(page, 2);
    await thumb.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(thumb, 'focus returns to the thumbnail').toBeFocused();
  });
});

// A session that ended while saving (AC-004.7). The browser's session is answered with the contract's 401
// session_expired; the app then signs the user out, which revokes the saved owner session, so sign in again afterwards.
test.describe('session ended', () => {
  test.afterEach(async ({ browser }, testInfo) => {
    await renewSession(browser, 'owner', testInfo.project.use as Record<string, unknown>);
  });

  test('@regression AC-004.7 an expired session on save stores nothing and sends the owner to sign-in', async ({ page, staffApi, guard }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await clearQuote(api, request.id);
    guard.allowStatus(/\/quote$/, 401);
    await page.goto(`/requests/${request.id}`);
    await page.route(/\/quote$/, (route) =>
      route.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Your session ended.', status: 401, code: 'session_expired' }) }),
    );
    await note(page).fill('Typed after the session ended');
    await saveButton(page).click();
    await expect(page).toHaveURL(pathIs('/sign-in'));
    await expect(page.getByText(/Your session ended/)).toBeVisible();
    const helperApi = await staffApi('helper'); // the owner's own session was just ended; the helper reads the stored request
    expect((await helperApi.get(request.id)).note, 'nothing was saved').toBeNull();
  });
});

test('@regression FR-2 every reference in the list is NQ- plus 6 characters from A-Z and 2-9 without I, L and O', async ({ staffApi }) => {
  const api = await staffApi('owner');
  const page = await api.list({ limit: 20 });
  for (const r of page.data) expect(r.reference).toMatch(new RegExp(`^${REF_RE.source}$`));
});
