// The Pipeline tab and the request detail on a 375 px phone: no sideways scrolling, and a card moves with taps only.
// AC-016.17, AC-005.9 (detail), AC-016.1 (one stacked column per status with a way to jump to a column).
import { test, expect } from './support/fixtures';
import { statePath } from './support/env';
import { pathIs } from './support/paths';
import { pick, pickAt } from './support/pool';
import { REF_RE, columnOf, expectCount, hasHorizontalScroll, tabLink, tapMoveTo, weeklyStrip } from './support/ui';

test.use({ storageState: statePath('owner'), viewport: { width: 375, height: 812 } });

test('@smoke AC-016.17 on a 375 px phone a card moves with taps only and the page never scrolls sideways', async ({ page, staffApi, guard }) => {
  const api = await staffApi('owner');
  const request = await pickAt(api, 'new', () => true, 'available');
  const before = await api.weekly();
  await page.goto('/pipeline');
  await expect(page.getByRole('link', { name: REF_RE }).first()).toBeVisible();
  expect(await hasHorizontalScroll(page), 'the board scrolls sideways').toBe(false);
  await expect(tabLink(page, 'Pipeline')).toHaveAttribute('aria-current', 'page');
  await expect(weeklyStrip(page)).toBeVisible();
  await guard.axe('pipeline-375');

  await tapMoveTo(page, request.reference, 'won');
  await expect.poll(() => columnOf(page, request.reference), { message: 'the card is in Won' }).toBe('Won');
  await expectCount(page, 'Won', before.won + 1, 2_000);
  expect(await hasHorizontalScroll(page), 'still no sideways scrolling after the move').toBe(false);
  expect((await api.get(request.id)).status).toBe('won');
});

test('@regression AC-005.9 no horizontal scrolling at 375 px on a request and its photos', async ({ page, staffApi }) => {
  const api = await staffApi('owner');
  const request = await pick(api, (d) => d.photo_count === 3, 'one with 3 photos');
  await page.goto(`/requests/${request.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(request.name);
  await expect(page.getByRole('button', { name: /^Open photo \d of 3 at full size$/ })).toHaveCount(3);
  expect(await hasHorizontalScroll(page), 'the detail scrolls sideways').toBe(false);
});

test('@regression AC-016.1 (phone) the main navigation is a bottom bar with both tabs, one stacked column per status', async ({ page }) => {
  await page.goto('/requests');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const box = await nav.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y > viewport.height / 2, 'the tabs sit in the lower half of the phone screen').toBe(true);
  await tabLink(page, 'Pipeline').tap();
  await expect(page).toHaveURL(pathIs('/pipeline'));
  for (const name of ['New', 'Quoted', 'Won', 'Lost']) {
    await expect(page.getByRole('heading', { name: new RegExp(`^${name}\\b`) }).first()).toBeAttached();
  }
});
