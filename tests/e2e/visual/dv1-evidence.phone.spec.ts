// STEP FE2V re-run: extra evidence for the designer's DV1 review at 390 x 844 (project phone-staff).
// Screenshots and axe only, written to docs/qa-reports/visual/DV1/. No check here is about how a screen looks;
// the tests only make sure the screen is loaded before it is photographed. Nothing is submitted or changed.
import { test, expect } from '../support/fixtures';
import { statePath } from '../support/env';
import { REF_RE, weeklyStrip } from '../support/ui';
import { Capture } from './dv1';

test.describe('DV1 evidence at 390 px, signed in as the owner', () => {
  test.use({ storageState: statePath('owner') });

  test('@regression FE2V DV1 SCR-05 Pipeline at 390 px, viewport-sized capture', async ({ page }, testInfo) => {
    const cap = new Capture(page, testInfo, 'SCR-05-pipeline');
    await page.goto('/pipeline');
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();
    await expect(page.getByRole('link', { name: REF_RE }).first(), 'the board shows cards').toBeVisible();
    await expect(weeklyStrip(page)).toBeVisible();
    await expect(page.getByText('Count unavailable')).toHaveCount(0);
    await cap.settled();
    await cap.viewportShot();
    await cap.finish();
  });
});

test.describe('DV1 evidence at 390 px, signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@regression FE2V DV1 SCR-01 Request a quote at 390 px', async ({ page }, testInfo) => {
    const cap = new Capture(page, testInfo, 'SCR-01-request-form');
    const res = await page.goto('/');
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    expect(res?.status(), 'GET / answers 200').toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Request a quote' })).toBeVisible();
    await cap.settled();
    await cap.viewportShot();
    await cap.fullShot();
    await cap.finish({ http_status: res?.status() });
  });
});
