// Evidence for the FE2 visual run (STEP FE2V). For each screen and width this records, next to the screenshot:
//   - console errors and failed requests (4xx/5xx and network failures), minus the ones the test declares as a
//     designed error state,
//   - the full axe result (all violations), failing the test on serious or critical ones,
//   - the page's address (path only), title and viewport.
// Files go to docs/qa-reports/visual/FE2/<width>/<id>.png and <id>.json. No cookies, tokens, signed URLs or
// personal data are written: paths only (never a query string), and the fixture's request ids.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export const EVIDENCE_DIR = path.resolve(__dirname, '../../../docs/qa-reports/visual/FE2');

const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface AxeNode {
  target: unknown[];
}
interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: AxeNode[];
}

export interface Designed {
  /** A response status this screen's designed error state produces, for example 401 on the sign-in route. */
  status: number;
  /** Matched against the request's path (no host, no query). */
  path: RegExp;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '(unparsable)';
  }
}

function hostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparsable)';
  }
}

export class Evidence {
  private readonly consoleErrors: string[] = [];
  private readonly failedRequests: string[] = [];
  private readonly designedResponses: string[] = [];
  private readonly aborted: string[] = [];

  constructor(
    private readonly page: Page,
    private readonly testInfo: TestInfo,
    private readonly id: string,
    private readonly designed: Designed[] = [],
  ) {
    const isDesigned = (url: string, status: number) => this.designed.some((d) => d.status === status && d.path.test(pathOf(url)));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      const failedLoad = text.match(/^Failed to load resource: (?:the server responded with a status of (\d+)|net::(ERR_\w+))/);
      if (failedLoad) {
        if (failedLoad[1] && isDesigned(m.location().url, Number(failedLoad[1]))) return;
        if (failedLoad[2] === 'ERR_ABORTED') return;
      }
      this.consoleErrors.push(`${text.slice(0, 300)} [${hostPath(m.location().url)}]`);
    });
    page.on('pageerror', (e) => this.consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on('requestfailed', (r) => {
      const error = r.failure()?.errorText ?? 'failed';
      const line = `${r.method()} ${hostPath(r.url())} ${error}`;
      if (error === 'net::ERR_ABORTED') this.aborted.push(line);
      else this.failedRequests.push(line);
    });
    page.on('response', (r) => {
      if (r.status() < 400) return;
      const line = `${r.status()} ${r.request().method()} ${hostPath(r.url())} x-vercel-id=${r.headers()['x-vercel-id'] ?? 'n/a'}`;
      if (isDesigned(r.url(), r.status())) this.designedResponses.push(line);
      else this.failedRequests.push(line);
    });
  }

  private width(): number {
    const size = this.page.viewportSize();
    if (!size) throw new Error('no viewport');
    return size.width;
  }

  private file(ext: 'png' | 'json'): string {
    const dir = path.join(EVIDENCE_DIR, String(this.width()));
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${this.id}.${ext}`);
  }

  /** Wait until every image on the page has either decoded or failed, so the screenshot is not taken mid-load. */
  async imagesSettled(): Promise<void> {
    await expect
      .poll(() => this.page.evaluate(() => [...document.images].every((img) => img.complete)), { message: 'images finished loading' })
      .toBe(true);
  }

  /** Screenshot: the whole page, or one element (the SCR-07 strip). Animations are frozen so the shot is stable. */
  async shoot(target?: Locator): Promise<string> {
    const file = this.file('png');
    if (target) await target.screenshot({ path: file, animations: 'disabled' });
    else await this.page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    return path.relative(EVIDENCE_DIR, file);
  }

  /**
   * The viewport only, as shown. For a dialog fixed to the screen (SCR-08): a full-page shot places it at the scroll
   * offset in the middle of the stitched page, which is not what a person sees.
   */
  async shootViewport(): Promise<string> {
    const file = this.file('png');
    await this.page.screenshot({ path: file, animations: 'disabled' });
    return path.relative(EVIDENCE_DIR, file);
  }

  /** What a person sees first: the viewport only (390 x 844 or 1280 x 800), for tall pages that a full-page shot shrinks past reading. */
  async shootTop(): Promise<string> {
    const file = path.join(path.dirname(this.file('png')), `${this.id}-top.png`);
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.screenshot({ path: file, animations: 'disabled' });
    return path.relative(EVIDENCE_DIR, file);
  }

  /** axe at WCAG 2.0 and 2.1 A and AA, the same tags as the shared fixture. Returns every violation, not only the failing ones. */
  private async axe(): Promise<AxeViolation[]> {
    await this.page.evaluate(AXE_SOURCE);
    return this.page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) }));
    });
  }

  /**
   * Take the screenshot and run axe, write the evidence file, then assert: no serious or critical axe violation,
   * no console error, no failed request beyond the declared designed ones. The assertions come last so the evidence
   * file exists for a failing run too.
   */
  async finish(screenshot: string, extra: Record<string, unknown> = {}): Promise<void> {
    const violations = await this.axe();
    const hard = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const soft = violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
    const summary = (v: AxeViolation[]) => v.map((x) => `${x.id} [${x.impact}] ${x.help}: ${x.nodes.length} node(s), first ${JSON.stringify(x.nodes[0]?.target)}`);
    const record = {
      id: this.id,
      width: this.width(),
      path: pathOf(this.page.url()),
      title: await this.page.title(),
      screenshot,
      axe: { serious_or_critical: summary(hard), minor_or_moderate: summary(soft) },
      console_errors: this.consoleErrors,
      failed_requests: this.failedRequests,
      designed_error_responses: this.designedResponses,
      aborted_by_navigation: this.aborted.length,
      ...extra,
    };
    fs.writeFileSync(this.file('json'), `${JSON.stringify(record, null, 2)}\n`);
    await this.testInfo.attach(`evidence-${this.id}`, { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
    expect(summary(hard), `axe serious/critical violations on ${this.id}`).toEqual([]);
    expect(this.consoleErrors, `console errors on ${this.id}`).toEqual([]);
    expect(this.failedRequests, `failed requests on ${this.id}`).toEqual([]);
  }
}
