// STEP FE2V re-run: extra evidence for the designer's DV1 review at 1280 px (project desktop, 1280 x 800, plus one
// 1280 x 720 capture). Screenshots and axe only, written to docs/qa-reports/visual/DV1/. No check here is about how a
// screen looks; the tests make sure the screen is loaded before it is photographed, and that the Saving capture put
// the request back exactly as it was.
//
// Writes to staging: none, except SCR-02 (one real submission, once per commit; see the test).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../support/fixtures';
import { statePath } from '../support/env';
import { jpeg } from '../support/files';
import type { Status } from '../support/api';
import { REF_RE, RequestForm, boardMap, card, moveButton, moveTo, photoThumb, photoThumbs, submitAndConfirm, validHomeowner, weeklyStrip } from '../support/ui';
import { Capture, DV1_DIR, EXPECTED_SHA, requestWithThreePhotos, viewerLayout } from './dv1';

const SAVE_FAILED = "Couldn't save. Try again.";

test.describe('DV1 evidence at 1280 px, signed in as the owner', () => {
  test.use({ storageState: statePath('owner') });

  test('@regression FE2V DV1 SCR-05 Pipeline at 1280 px, viewport-sized capture', async ({ page }, testInfo) => {
    const cap = new Capture(page, testInfo, 'SCR-05-pipeline');
    await page.goto('/pipeline');
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
    await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();
    await expect(page.getByRole('link', { name: REF_RE }).first(), 'the board shows cards').toBeVisible();
    await expect(weeklyStrip(page)).toBeVisible();
    await expect(page.getByText('Count unavailable')).toHaveCount(0);
    await cap.settled();
    await cap.viewportShot();
    await cap.finish();
  });

  test('@regression FE2V DV1 SCR-04 Requests at 1280 px, viewport-sized capture', async ({ page }, testInfo) => {
    const cap = new Capture(page, testInfo, 'SCR-04-requests');
    await page.goto('/requests');
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
    await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible();
    await expect(page.getByRole('link', { name: REF_RE }).first(), 'the list shows requests').toBeVisible();
    await expect(weeklyStrip(page)).toBeVisible();
    await cap.settled();
    await cap.viewportShot();
    await cap.finish();
  });

  test('@regression FE2V DV1 SCR-05 the Move to button in its Saving state at 1280 px, with its height', async ({ page, staffApi, guard }, testInfo) => {
    // The save is held (never sent on), then dropped, so the card stays in its Saving state long enough to be
    // photographed and measured, and nothing is stored: the same technique as AC-016.13.
    guard.allowAbort(/\/status-changes$/);
    const api = await staffApi('owner');
    const cap = new Capture(page, testInfo, 'SCR-05-move-to-saving', [/\/status-changes$/]);
    await page.goto('/pipeline');
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
    await expect(page.getByRole('link', { name: REF_RE }).first()).toBeVisible();
    const map = await boardMap(page);
    const from = (['New', 'Quoted'] as const).find((c) => map[c].length > 0);
    if (!from) throw new Error('the New and Quoted columns are both empty on staging, so there is no card to move');
    const reference = map[from][0] as string;
    const fromStatus: Status = from === 'New' ? 'new' : 'quoted';
    const toStatus: Status = from === 'New' ? 'quoted' : 'new';
    const before = (await api.list({ status: fromStatus, limit: 50 })).data.find((r) => r.reference === reference);
    if (!before) throw new Error(`${reference} is not in the first 50 ${fromStatus} requests of the API`);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/status-changes$/, async (route) => {
      await gate;
      await route.abort('failed');
    });

    const button = moveButton(page, reference);
    await button.scrollIntoViewIfNeeded();
    const measure = (locator: typeof button) =>
      locator.evaluate((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          height_px: Math.round(r.height * 100) / 100,
          width_px: Math.round(r.width * 100) / 100,
          css_min_height: cs.minHeight,
          css_height: cs.height,
          border_style: cs.borderTopStyle,
          disabled: (el as HTMLButtonElement).disabled,
          aria_disabled: el.getAttribute('aria-disabled'),
          aria_busy: el.getAttribute('aria-busy'),
        };
      });
    const normal = await measure(button);

    await moveTo(page, reference, toStatus);
    // The card says "Saving" and its Move to button is paused. design-specs MoveToMenu also says the button's
    // accessible name gains ", saving"; whether it does is recorded below (accessible_name), not asserted here.
    await expect(card(page, reference).getByText('Saving')).toBeVisible();
    const saving = moveButton(page, reference); // matches the name with or without ", saving"
    await expect(saving).toBeVisible();
    await saving.scrollIntoViewIfNeeded();
    const measured = await measure(saving);
    const accessibleName = await saving.evaluate((el) => el.getAttribute('aria-label') ?? el.textContent ?? '');
    await cap.settled();
    await cap.viewportShot();
    await cap.elementShot(card(page, reference), '-card');
    await cap.finish({
      reference,
      moved_from: fromStatus,
      moved_to_requested: toStatus,
      move_to_normal: normal,
      move_to_saving: measured,
      move_to_saving_accessible_name: accessibleName,
      accessible_name_says_saving: /, saving$/.test(accessibleName),
      saving_height_at_least_44px: measured.height_px >= 44,
      saving_css_min_height_at_least_44px: parseFloat(measured.css_min_height) >= 44,
    });

    release();
    await expect(page.getByText(SAVE_FAILED).first(), 'the held save was dropped, so the card returns').toBeVisible();
    expect((await api.get(before.id)).status, 'nothing was stored: the request keeps its status').toBe(fromStatus);
  });

  for (const height of [800, 720]) {
    test(`@regression FE2V DV1 SCR-08 photo viewer at 1280 x ${height}`, async ({ page, staffApi }, testInfo) => {
      const api = await staffApi('owner');
      const request = await requestWithThreePhotos(api);
      const cap = new Capture(page, testInfo, 'SCR-08-photo-viewer');
      await page.setViewportSize({ width: 1280, height });
      await page.goto(`/requests/${request.id}`);
      await expect(photoThumbs(page, 3)).toHaveCount(3);
      await expect.poll(() => page.evaluate(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0)), { message: 'thumbnails decoded' }).toBe(true);
      const thumb = photoThumb(page, 2, 3);
      await thumb.scrollIntoViewIfNeeded();
      await thumb.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Photo 2 of 3')).toBeVisible();
      const photo = dialog.getByRole('img').first();
      await expect(photo).toBeVisible();
      await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth), { message: 'the photo decoded' }).toBeGreaterThan(0);
      await cap.settled();
      const { layout, covered } = await viewerLayout(dialog, photo, request.reference);
      await cap.viewportShot();
      await cap.finish({ layout, covered, photo_covers_nothing: covered.length === 0 });
    });
  }
});

