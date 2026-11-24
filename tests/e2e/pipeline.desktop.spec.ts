// The Pipeline tab (US-016, SCR-05) at 1280 px: four fixed columns, drag with a mouse and with a touch pointer,
// Escape mid-drag, the Move to keyboard path, and every failure message. Works on requests the submitting specs created.
import { test, expect, renewSession } from './support/fixtures';
import { statePath } from './support/env';
import { pathIs } from './support/paths';
import { must, pick, pickAt } from './support/pool';
import {
  REF_RE,
  boardMap,
  card,
  columnDropPoint,
  columnHeading,
  columnOf,
  expectCount,
  keyboardMove,
  mouseDrag,
  mouseDragStart,
  moveTo,
  touchDrag,
  weeklyStrip,
} from './support/ui';
import type { Status } from './support/api';

test.use({ storageState: statePath('owner') });

const SAVE_FAILED = "Couldn't save. Try again.";
const CHANGED = 'This request was changed by someone else. Reload to see the latest.';
const statuses: Status[] = ['new', 'quoted', 'won', 'lost'];
const LABEL = { new: 'New', quoted: 'Quoted', won: 'Won', lost: 'Lost' } as const;

test.describe('the board shows every request (AC-016.1, AC-016.8, AC-016.9, AC-016.5)', () => {
  test('@smoke AC-016.1 AC-016.8 four columns in the order New, Quoted, Won, Lost, each newest first, each card with its facts', async ({ page, staffApi, guard }) => {
    const api = await staffApi('owner');
    await page.goto('/pipeline');
    await expect(columnHeading(page, 'new')).toBeVisible();
    const headings = await page.getByRole('heading', { name: /^(New|Quoted|Won|Lost)\b/ }).allInnerTexts();
    const order = headings.map((h) => h.match(/^(New|Quoted|Won|Lost)/)?.[1]);
    expect(order.slice(0, 4), 'columns in the fixed order').toEqual(['New', 'Quoted', 'Won', 'Lost']);

    const shown = await boardMap(page);
    for (const status of statuses) {
      const expected = (await api.list({ status, limit: 50 })).data.map((r) => r.reference);
      expect(shown[LABEL[status]], `${LABEL[status]} column: same cards, newest first by submitted time`).toEqual(expected.slice(0, shown[LABEL[status]].length));
      expect(shown[LABEL[status]].length, `${LABEL[status]} column shows up to 50 cards`).toBe(Math.min(expected.length, 50));
    }
    const top = must((await api.list({ limit: 1 })).data[0], 'at least one request on staging');
    const topCard = card(page, top.reference);
    await expect(topCard).toContainText(top.name);
    await expect(topCard).toContainText(/Emergency|Soon|Flexible/i);
    await expect(topCard).toContainText(/\d{1,2}:\d{2}\s*[ap]\.?m\.?/i);
    await guard.axe('pipeline-board');
  });

  test('@regression AC-016.9 AC-016.20 nothing on the tab adds, renames, deletes, recolours or reorders a column', async ({ page }) => {
    await page.goto('/pipeline');
    await expect(columnHeading(page, 'new')).toBeVisible();
    await expect(page.getByRole('button', { name: /add|rename|delete|remove|reorder|new column|edit column|colou?r/i }).filter({ hasNotText: /^Move/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(list|board)$/i })).toHaveCount(0);
    await expect(page.getByText(/To filter or search, use the Requests tab/)).toBeVisible();
    await expect(page.getByRole('searchbox'), 'no search on the Pipeline tab').toHaveCount(0);
  });

  test('@regression AC-016.5 clicking a card\'s reference opens the full request, and Back to Pipeline returns', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pick(api, () => true, 'available');
    await page.goto('/pipeline');
    await page.getByRole('link', { name: request.reference }).first().click();
    await expect(page).toHaveURL(pathIs(`/pipeline/${request.id}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(request.name);
    await expect(page.getByLabel(/^Price/)).toBeVisible();
    await page.getByRole('link', { name: /Back to Pipeline/ }).click();
    await expect(page).toHaveURL(pathIs('/pipeline'));
  });

  test('@regression AC-016.18 the first 50 cards per column are visible within 2 s on broadband', async ({ page }, testInfo) => {
    const started = Date.now();
    await page.goto('/pipeline', { waitUntil: 'commit' });
    await expect(page.getByRole('link', { name: REF_RE }).first()).toBeVisible({ timeout: 10_000 });
    const elapsed = Date.now() - started;
    await testInfo.attach('board-visible-ms', { body: `${elapsed} ms`, contentType: 'text/plain' });
    expect(elapsed, 'milliseconds until the cards are visible').toBeLessThan(2_000);
  });
});

test.describe('moving a card (AC-016.2, AC-016.3, AC-016.6, AC-016.7)', () => {
  test('@smoke AC-016.2 dragging a card with a mouse into Won saves it, survives a reload and raises the weekly Won count', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    const before = await api.weekly();
    await page.goto('/pipeline');
    await expect.poll(() => columnOf(page, request.reference)).toBe('New');

    await mouseDrag(page, request.reference, 'won');
    await expect.poll(() => columnOf(page, request.reference), { message: 'the card is in Won' }).toBe('Won');
    await expectCount(page, 'Won', before.won + 1, 2_000);
    await expect.poll(async () => (await api.get(request.id)).status).toBe('won');
    await page.reload();
    await expect.poll(() => columnOf(page, request.reference), { message: 'still in Won after a reload' }).toBe('Won');
    expect((await api.weekly()).won).toBe(before.won + 1);
  });

  test('@regression AC-016.2 dragging with a touch pointer (touch-enabled screen) into Quoted saves it', async ({ openStaff }) => {
    const owner = await openStaff('owner', { hasTouch: true });
    const request = await pickAt(owner.api, 'new', () => true, 'available');
    await owner.page.goto('/pipeline');
    await expect.poll(() => columnOf(owner.page, request.reference)).toBe('New');
    await touchDrag(owner.page, request.reference, 'quoted');
    await expect.poll(() => columnOf(owner.page, request.reference), { message: 'the touch drag moved the card to Quoted' }).toBe('Quoted');
    await expect.poll(async () => (await owner.api.get(request.id)).status).toBe('quoted');
  });

  test('@regression AC-016.7 pressing Escape in the middle of a drag puts the card back and stores nothing', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    const before = await api.get(request.id);
    await page.goto('/pipeline');
    await mouseDragStart(page, request.reference, await columnDropPoint(page, 'lost'));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(() => columnOf(page, request.reference), { message: 'back in New' }).toBe('New');
    await page.reload();
    await expect.poll(() => columnOf(page, request.reference)).toBe('New');
    const after = await api.get(request.id);
    expect(after.status).toBe('new');
    expect(after.version, 'nothing stored').toBe(before.version);
  });

  test('@regression AC-016.7 releasing a card outside all four columns puts it back and stores nothing', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    const before = await api.get(request.id);
    await page.goto('/pipeline');
    await mouseDragStart(page, request.reference, { x: 4, y: 4 }); // the very top-left corner of the page
    await page.mouse.up();
    await expect.poll(() => columnOf(page, request.reference)).toBe('New');
    expect((await api.get(request.id)).version).toBe(before.version);
  });

  test('@regression AC-016.6 dropping a card back into its own column stores nothing and records no new change time', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'quoted', () => true, 'available');
    const before = await api.get(request.id);
    await page.goto('/pipeline');
    await mouseDrag(page, request.reference, 'quoted');
    await expect.poll(() => columnOf(page, request.reference)).toBe('Quoted');
    const after = await api.get(request.id);
    expect(after.version, 'no new version').toBe(before.version);
    expect(after.status_changed_at, 'no new change time').toBe(before.status_changed_at);
  });

  test('@regression AC-016.3 the keyboard path: Enter opens Move to, arrows choose Quoted, Enter saves; focus stays on the card and the move is announced', async ({
    page,
    staffApi,
  }) => {
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    const before = await api.weekly();
    await page.goto('/pipeline');
    await expect.poll(() => columnOf(page, request.reference)).toBe('New');
    await keyboardMove(page, request.reference, 'quoted');
    await expect.poll(() => columnOf(page, request.reference), { message: 'the card is in Quoted' }).toBe('Quoted');
    await expect(page.getByText(`${request.reference} moved to Quoted`), 'announced to screen readers').toBeAttached();
    const focusNow = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return 'nothing';
      return `<${el.tagName.toLowerCase()}> "${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? ''}"`;
    });
    // "Focus stays on that card": the focused element is one of the moved card's own controls (its label names the
    // reference) or sits inside the card's list item / article. (The first version of this check took the nearest <div>,
    // which is not the card; it failed with focus on the card's own Move to button.)
    expect(
      await page.evaluate((ref) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return false;
        if ((el.getAttribute('aria-label') ?? '').includes(ref)) return true;
        const card = el.closest('li, article, [role="listitem"]');
        return !!card && (card.textContent ?? '').includes(ref);
      }, request.reference),
      `focus stays on the card of ${request.reference} (focus is on ${focusNow})`,
    ).toBe(true);
    await expect.poll(async () => (await api.get(request.id)).status).toBe('quoted');
    expect((await api.weekly()).won, 'Quoted does not touch the Won count').toBe(before.won);
  });

  test('@regression AC-016.8 a moved card takes its submitted-time position in the new column, not the top', async ({ page, staffApi }) => {
    const api = await staffApi('owner');
    const all = (await api.list({ limit: 100 })).data;
    expect(all.length, 'needs at least two requests').toBeGreaterThan(1);
    const oldest = must(all[all.length - 1], 'an oldest request');
    const request = await pickAt(api, 'new', () => true, 'available');
    await api.setStatus(oldest.id, 'won'); // so Won holds an older and a newer card than the one we move
    await page.goto('/pipeline');
    await moveTo(page, request.reference, 'won');
    await expect.poll(() => columnOf(page, request.reference)).toBe('Won');
    await page.reload();
    const map = await boardMap(page);
    const won = (await api.list({ status: 'won', limit: 50 })).data.map((r) => r.reference);
    expect(map.Won, 'Won column order equals newest first by submitted time').toEqual(won.slice(0, map.Won.length));
  });
});

test.describe('when a move cannot be saved (AC-016.12, AC-016.13, AC-016.15)', () => {
  test('@regression AC-016.12 the 409: the helper moved it first, so the owner\'s drag returns the card and says "changed by someone else"', async ({
    page,
    openStaff,
    staffApi,
    guard,
  }) => {
    guard.allowStatus(/\/status-changes$/, 409);
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await page.goto('/pipeline');
    await expect.poll(() => columnOf(page, request.reference)).toBe('New');
    const helper = await openStaff('helper');
    await helper.api.setStatus(request.id, 'won'); // the helper got there first

    await mouseDrag(page, request.reference, 'lost');
    await expect(page.getByText(CHANGED).first()).toBeVisible();
    await expect.poll(() => columnOf(page, request.reference), { message: 'her card returns to New' }).toBe('New');
    expect((await api.get(request.id)).status, "the helper's change is kept").toBe('won');
  });

  test('@regression AC-016.13 a network drop on a drop: the card shows Saving, returns to its column, "Couldn\'t save. Try again." shows, count unchanged', async ({
    page,
    staffApi,
    guard,
  }) => {
    guard.allowAbort(/\/status-changes$/);
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    const before = await api.weekly();
    await page.goto('/pipeline');
    await page.route(/\/status-changes$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900)); // long enough to see the card marked Saving
      await route.abort('failed');
    });
    await mouseDrag(page, request.reference, 'won');
    await expect(card(page, request.reference).getByText('Saving'), 'the card is marked Saving').toBeVisible();
    await expect(page.getByText(SAVE_FAILED).first()).toBeVisible();
    await expect.poll(() => columnOf(page, request.reference), { message: 'back in New' }).toBe('New');
    expect((await api.get(request.id)).status, 'nothing stored').toBe('new');
    expect((await api.weekly()).won, 'the weekly Won count is unchanged').toBe(before.won);
    await expectCount(page, 'Won', before.won);
  });

  test('@regression AC-016.13 the same with the Move to menu', async ({ page, staffApi, guard }) => {
    guard.allowAbort(/\/status-changes$/);
    const api = await staffApi('owner');
    const request = await pickAt(api, 'new', () => true, 'available');
    await page.goto('/pipeline');
    await page.route(/\/status-changes$/, (route) => route.abort('failed'));
    await moveTo(page, request.reference, 'won');
    await expect(page.getByText(SAVE_FAILED).first()).toBeVisible();
    await expect.poll(() => columnOf(page, request.reference)).toBe('New');
    expect((await api.get(request.id)).status).toBe('new');
  });

  test('@regression AC-016.15 when the requests cannot be loaded the tab says so and shows no empty columns', async ({ page, guard }) => {
    guard.allowAbort(/\/api\/quote-requests\?/);
    await page.route(/\/api\/quote-requests\?/, (route) => route.abort('failed'));
    await page.goto('/pipeline');
    await expect(page.getByText("Couldn't load requests. Try again.")).toBeVisible();
    await expect(page.getByText(/^No (new|quoted|won|lost) requests$/), 'no empty columns as if there were no requests').toHaveCount(0);
    await expect(weeklyStrip(page).or(page.getByText('Count unavailable')).first()).toBeVisible();
  });
});

// The owner's session has ended when she drops a card (AC-016.14). The save is answered with the contract's 401
// session_expired; the app signs her out, which revokes the saved owner session, so sign in again afterwards.
test.describe('session ended', () => {
  test.afterEach(async ({ browser }, testInfo) => {
    await renewSession(browser, 'owner', testInfo.project.use as Record<string, unknown>);
  });

  test('@regression AC-016.14 an expired session on a drop returns the card, saves nothing and sends her to sign-in', async ({ page, staffApi, guard }) => {
    guard.allowStatus(/\/status-changes$/, 401);
    const api = await staffApi('helper'); // reads the stored request after the owner's session ended
    const request = await pickAt(await staffApi('helper'), 'new', () => true, 'available');
    await page.goto('/pipeline');
    await expect.poll(() => columnOf(page, request.reference)).toBe('New');
    await page.route(/\/status-changes$/, (route) =>
      route.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Your session ended.', status: 401, code: 'session_expired' }) }),
    );
    await mouseDrag(page, request.reference, 'won');
    await expect(page).toHaveURL(pathIs('/sign-in'));
    expect((await api.get(request.id)).status, 'nothing saved').toBe('new');
  });
});
