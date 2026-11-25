// The signed-in area: two tabs with their own addresses (FR-26), the Requests list (newest first, filter, search),
// status changes from the list (Move to), the weekly count, and the failure messages of the list.
// Runs on a phone and on a desktop. Works on requests the submitting specs created (names start "QA-E2E").
import { test, expect } from './support/fixtures';
import { statePath } from './support/env';
import { pathIs } from './support/paths';
import { must, pick, pickAt } from './support/pool';
import {
  REF_RE,
  REF_RE_GLOBAL,
  expectCount,
  hasHorizontalScroll,
  mainNav,
  menuItem,
  moveButton,
  moveTo,
  tabLink,
  weeklyStrip,
} from './support/ui';

test.use({ storageState: statePath('owner') });

test.describe('tabs are separate addresses (FR-26, AC-005.10, AC-016.19, AC-016.20)', () => {
  test('@smoke AC-005.10 AC-016.19 each tab opens directly from its own address and is marked current', async ({ page, guard }) => {
    await page.goto('/requests');
    await expect(tabLink(page, 'Requests')).toHaveAttribute('aria-current', 'page');
    await expect(tabLink(page, 'Pipeline')).not.toHaveAttribute('aria-current', 'page');
    await expect(weeklyStrip(page), 'the weekly count is on Requests').toBeVisible();
    const requestsUrl = page.url();

    // a new browser tab, straight to the saved address
    const second = await page.context().newPage();
    await second.goto('/pipeline');
    await expect(tabLink(second, 'Pipeline')).toHaveAttribute('aria-current', 'page');
    await expect(tabLink(second, 'Requests')).not.toHaveAttribute('aria-current', 'page');
    await expect(weeklyStrip(second), 'the weekly count is on Pipeline').toBeVisible();
    await expect(second.getByRole('heading', { name: /^New\b/ }).first()).toBeVisible();
    expect(second.url(), 'two different addresses').not.toBe(requestsUrl);
    await guard.axe('pipeline-direct', second);
    await second.close();
  });

  test('@regression AC-016.20 there is no List / Board switch; selecting a tab changes the address', async ({ page }) => {
    await page.goto('/requests');
    await expect(page.getByRole('button', { name: /^(list|board)$/i })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: /^(list|board)$/i })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^(list|board)$/i })).toHaveCount(0);
    await expect(mainNav(page)).toBeVisible();
    await tabLink(page, 'Pipeline').click();
    await expect(page).toHaveURL(pathIs('/pipeline'));
    await expect(page.getByRole('button', { name: /^(list|board)$/i })).toHaveCount(0);
    await tabLink(page, 'Requests').click();
    await expect(page).toHaveURL(pathIs('/requests'));
    expect(new URL(page.url()).search, 'no view parameter in the address').toBe('');
  });

  test('@regression FR-26 a request opened from a tab keeps that tab marked and offers the matching Back link', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pick(api, () => true, 'available');
    await page.goto(`/pipeline/${request.id}`);
    await expect(tabLink(page, 'Pipeline')).toHaveAttribute('aria-current', /page|true/);
    await expect(page.getByRole('link', { name: /Back to Pipeline/ })).toBeVisible();
    await page.goto(`/requests/${request.id}`);
    await expect(tabLink(page, 'Requests')).toHaveAttribute('aria-current', /page|true/);
    await expect(page.getByRole('link', { name: /Back to Requests/ })).toBeVisible();
  });
});