test.describe('DV1 evidence at 1280 px, signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@regression FE2V DV1 SCR-01 Request a quote at 1280 px', async ({ page }, testInfo) => {
    const cap = new Capture(page, testInfo, 'SCR-01-request-form');
    const res = await page.goto('/');
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
    expect(res?.status(), 'GET / answers 200').toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Request a quote' })).toBeVisible();
    await cap.settled();
    await cap.viewportShot();
    await cap.fullShot();
    await cap.finish({ http_status: res?.status() });
  });

  // SCR-02 shows its reference number once and has no lookup (NG-3), so an existing request's confirmation cannot be
  // opened again. One request is submitted, then the same page is photographed at 1280 and at 390 (the window is
  // narrowed; this is a desktop browser window at 390 px wide, not a phone, so no touch and one pixel per CSS pixel).
  // To keep the suite from adding a request to staging on every run, it submits only when this commit has no capture
  // yet. QA_DV1_RECAPTURE=1 forces a new one.
  test.describe('SCR-02', () => {
    test.describe.configure({ retries: 0 }); // a retry would spend more of the 5-per-10-minutes submission budget
    const done = path.join(DV1_DIR, 'SCR-02-confirmation-1280x800.json');
    const captured = (): boolean => {
      try {
        return (JSON.parse(fs.readFileSync(done, 'utf8')) as { commit_prefix?: string }).commit_prefix === EXPECTED_SHA;
      } catch {
        return false;
      }
    };

    test('@regression FE2V DV1 SCR-02 Request sent at 1280 px and at 390 px (one submission per commit)', async ({ page, run }, testInfo) => {
      test.skip(captured() && process.env.QA_DV1_RECAPTURE !== '1', `SCR-02 was already captured for ${EXPECTED_SHA} (docs/qa-reports/visual/DV1/SCR-02-confirmation-*); set QA_DV1_RECAPTURE=1 to submit again`);
      testInfo.setTimeout(120_000);
      const form = new RequestForm(page);
      await form.open();
      const photo = await jpeg(page, 'under-sink-1.jpg', 200 * 1024, 200);
      const homeowner = validHomeowner(`Dana Whitfield QA-E2E ${run.id} DV1`, { photos: [photo], urgency: 'soon' });
      const reference = await submitAndConfirm(form, homeowner, testInfo, 'DV1 evidence for SCR-02: 1 photo, offers unticked');
      await expect(page.getByRole('heading', { level: 1 })).toContainText(/Northside has your request/i);
      await expect(page.getByRole('button', { name: 'Send another request' }).or(page.getByRole('link', { name: 'Send another request' })).first()).toBeVisible();

      for (const [width, height] of [
        [1280, 800],
        [390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        const cap = new Capture(page, testInfo, 'SCR-02-confirmation');
        await cap.settled();
        await cap.viewportShot();
        await cap.fullShot();
        await cap.finish({ reference_shown: reference, photos_sent: 1, note: width === 390 ? 'same page, window narrowed to 390 px (desktop browser, not a phone)' : undefined });
      }
    });
  });
});
