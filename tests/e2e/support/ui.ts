// Page helpers: the Request a quote form, the staff tabs, the weekly strip, the Move to menu and board drags.
// Locators use roles, labels and the exact copy in docs/design-specs.md ("Copy"); no CSS classes.
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { recordCreated, takeSubmissionSlot } from './budget';
import type { Photo } from './files';
import type { Status } from './api';

/** NQ- plus 6 characters from A-Z and 2-9 without I, L and O (FR-2). */
export const REF_RE = /NQ-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}/;
export const REF_RE_GLOBAL = /NQ-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}/g;

export const STATUS_LABEL: Record<Status, string> = { new: 'New', quoted: 'Quoted', won: 'Won', lost: 'Lost' };

// ---------------------------------------------------------------------------------------------
// Request a quote (SCR-01) and Request sent (SCR-02)

export interface Homeowner {
  name: string;
  phone: string;
  email: string;
  address: string;
  problem: string;
  urgency: 'emergency' | 'soon' | 'flexible';
  /** Tick the offers box (default: leave it as the page loaded it). */
  tickOffers?: boolean;
  photos?: Photo[];
}

export const OFFERS_LABEL = 'Email me offers and news from Northside. This is optional.';
export const DATA_USE_LINE = 'Northside will use these details to reply to your quote request. It will email you offers only if you tick the box.';
const URGENCY_NAME: Record<Homeowner['urgency'], RegExp> = { emergency: /^Emergency/i, soon: /^Soon/i, flexible: /^Flexible/i };

export class RequestForm {
  private openedAt = 0;
  constructor(readonly page: Page) {}

  async open() {
    // FR-8: the form refuses a send in the first 3 seconds after the page was rendered, so note when we asked for it.
    this.openedAt = Date.now();
    await this.page.goto('/');
    await expect(this.page.getByRole('heading', { level: 1, name: 'Request a quote' })).toBeVisible();
  }

  get name() { return this.page.getByLabel('Your name'); }
  get phone() { return this.page.getByLabel('Phone number'); }
  get email() { return this.page.getByLabel('Email', { exact: true }); }
  get address() { return this.page.getByLabel('Address of the job'); }
  get problem() { return this.page.getByLabel("What's the problem?"); }
  get offers() { return this.page.getByRole('checkbox', { name: OFFERS_LABEL }); }
  get send() { return this.page.getByRole('button', { name: /^Send request$|^Sending$/ }); }
  get fileInput() { return this.page.locator('input[type="file"]'); }
  urgency(which: Homeowner['urgency']) { return this.page.getByRole('radio', { name: URGENCY_NAME[which] }); }

  async fill(d: Homeowner) {
    await this.name.fill(d.name);
    await this.phone.fill(d.phone);
    await this.email.fill(d.email);
    await this.address.fill(d.address);
    await this.problem.fill(d.problem);
    await this.urgency(d.urgency).check();
    if (d.photos?.length) await this.attach(d.photos);
    if (d.tickOffers) await this.offers.check();
  }

  async attach(photos: Photo[]) {
    await this.fileInput.setInputFiles(photos.map((p) => ({ name: p.name, mimeType: p.mimeType, buffer: p.buffer })));
  }

  /** Be a person, not a bot: at least 3.5 s after the page was rendered. This honours FR-8, it is not a sleep to hide slowness. */
  async waitForHumanSpeed() {
    const remaining = 3_500 - (Date.now() - this.openedAt);
    if (remaining > 0) await this.page.waitForTimeout(remaining);
  }

  /** Press Send. Pass `testInfo` for a send the server will accept (it takes a submission slot first). */
  async submit(testInfo?: TestInfo) {
    if (testInfo) await takeSubmissionSlot(testInfo);
    await this.waitForHumanSpeed();
    await this.send.click();
  }

  /** After a successful send: the reference shown on SCR-02. */
  async confirmedReference(): Promise<string> {
    await expect(this.page).toHaveURL(/\/request-sent/);
    await expect(this.page.getByRole('heading', { level: 1 })).toContainText(/Northside has your request/i);
    const text = await this.page.locator('main').innerText();
    const ref = text.match(REF_RE)?.[0];
    expect(ref, 'a reference number like NQ-7K3M9P is shown on the confirmation').toBeDefined();
    return ref as string;
  }
}

/** A homeowner whose every field is valid. `label` and the run id tag the data (name prefix "QA-E2E"). */
export function validHomeowner(tag: string, overrides: Partial<Homeowner> = {}): Homeowner {
  return {
    name: tag,
    phone: '905-555-0142',
    email: 'dana@example.com',
    address: '14 Barton St W, Hamilton ON',
    problem: 'Kitchen tap drips constantly and the cabinet under it is wet',
    urgency: 'soon',
    ...overrides,
  };
}

/** Submit through the page and return the reference; records the request in the created-data list. */
export async function submitAndConfirm(form: RequestForm, d: Homeowner, testInfo: TestInfo, note: string): Promise<string> {
  await form.fill(d);
  await form.submit(testInfo);
  const reference = await form.confirmedReference();
  recordCreated({ reference, name: d.name, note });
  return reference;
}

// ---------------------------------------------------------------------------------------------
// Staff tabs

export function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' });
}
export function tabLink(page: Page, tab: 'Requests' | 'Pipeline') {
  return mainNav(page).getByRole('link', { name: tab });
}

/** The reference link of a request on either tab. */
export function refLink(page: Page, ref: string): Locator {
  return page.getByRole('link', { name: ref }).first();
}