test.describe('the Requests list (US-005, US-011, US-013)', () => {
  test('@smoke AC-005.1 requests are listed newest first with reference, name, urgency, status and a Hamilton time', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const expected = (await api.list({ limit: 20 })).data;
    await page.goto('/requests');
    await expect(page.getByRole('link', { name: REF_RE }).first()).toBeVisible();
    const shown = (await page.locator('main').innerText()).match(REF_RE_GLOBAL) ?? [];
    const order = [...new Set(shown)].slice(0, expected.length);
    expect(order, 'the list shows the same order as the API (submitted time, newest first)').toEqual(expected.map((r) => r.reference).slice(0, order.length));
    const top = must(expected[0], 'at least one request on staging');
    const row = page.locator('tr, li, article').filter({ hasText: top.reference }).first();
    await expect(row).toContainText(top.name);
    await expect(row).toContainText(/Emergency|Soon|Flexible/i);
    await expect(row).toContainText(/New|Quoted|Won|Lost/);
    await expect(row, 'time shown in 12-hour Hamilton form').toContainText(/\d{1,2}:\d{2}\s*[ap]\.?m\.?/i);
  });

  test('@regression AC-005.9 no horizontal scrolling at 375 px on the list', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/requests');
    await expect(page.getByRole('link', { name: REF_RE }).first()).toBeVisible();
    expect(await hasHorizontalScroll(page), 'the page scrolls sideways').toBe(false);
  });

  test('@regression AC-005.8 the list is visible within 2 s on broadband (the criterion is stated for desktop; measured in both projects)', async ({ page }, testInfo) => {
    const started = Date.now();
    await page.goto('/requests', { waitUntil: 'commit' });
    await expect(page.getByRole('link', { name: REF_RE }).first()).toBeVisible({ timeout: 10_000 });
    const elapsed = Date.now() - started;
    await testInfo.attach('list-visible-ms', { body: `${elapsed} ms`, contentType: 'text/plain' });
    expect(elapsed, 'milliseconds until the list is visible').toBeLessThan(2_000);
  });

  test('@regression AC-011.1 the New filter lists exactly the New requests, newest first', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    await page.goto('/requests');
    await page.getByRole('button', { name: 'New', exact: true }).or(page.getByRole('radio', { name: 'New', exact: true })).click();
    const expected = (await api.list({ status: 'new', limit: 50 })).data.map((r) => r.reference);
    await expect(page.getByRole('link', { name: REF_RE }).first()).toBeVisible();
    const shown = [...new Set((await page.locator('main').innerText()).match(REF_RE_GLOBAL) ?? [])];
    expect(shown.slice(0, expected.length), 'only New requests, in submitted order').toEqual(expected.slice(0, shown.length));
    expect(shown.length).toBeGreaterThan(0);
  });

  test('@regression AC-011.3 with the New filter on, marking a request Won removes its row without a page reload', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await page.goto('/requests');
    await page.getByRole('button', { name: 'New', exact: true }).or(page.getByRole('radio', { name: 'New', exact: true })).click();
    await expect(moveButton(page, request.reference)).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __qaMarker: number }).__qaMarker = 1));
    await moveTo(page, request.reference, 'won');
    await expect(moveButton(page, request.reference), 'the row left the New list').toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __qaMarker?: number }).__qaMarker), 'the page was not reloaded').toBe(1);
    expect((await api.get(request.id)).status).toBe('won');
  });

  test('@regression AC-011.4 when the list cannot load, choosing a filter says so and does not show the old list as filtered', async ({ page, guard }) => {
    await page.goto('/requests');
    await expect(page.getByRole('link', { name: REF_RE }).first()).toBeVisible();
    guard.allowAbort(/\/api\/quote-requests\?/);
    await page.route(/\/api\/quote-requests\?.*status=lost/, (route) => route.abort('failed'));
    await page.getByRole('button', { name: 'Lost', exact: true }).or(page.getByRole('radio', { name: 'Lost', exact: true })).click();
    await expect(page.getByText("Couldn't load requests. Try again.")).toBeVisible();
    await expect(page.getByRole('link', { name: REF_RE }), 'the unfiltered list is not left on screen').toHaveCount(0);
  });

  test('@regression AC-013.1 AC-013.3 AC-013.2 search finds a reference in lower case, part of a name, and says "No matching requests"', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pick(api, (d) => /Whitfield|Morgan|Patel|Lee/.test(d.name), 'a tagged request with a searchable name');
    await page.goto('/requests');
    // The control is a textbox "Search by reference, name or phone" with its own Search button (attempt 3 snapshot).
    const search = page.getByRole('textbox', { name: /Search by reference, name or phone/i });
    const searchFor = async (text: string) => {
      await search.fill(text);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
    };
    await searchFor(request.reference.toLowerCase());
    await expect(page.getByRole('link', { name: request.reference }).first()).toBeVisible();
    const part = (request.name.split(' ').at(-1) ?? '').slice(0, 4).toLowerCase();
    await searchFor(part);
    await expect(page.getByRole('link', { name: request.reference }).first(), `partial name "${part}" finds it`).toBeVisible();
    await searchFor('zzzqaxyz');
    await expect(page.getByText('No matching requests')).toBeVisible();
  });
});

