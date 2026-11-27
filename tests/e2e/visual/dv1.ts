// Evidence for the designer's DV1 review (STEP FE2V re-run). Screenshots and axe only: nothing here is a pass/fail
// gate on how a screen looks. A Capture records the screenshots, console errors, failed requests, the full axe result,
// page overflow and any measurements the test hands it, then writes <id>-<w>x<h>.json next to the PNGs in
// docs/qa-reports/visual/DV1/. It never asserts. (The shared `guard` fixture still fails a test on an undeclared
// console error or failed request; that is the suite's standing rule, not a new gate.)
// No cookies, tokens, signed URLs or personal data are written: paths only, never a query string.
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { TAG } from '../support/pool';
import type { Detail, StaffApi } from '../support/api';

export const DV1_DIR = path.resolve(__dirname, '../../../docs/qa-reports/visual/DV1');
/** The commit under test; the same default as fe2-screens.both.spec.ts (that spec checks it against /api/health). */
export const EXPECTED_SHA = process.env.QA_EXPECTED_SHA ?? '42208a4';

const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: unknown[] }>;
}

export type Box = { x: number; y: number; width: number; height: number };

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '(unparsable)';
  }
}

export class Capture {
  private readonly consoleErrors: string[] = [];
  private readonly failedRequests: string[] = [];
  private readonly designedAborts: string[] = [];
  private readonly shots: string[] = [];

  /** `designed`: request paths this capture aborts or refuses on purpose (listed apart, never counted as failures). */
  constructor(
    private readonly page: Page,
    private readonly testInfo: TestInfo,
    private readonly id: string,
    private readonly designed: RegExp[] = [],
  ) {
    const isDesigned = (url: string) => this.designed.some((d) => d.test(pathOf(url)));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      const failedLoad = text.match(/^Failed to load resource: (?:the server responded with a status of (\d+)|net::(ERR_\w+))/);
      if (failedLoad && (isDesigned(m.location().url) || failedLoad[2] === 'ERR_ABORTED')) return;
      this.consoleErrors.push(text.slice(0, 300));
    });
    page.on('pageerror', (e) => this.consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on('requestfailed', (r) => {
      const line = `${r.method()} ${pathOf(r.url())} ${r.failure()?.errorText ?? 'failed'}`;
      if (isDesigned(r.url())) this.designedAborts.push(line);
      else if (r.failure()?.errorText !== 'net::ERR_ABORTED') this.failedRequests.push(line);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) this.failedRequests.push(`${r.status()} ${r.request().method()} ${pathOf(r.url())} x-vercel-id=${r.headers()['x-vercel-id'] ?? 'n/a'}`);
    });
  }

  private size(): { w: number; h: number } {
    const v = this.page.viewportSize();
    if (!v) throw new Error('no viewport');
    return { w: v.width, h: v.height };
  }

  private stem(): string {
    const { w, h } = this.size();
    fs.mkdirSync(DV1_DIR, { recursive: true });
    return path.join(DV1_DIR, `${this.id}-${w}x${h}`);
  }

  /** Fonts and images finished, so a shot is not taken mid-load. */
  async settled(): Promise<void> {
    await this.page.evaluate(() => document.fonts.ready.then(() => undefined));
    await this.page.waitForFunction(() => [...document.images].every((img) => img.complete));
  }

  /** The viewport only, as a person sees it (390 x 844, 1280 x 800, 1280 x 720). */
  async viewportShot(suffix = ''): Promise<string> {
    const file = `${this.stem()}${suffix}.png`;
    await this.page.screenshot({ path: file, animations: 'disabled' });
    this.shots.push(path.basename(file));
    return path.basename(file);
  }

  async fullShot(): Promise<string> {
    const file = `${this.stem()}-full.png`;
    await this.page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    this.shots.push(path.basename(file));
    return path.basename(file);
  }

  async elementShot(target: Locator, suffix: string): Promise<string> {
    const file = `${this.stem()}${suffix}.png`;
    await target.screenshot({ path: file, animations: 'disabled' });
    this.shots.push(path.basename(file));
    return path.basename(file);
  }

  /** axe at WCAG 2.0 / 2.1 A and AA, every violation recorded, nothing asserted. */
  private async axe(): Promise<{ serious_or_critical: string[]; minor_or_moderate: string[] }> {
    await this.page.evaluate(AXE_SOURCE);
    const violations = await this.page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) }));
    });
    const line = (v: AxeViolation) => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.length} node(s), first ${JSON.stringify(v.nodes[0]?.target)}`;
    const hard = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const soft = violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
    return { serious_or_critical: hard.map(line), minor_or_moderate: soft.map(line) };
  }

  async finish(extra: Record<string, unknown> = {}): Promise<void> {
    const { w, h } = this.size();
    const overflow = await this.page.evaluate(() => ({
      document_scroll_width: document.documentElement.scrollWidth,
      document_client_width: document.documentElement.clientWidth,
      document_scroll_height: document.documentElement.scrollHeight,
    }));
    const record = {
      id: this.id,
      viewport: `${w} x ${h}`,
      path: pathOf(this.page.url()),
      title: await this.page.title(),
      commit_prefix: EXPECTED_SHA,
      screenshots: this.shots,
      axe: await this.axe(),
      console_errors: this.consoleErrors,
      failed_requests: this.failedRequests,
      designed_aborts: this.designedAborts,
      page_size: overflow,
      sideways_scroll: overflow.document_scroll_width > overflow.document_client_width + 1,
      ...extra,
    };
    fs.writeFileSync(`${this.stem()}.json`, `${JSON.stringify(record, null, 2)}\n`);
    await this.testInfo.attach(`dv1-${this.id}-${w}x${h}`, { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
  }
}

/** A tagged request with exactly 3 photos (for the viewer), found through the API with the owner's session. */
export async function requestWithThreePhotos(api: StaffApi): Promise<Detail> {
  for (const item of await api.tagged(TAG)) {
    const detail = await api.get(item.id);
    if (detail.photo_count === 3) return detail;
  }
  throw new Error(`No ${TAG} request on staging has 3 photos. The QA1 spine test creates one.`);
}

/** The boxes of the viewer's parts and which of them the photo frame sits on. Recorded, never asserted. */
export async function viewerLayout(
  dialog: Locator,
  photo: Locator,
  reference: string,
): Promise<{ layout: Record<string, unknown>; covered: string[] }> {
  const boxOf = async (name: string, locator: Locator): Promise<[string, Box]> => {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`${name} has no box`);
    return [name, box];
  };
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
    await textBoxOf('reference and name line', dialog.getByText(reference)),
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
  const scroll = await dialog.evaluate((el) => ({ dialog_scroll_height: el.scrollHeight, dialog_client_height: el.clientHeight }));
  const gapAbove = (name: string) => {
    const box = others.find(([n]) => n === name)?.[1];
    return box ? Math.round((box.y - (frame[1].y + frame[1].height)) * 10) / 10 : null;
  };
  return {
    layout: {
      photo: frame[1],
      ...Object.fromEntries(others.map(([name, box]) => [name, box])),
      ...scroll,
      gap_between_photo_bottom_and_previous_photo_top: gapAbove('Previous photo'),
      aspect_ratio_of_photo: Math.round((frame[1].width / frame[1].height) * 1000) / 1000,
    },
    covered,
  };
}
