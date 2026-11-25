// STEP FE2V: visual evidence for the FE2 staff screens, on the staging preview, at 390 px (phone-staff project) and
// 1280 px (desktop project). The file name ends in .both.spec.ts so both projects pick it up.
//
// For every screen: a full-page screenshot, console errors and failed requests recorded (designed error states
// declared, nothing else excused), axe at WCAG 2.1 A and AA failing on serious or critical violations.
// Comparison with docs/design/screens/SCR-NN-*.png is done by looking (see docs/qa-reports/visual/FE2/README.md);
// a pixel difference never fails a test.
//
// The suite submits nothing: it reads the tagged QA-E2E requests earlier runs left on staging, through the API with
// the saved owner session, and changes nothing (no status change, no save). The only writes are failed sign-ins
// with a throwaway address (two per run, one per width), which count against the sign-in limits of that address
// and that made-up email only, never against the staff accounts.
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { newApi, describe, type Detail, type StaffApi } from '../support/api';
import { loadEnv, statePath } from '../support/env';
import { TAG } from '../support/pool';
import { expectCount, photoThumb, photoThumbs, REF_RE, tabLink, weeklyStrip } from '../support/ui';
import { Evidence, EVIDENCE_DIR } from './evidence';

const WIDTH = { 'phone-staff': 390, desktop: 1280 } as const;

function expectedWidth(projectName: string): number {
  const width = WIDTH[projectName as keyof typeof WIDTH];
  if (!width) throw new Error(`unexpected project ${projectName}: the visual spec runs only at 390 and 1280`);
  return width;
}

/** The tagged requests on staging that satisfy `wanted`, best match first (3 photos before fewer). */
async function pickTagged(api: StaffApi, wanted: (d: Detail) => boolean, description: string): Promise<Detail> {
  const found: Detail[] = [];
  for (const item of await api.tagged(TAG)) {
    const detail = await api.get(item.id);
    if (wanted(detail)) found.push(detail);
  }
  found.sort((a, b) => b.photo_count - a.photo_count);
  const best = found[0];
  if (!best) throw new Error(`No ${TAG} request on staging is ${description}. The QA1 submitting tests create them.`);
  return best;
}

async function photosLoaded(page: Page, count: number) {
  await expect(photoThumbs(page, count)).toHaveCount(count);
  await expect.poll(() => page.evaluate(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0)), { message: 'photo thumbnails decoded' }).toBe(true);
}

test.describe('deployment under test', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@regression FE2V the preview serves the commit under test (recorded in the evidence)', async ({ playwright }, testInfo) => {
    loadEnv();
    expectedWidth(testInfo.project.name);
    const expected = process.env.QA_EXPECTED_SHA ?? '42208a4';
    const anon = await newApi(playwright);
    const res = await anon.get('/api/health');
    expect(res.status(), await describe(res)).toBe(200);
    const body = (await res.json()) as { status?: string; version?: string };
    expect(String(body.version ?? ''), 'deployed commit').toContain(expected);
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'deployment.json'), `${JSON.stringify({ host: new URL(process.env.STAGING_URL ?? '').host, health: body.status, version: body.version }, null, 2)}\n`);
    await anon.dispose();
  });
});

test.describe('SCR-03 staff sign-in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@regression FE2V SCR-03 signed out: the sign-in page', async ({ page }, testInfo) => {
    const width = expectedWidth(testInfo.project.name);
    const ev = new Evidence(page, testInfo, 'SCR-03-signed-out');
    await page.goto('/sign-in');
    expect(page.viewportSize()?.width).toBe(width);
    await expect(page.getByRole('heading', { level: 1, name: 'Staff sign-in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Email or password is incorrect')).toHaveCount(0);
    await ev.imagesSettled();
    await ev.finish(await ev.shoot());
  });

  test('@regression FE2V SCR-03 wrong password (a throwaway email, never a staff account): the error notice', async ({ page, guard, run }, testInfo) => {
    const width = expectedWidth(testInfo.project.name);
    // The 401 of the sign-in route is this screen's designed error state. It is declared to the shared guard and to
    // the evidence recorder, and nothing else is.
    guard.allowStatus(/\/api\/auth\/sign-in$/, 401);
    const ev = new Evidence(page, testInfo, 'SCR-03-wrong-password', [{ status: 401, path: /^\/api\/auth\/sign-in$/ }]);
    await page.goto('/sign-in');
    expect(page.viewportSize()?.width).toBe(width);
    await page.getByLabel('Email').fill(`qa-visual-${run.id}-${width}@example.invalid`);
    await page.getByLabel('Password', { exact: true }).fill('not-a-real-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const notice = page.getByText('Email or password is incorrect');
    await expect(notice.first()).toBeVisible();
    await expect(page, 'a failed sign-in stays on the sign-in page').toHaveURL((url) => url.pathname === '/sign-in');
    await ev.imagesSettled();
    await ev.finish(await ev.shoot(), { notice: (await notice.first().innerText()).trim() });
  });
});

