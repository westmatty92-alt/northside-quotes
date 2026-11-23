// Shared fixtures. Every test, automatically:
//   - gets the Vercel protection bypass on requests for the preview host only (never *.supabase.co),
//   - fails on console errors and unexpected failed requests (4xx/5xx the test did not declare),
//   - can run axe (WCAG 2.1 A/AA, fails on serious or critical violations, per the PRD),
//   - attaches every request id it saw, for the bug ticket.
import fs from 'node:fs';
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Request,
} from '@playwright/test';
import { bypassHeaders, credentials, runId, stagingHost, statePath, type Role } from './env';
import { StaffApi, accessTokenFromState, newApi } from './api';
import { pathIs } from './paths';

const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: unknown[] }>;
}

export interface Guard {
  /** Declare a response status this test expects (for example the 409 of a stale save). */
  allowStatus: (pattern: RegExp, status: number) => void;
  /** Declare requests this test aborts on purpose (a simulated network drop). */
  allowAbort: (pattern: RegExp) => void;
  /** Watch another page or context (a second signed-in user) with the same rules. */
  watchContext: (context: BrowserContext) => void;
  /** axe at WCAG 2.1 A and AA: fails on serious or critical violations; lesser ones are attached. */
  axe: (label: string, page?: Page) => Promise<void>;
}

export interface StaffSession {
  context: BrowserContext;
  page: Page;
  api: StaffApi;
}

export interface Fixtures {
  guard: Guard;
  bypass: void;
  run: { id: string; tag: (label: string) => string };
  /** A second browser signed in as a role (for example the helper beside the owner). `extra` can add touch input or another viewport. */
  openStaff: (role: Role, extra?: BrowserContextOptions) => Promise<StaffSession>;
  openAnon: () => Promise<{ context: BrowserContext; page: Page }>;
  staffApi: (role: Role) => Promise<StaffApi>;
}

/** Attach the bypass headers to the first navigation of a context, and only for the preview host. */
export async function installBypass(context: BrowserContext): Promise<void> {
  const host = stagingHost();
  let first = true;
  await context.route(
    (url) => url.host === host,
    async (route) => {
      if (first && route.request().isNavigationRequest()) {
        first = false;
        await route.continue({ headers: { ...route.request().headers(), ...bypassHeaders() } });
        return;
      }
      await route.fallback();
    },
  );
}

function contextOptionsOf(project: Record<string, unknown>): BrowserContextOptions {
  const pick = ['viewport', 'isMobile', 'hasTouch', 'deviceScaleFactor', 'userAgent', 'locale', 'timezoneId', 'baseURL'] as const;
  const out: Record<string, unknown> = {};
  for (const key of pick) if (project[key] !== undefined) out[key] = project[key];
  return out as BrowserContextOptions;
}

export async function newStaffContext(
  browser: Browser,
  role: Role,
  project: Record<string, unknown>,
  extra: BrowserContextOptions = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ ...contextOptionsOf(project), ...extra, storageState: statePath(role) });
  await installBypass(context);
  return context;
}

/** A signed-out browser context with the project's device settings (for a second person, such as the homeowner). */
export async function newAnonContext(browser: Browser, project: Record<string, unknown>): Promise<BrowserContext> {
  const context = await browser.newContext({ ...contextOptionsOf(project), storageState: { cookies: [], origins: [] } });
  await installBypass(context);
  return context;
}

/**
 * Sign out revokes every session of that user (Supabase's default scope), including the saved one the other specs
 * use. A test that signs out calls this afterwards to sign in again and write a fresh saved session.
 */
export async function renewSession(browser: Browser, role: Role, project: Record<string, unknown>): Promise<void> {
  const context = await newAnonContext(browser, project);
  const page = await context.newPage();
  const { email, password } = credentials(role);
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(pathIs('/requests'));
  await context.storageState({ path: statePath(role) });
  await context.close();
}