test.describe('the office helper has the same rights (AC-004.2)', () => {
  test.use({ storageState: statePath('helper') });

  test('@regression AC-004.2 the helper sees the same requests as the owner and can change price, note and status', async ({ page, staffApi }) => {
    const ownerApi = await staffApi('owner');
    const helperApi = await staffApi('helper');
    const ownerList = (await ownerApi.list({ limit: 20 })).data.map((r) => r.reference);
    const helperList = (await helperApi.list({ limit: 20 })).data.map((r) => r.reference);
    expect(helperList, 'the same requests in the same order').toEqual(ownerList);

    const request = await pickAt(helperApi, 'new', () => true, 'available');
    await page.goto(`/requests/${request.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(request.name);
    await page.getByLabel(/^Price/).fill('222.22');
    await page.getByLabel(/^Note/).fill('Saved by the office helper');
    await page.getByRole('button', { name: /Save price and note|Try saving again/ }).click();
    await expect(page.getByText(/Saved\./).first()).toBeVisible();
    await expect(page.getByText(/Last updated by Office helper at/)).toBeVisible();
    await page.getByRole('radio', { name: 'Quoted', exact: true }).or(page.getByRole('button', { name: 'Quoted', exact: true })).click();
    await expect.poll(async () => (await helperApi.get(request.id)).status).toBe('quoted');
    const stored = await ownerApi.get(request.id);
    expect(stored.price_cents).toBe(22_222);
    expect(stored.note).toBe('Saved by the office helper');
    expect(stored.last_updated?.by_display_name).toBe('Office helper');
  });
});

test.describe('status from the list (US-007) and the weekly count (US-008)', () => {
  test('@regression AC-007.2 AC-007.3 AC-007.5 AC-008.5 New to Quoted to Lost, then Won back to Lost: stored, position kept, counts move', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await page.goto('/requests');
    await expect(page.getByRole('link', { name: request.reference }).first(), 'the list has loaded before its order is recorded').toBeVisible();
    const orderBefore = [...new Set((await page.locator('main').innerText()).match(REF_RE_GLOBAL) ?? [])];
    expect(orderBefore.length, 'the order recorded is not empty').toBeGreaterThan(1);

    await moveTo(page, request.reference, 'quoted');
    await expect.poll(async () => (await api.get(request.id)).status).toBe('quoted');
    await moveTo(page, request.reference, 'lost');
    await expect.poll(async () => (await api.get(request.id)).status).toBe('lost');
    const orderAfter = [...new Set((await page.locator('main').innerText()).match(REF_RE_GLOBAL) ?? [])];
    expect(orderAfter, 'AC-007.5 a status change never moves the row').toEqual(orderBefore);

    // Won then Lost in the same week: Won no longer counts it, Lost does (AC-008.5)
    await moveTo(page, request.reference, 'won');
    await expect.poll(async () => (await api.get(request.id)).status).toBe('won');
    const withWon = await api.weekly();
    await moveTo(page, request.reference, 'lost');
    await expectCount(page, 'Won', withWon.won - 1, 2_000);
    await expectCount(page, 'Lost', withWon.lost + 1, 2_000);
    const after = await api.weekly();
    expect({ won: after.won, lost: after.lost }).toEqual({ won: withWon.won - 1, lost: withWon.lost + 1 });
  });

  test('@regression AC-007.1 the Move to menu lists the other three statuses only', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'quoted', () => true, 'available');
    await page.goto('/requests');
    await moveButton(page, request.reference).click();
    await expect(menuItem(page, 'new')).toBeVisible();
    await expect(menuItem(page, 'won')).toBeVisible();
    await expect(menuItem(page, 'lost')).toBeVisible();
    await expect(menuItem(page, 'quoted'), 'the current status is not offered').toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('@regression design wording (SQ-10): each Move to button shows "Move to" and is named "Move to another status, NQ-..." (design-specs, MoveToMenu and Screen readers)', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'quoted', () => true, 'available');
    await page.goto('/requests');
    const button = page.getByRole('button', { name: `Move to another status, ${request.reference}`, exact: true });
    await expect(button).toHaveCount(1);
    await expect(button, 'the visible words start the accessible name (WCAG 2.5.3)').toContainText('Move to');
  });

  test('@regression AC-007.6 when a status save fails the request keeps its status and says "Couldn\'t save. Try again."', async ({ page, staffApi, guard }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    guard.allowAbort(/\/status-changes$/);
    await page.goto('/requests');
    await page.route(/\/status-changes$/, (route) => route.abort('failed'));
    await moveTo(page, request.reference, 'won');
    await expect(page.getByText("Couldn't save. Try again.").first()).toBeVisible();
    await expect(page.locator('tr, li, article').filter({ hasText: request.reference }).first()).toContainText('New');
    expect((await api.get(request.id)).status, 'nothing stored').toBe('new');
  });

  test('@regression AC-008.8 when the count cannot load the strip says "Count unavailable" and the list still loads', async ({ page, guard }) => {
    guard.allowAbort(/\/api\/weekly-counts\/current/);
    await page.route(/\/api\/weekly-counts\/current/, (route) => route.abort('failed'));
    await page.goto('/requests');
    await expect(page.getByText('Count unavailable').first()).toBeVisible();
    await expect(page.getByRole('link', { name: REF_RE }).first(), 'the list loaded anyway').toBeVisible();
  });

  test('@regression AC-008.1 the strip shows the three labels and numbers that match the API', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    await page.goto('/requests');
    const counts = await api.weekly();
    await expect(weeklyStrip(page)).toContainText('THIS WEEK', { ignoreCase: true });
    await expectCount(page, 'Requests this week', counts.requests);
    await expectCount(page, 'Won', counts.won);
    await expectCount(page, 'Lost', counts.lost);
    expect(counts.time_zone).toBe('America/Toronto');
    const start = new Date(counts.week_start);
    expect(start.toLocaleDateString('en-CA', { weekday: 'long', timeZone: 'America/Toronto' }), 'the week starts on a Monday, Hamilton time').toBe('Monday');
  });
});