/** The Move to button of one request (its name carries the reference, design-specs "Accessibility notes"). */
export function moveButton(page: Page, ref: string): Locator {
  return page.getByRole('button', { name: new RegExp(`Move ${ref}`) });
}

export function menuItem(page: Page, status: Status): Locator {
  const name = STATUS_LABEL[status];
  return page.getByRole('menuitem', { name, exact: true }).or(page.getByRole('menuitemradio', { name, exact: true }));
}

/** Choose a status from a request's Move to menu with the mouse or a tap. */
export async function moveTo(page: Page, ref: string, status: Status) {
  await moveButton(page, ref).click();
  await menuItem(page, status).click();
}

/** The weekly strip: the innermost element holding all three labels. */
export function weeklyStrip(page: Page): Locator {
  return page.locator('section, div, ul, dl').filter({ hasText: 'Requests this week' }).filter({ hasText: 'Won' }).filter({ hasText: 'Lost' }).last();
}

function countPattern(label: string, n: number): RegExp {
  return new RegExp(`(?:${label}\\s*${n}(?!\\d)|(?<!\\d)${n}\\s*${label})`, 'i');
}
export function expectCount(page: Page, label: 'Requests this week' | 'Won' | 'Lost', n: number, timeout = 10_000) {
  return expect(weeklyStrip(page)).toContainText(countPattern(label, n), { timeout });
}

/** The column heading ("New", "Quoted", "Won", "Lost") above a request's card on the Pipeline tab, found by structure. */
export async function columnOf(page: Page, ref: string): Promise<string | null> {
  return page.evaluate((reference) => {
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes(reference));
    if (!link) return null;
    let el: Element | null = link.parentElement;
    while (el) {
      const heads = [...el.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
        .map((h) => h.textContent?.trim() ?? '')
        .map((t) => t.match(/^(New|Quoted|Won|Lost)\b/)?.[1])
        .filter((t): t is string => Boolean(t));
      const unique = [...new Set(heads)];
      if (unique.length === 1) return unique[0] as string;
      if (unique.length > 1) return null;
      el = el.parentElement;
    }
    return null;
  }, ref);
}

/** Every request reference on the board, grouped by the column heading above it, in the order the page shows them. */
export type Column = 'New' | 'Quoted' | 'Won' | 'Lost';
export async function boardMap(page: Page): Promise<Record<Column, string[]>> {
  return page.evaluate(() => {
    const out: Record<'New' | 'Quoted' | 'Won' | 'Lost', string[]> = { New: [], Quoted: [], Won: [], Lost: [] };
    const seen = new Set<string>();
    const ref = /NQ-[A-Z2-9]{6}/;
    for (const a of document.querySelectorAll('a')) {
      const found = a.textContent?.match(ref)?.[0] ?? a.getAttribute('aria-label')?.match(ref)?.[0];
      if (!found || seen.has(found)) continue;
      let el: Element | null = a.parentElement;
      while (el) {
        const heads = [...el.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
          .map((h) => h.textContent?.trim().match(/^(New|Quoted|Won|Lost)\b/)?.[1])
          .filter((t): t is string => Boolean(t));
        const unique = [...new Set(heads)];
        if (unique.length === 1) {
          seen.add(found);
          out[unique[0] as 'New' | 'Quoted' | 'Won' | 'Lost'].push(found);
          break;
        }
        if (unique.length > 1) break;
        el = el.parentElement;
      }
    }
    return out;
  });
}

/** A tap (touch) on the Move to button and then on the menu entry. */
export async function tapMoveTo(page: Page, ref: string, status: Status) {
  await moveButton(page, ref).tap();
  await menuItem(page, status).tap();
}

export function columnHeading(page: Page, status: Status): Locator {
  return page.getByRole('heading', { name: new RegExp(`^${STATUS_LABEL[status]}\\b`) }).first();
}

/** The board card of a request: the innermost element that holds its reference link and its Move to button. */
export function card(page: Page, ref: string): Locator {
  return page.locator('li, article, div').filter({ has: page.getByRole('link', { name: ref }) }).filter({ has: moveButton(page, ref) }).last();
}

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box (not visible?)');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Where a drop into a column lands: a little below the column heading. */
export async function columnDropPoint(page: Page, status: Status) {
  const head = await centre(columnHeading(page, status));
  return { x: head.x, y: head.y + 70 };
}

/** Press on the card, move in steps, and leave the pointer down (returns a function to release). */
export async function mouseDragStart(page: Page, ref: string, to: { x: number; y: number }) {
  const from = await centre(card(page, ref));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 18 });
}

export async function mouseDrag(page: Page, ref: string, status: Status) {
  await mouseDragStart(page, ref, await columnDropPoint(page, status));
  await page.mouse.up();
}

/** A touch drag: press and hold, move in steps, release. Uses Chromium's touch input events. */
export async function touchDrag(page: Page, ref: string, status: Status) {
  const from = await centre(card(page, ref));
  const to = await columnDropPoint(page, status);
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', from.x, from.y);
  await page.waitForTimeout(450); // a long press is how touch drags are started
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await touch('touchEnd', to.x, to.y);
  await cdp.detach();
}

/** Keyboard path of the Move to menu: Enter opens it, arrows move, Enter chooses (AC-016.3). */
export async function keyboardMove(page: Page, ref: string, status: Status) {
  const button = moveButton(page, ref);
  await button.focus();
  await page.keyboard.press('Enter');
  const target = menuItem(page, status);
  await expect(target).toBeVisible();
  for (let i = 0; i < 4; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
}

export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}