export const test = base.extend<Fixtures>({
  bypass: [
    async ({ context }, provide) => {
      await installBypass(context);
      await provide();
    },
    { auto: true },
  ],

  guard: [
    async ({ page, context }, provide, testInfo) => {
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];
      const abortedNoise: string[] = [];
      const requestIds: string[] = [];
      const allowedStatus: Array<{ pattern: RegExp; status: number }> = [];
      const allowedAbort: RegExp[] = [];
      const watched = new WeakSet<Page>();

      const statusAllowed = (url: string, status: number) => allowedStatus.some((a) => a.status === status && a.pattern.test(url));
      const abortAllowed = (url: string) => allowedAbort.some((p) => p.test(url));

      const watch = (p: Page) => {
        if (watched.has(p)) return;
        watched.add(p);
        p.on('console', (m) => {
          if (m.type() !== 'error') return;
          const text = m.text();
          const failedLoad = text.match(/^Failed to load resource: (?:the server responded with a status of (\d+)|net::(ERR_\w+))/);
          if (failedLoad) {
            const url = m.location().url;
            if (failedLoad[1] && statusAllowed(url, Number(failedLoad[1]))) return;
            if (failedLoad[2] && (abortAllowed(url) || failedLoad[2] === 'ERR_ABORTED')) return;
          }
          consoleErrors.push(text.slice(0, 400));
        });
        p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 400)}`));
        p.on('requestfailed', (r: Request) => {
          const error = r.failure()?.errorText ?? 'failed';
          const line = `${r.method()} ${r.url().slice(0, 200)} ${error}`;
          if (error === 'net::ERR_ABORTED') return void abortedNoise.push(line); // navigation cancelled it; listed in the attachment
          if (abortAllowed(r.url())) return;
          failedRequests.push(line);
        });
        p.on('response', (r) => {
          const id = r.headers()['x-vercel-id'];
          const url = r.url();
          if (id && url.includes('/api/')) requestIds.push(`${r.status()} ${r.request().method()} ${new URL(url).pathname} ${id}`);
          if (r.status() >= 400 && !statusAllowed(url, r.status())) {
            failedRequests.push(`${r.status()} ${r.request().method()} ${url.slice(0, 200)} x-vercel-id=${id ?? 'n/a'}`);
          }
        });
      };

      watch(page);
      context.on('page', watch);

      await provide({
        allowStatus: (pattern, status) => void allowedStatus.push({ pattern, status }),
        allowAbort: (pattern) => void allowedAbort.push(pattern),
        watchContext: (c) => {
          for (const p of c.pages()) watch(p);
          c.on('page', watch);
        },
        axe: async (label, p = page) => {
          await p.evaluate(AXE_SOURCE);
          const result = await p.evaluate(async () => {
            const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
            return axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
          });
          const lines = (v: AxeViolation[]) => v.map((x) => `${x.id} [${x.impact}] ${x.help}: ${x.nodes.length} node(s), first ${JSON.stringify(x.nodes[0]?.target)}`);
          const hard = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
          const soft = result.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
          await testInfo.attach(`axe-${label}`, { body: JSON.stringify({ serious_or_critical: lines(hard), minor_or_moderate: lines(soft) }, null, 2), contentType: 'application/json' });
          if (soft.length) testInfo.annotations.push({ type: 'axe-minor', description: `${label}: ${lines(soft).join(' | ')}` });
          expect(lines(hard), `axe serious/critical violations on ${label}`).toEqual([]);
        },
      });

      await testInfo.attach('request-ids', { body: requestIds.join('\n') || '(none)', contentType: 'text/plain' });
      if (abortedNoise.length) await testInfo.attach('aborted-requests', { body: abortedNoise.join('\n'), contentType: 'text/plain' });
      expect(consoleErrors, 'console errors during the test').toEqual([]);
      expect(failedRequests, 'unexpected failed requests during the test').toEqual([]);
    },
    { auto: true },
  ],

  run: async ({}, provide) => {
    const id = runId();
    await provide({ id, tag: (label: string) => `QA-E2E ${id} ${label}`.slice(0, 100) });
  },

  openStaff: async ({ browser, guard, playwright }, provide, testInfo) => {
    const opened: BrowserContext[] = [];
    const requests: Array<{ dispose: () => Promise<void> }> = [];
    await provide(async (role, extra) => {
      const context = await newStaffContext(browser, role, testInfo.project.use as Record<string, unknown>, extra);
      opened.push(context);
      guard.watchContext(context);
      const page = await context.newPage();
      const request = await newApi(playwright, accessTokenFromState(role));
      requests.push(request);
      return { context, page, api: new StaffApi(request) };
    });
    for (const c of opened) await c.close();
    for (const r of requests) await r.dispose();
  },

  openAnon: async ({ browser, guard }, provide, testInfo) => {
    const opened: BrowserContext[] = [];
    await provide(async () => {
      const context = await newAnonContext(browser, testInfo.project.use as Record<string, unknown>);
      opened.push(context);
      guard.watchContext(context);
      return { context, page: await context.newPage() };
    });
    for (const c of opened) await c.close();
  },

  staffApi: async ({ playwright }, provide) => {
    const made: Array<{ dispose: () => Promise<void> }> = [];
    await provide(async (role) => {
      const request = await newApi(playwright, accessTokenFromState(role));
      made.push(request);
      return new StaffApi(request);
    });
    for (const m of made) await m.dispose();
  },
});

export { expect };