test.describe('staff screens, signed in as the owner', () => {
  test.use({ storageState: statePath('owner') });

  test('@regression FE2V SCR-04 Requests with data', async ({ page, staffApi }, testInfo) => {
    const width = expectedWidth(testInfo.project.name);
    const api = await staffApi('owner');
    const ev = new Evidence(page, testInfo, 'SCR-04-requests');
    await page.goto('/requests');
    expect(page.viewportSize()?.width).toBe(width);
    await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible();
    await expect(tabLink(page, 'Requests')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: REF_RE }).first(), 'the list shows requests').toBeVisible();
    await expect(page.getByText('No quote requests yet')).toHaveCount(0);
    await expect(page.getByText("Couldn't load requests. Try again.")).toHaveCount(0);
    for (const status of ['All', 'New', 'Quoted', 'Won', 'Lost']) {
      await expect(page.getByRole('radio', { name: status, exact: true }).or(page.getByRole('button', { name: status, exact: true })).first(), `the ${status} filter`).toBeVisible();
    }
    const listed = (await api.list({ limit: 50 })).data.length;
    await ev.imagesSettled();
    // The full page holds 50 rows (21,000 px tall on a phone); the top shot is the part a person compares to the mockup.
    const top = await ev.shootTop();
    await ev.finish(await ev.shoot(), { requests_in_api_first_page: listed, top_screenshot: top });
  });

  test('@regression FE2V SCR-06 detail of a request whose offers box was ticked', async ({ page, staffApi }, testInfo) => {
    const width = expectedWidth(testInfo.project.name);
    const api = await staffApi('owner');
    const request = await pickTagged(api, (d) => d.marketing_consent === true, 'one whose offers box was ticked');
    const ev = new Evidence(page, testInfo, 'SCR-06-ticked');
    await page.goto(`/requests/${request.id}`);
    expect(page.viewportSize()?.width).toBe(width);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(request.name);
    await expect(page.locator('main')).toContainText(request.reference);
    await expect(page.getByText('Not copied: no offers consent'), 'a ticked request is not "not copied"').toHaveCount(0);
    await expect(page.getByText('GoHighLevel').first()).toBeVisible();
    if (request.photo_count > 0) await photosLoaded(page, request.photo_count);
    await ev.imagesSettled();
    await ev.finish(await ev.shoot(), { photo_count: request.photo_count, copy_state: request.ghl.copy.state, status: request.status });
  });

  test('@regression FE2V SCR-06 detail of a request whose offers box was not ticked: "Not copied: no offers consent"', async ({ page, staffApi }, testInfo) => {
    const width = expectedWidth(testInfo.project.name);
    const api = await staffApi('owner');
    const request = await pickTagged(api, (d) => d.marketing_consent === false, 'one whose offers box was unticked');
    const ev = new Evidence(page, testInfo, 'SCR-06-unticked');
    await page.goto(`/requests/${request.id}`);
    expect(page.viewportSize()?.width).toBe(width);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(request.name);
    await expect(page.getByText('Not copied: no offers consent')).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry/ }), 'no Retry control at all').toHaveCount(0);
    await expect(page.getByText(/Stage tag/), 'no stage-tag line').toHaveCount(0);
    if (request.photo_count > 0) await photosLoaded(page, request.photo_count);
    await ev.imagesSettled();
    await ev.finish(await ev.shoot(), { photo_count: request.photo_count, copy_state: request.ghl.copy.state, status: request.status });
  });

  test('@regression FE2V SCR-08 photo viewer, opened with the "View photo 2" button', async ({ page, staffApi }, testInfo) => {
    const width = expectedWidth(testInfo.project.name);
    const api = await staffApi('owner');
    const request = await pickTagged(api, (d) => d.photo_count === 3, 'one with 3 photos');
    const ev = new Evidence(page, testInfo, 'SCR-08-photo-viewer');
    await page.goto(`/requests/${request.id}`);
    expect(page.viewportSize()?.width).toBe(width);
    await photosLoaded(page, 3);
    const thumb = photoThumb(page, 2, 3);
    await expect(thumb).toContainText('View photo 2');
    await thumb.scrollIntoViewIfNeeded();
    await thumb.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Photo 2 of 3')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Previous photo' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Next photo' })).toBeEnabled();
    const photo = dialog.getByRole('img').first();
    await expect(photo, 'the photo shows').toBeVisible();
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth), 'the photo has decoded').toBeGreaterThan(0);
    await ev.imagesSettled();

    // Nothing may cover anything else in the dialog: the photo frame must not sit on the title, the reference line,
    // Close, Previous photo or Next photo (design-specs SCR-08 "Layout": the buttons are at the bottom, reachable by thumb).
    type Box = { x: number; y: number; width: number; height: number };
    const boxOf = async (name: string, locator: Locator): Promise<[string, Box]> => {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`${name} has no box`);
      return [name, box];
    };
    // For text, the box of the words themselves (a block element can be wider than its words).
    const textBoxOf = async (name: string, locator: Locator): Promise<[string, Box]> => {
      const box = await locator.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      return [name, box];
    };
    const frame = await boxOf('photo', photo);
    const others = [
      await textBoxOf('title "Photo 2 of 3"', dialog.getByText('Photo 2 of 3')),
      await textBoxOf('reference and name line', dialog.getByText(request.reference)),
      await boxOf('Close', dialog.getByRole('button', { name: 'Close' })),
      await boxOf('Previous photo', dialog.getByRole('button', { name: 'Previous photo' })),
      await boxOf('Next photo', dialog.getByRole('button', { name: 'Next photo' })),
    ];
    const overlap = (a: Box, b: Box) => {
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      return w > 1 && h > 1 ? `${Math.round(w)} x ${Math.round(h)} px` : null;
    };
    const covered = others.flatMap(([name, box]) => {
      const o = overlap(frame[1], box);
      return o ? [`the photo covers ${name} (${o})`] : [];
    });
    const viewport = page.viewportSize();
    const layout = {
      viewport: `${viewport?.width} x ${viewport?.height}`,
      photo: frame[1],
      ...Object.fromEntries(others.map(([name, box]) => [name, box])),
    };
    // The viewport shot (not the full page): the dialog is fixed to the screen, so this is what a person sees.
    await ev.finish(await ev.shootViewport(), { layout, covered });
    expect(covered, `the photo frame must not cover the dialog's own text or buttons at ${layout.viewport}`).toEqual([]);
  });

  test('@regression FE2V SCR-07 the weekly strip on Requests', async ({ page, staffApi }, testInfo) => {
    const width = expectedWidth(testInfo.project.name);
    const api = await staffApi('owner');
    const ev = new Evidence(page, testInfo, 'SCR-07-weekly-strip');
    await page.goto('/requests');
    expect(page.viewportSize()?.width).toBe(width);
    const strip = weeklyStrip(page);
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Requests this week');
    await expect(strip).toContainText('Won');
    await expect(strip).toContainText('Lost');
    await expect(strip.getByText('Count unavailable')).toHaveCount(0);
    // The three numbers are the API's current-week counts (read-only; nothing is changed by this run).
    const week = await api.weekly();
    await expectCount(page, 'Requests this week', week.requests);
    await expectCount(page, 'Won', week.won);
    await expectCount(page, 'Lost', week.lost);
    await ev.imagesSettled();
    // The element shot is the SCR-07 evidence; the axe run covers the whole page the strip sits on.
    await ev.finish(await ev.shoot(strip), { week_start: week.week_start, week_end: week.week_end, requests: week.requests, won: week.won, lost: week.lost });
  });
});
