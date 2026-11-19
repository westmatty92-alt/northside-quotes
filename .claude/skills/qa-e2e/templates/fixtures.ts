// tests/e2e/fixtures.ts: TEMPLATE. Every test fails on console errors or unexpected failed requests,
// runs axe on demand, and records request ids for the bug ticket.
import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type Guard = { allowStatus: (pattern: RegExp, status: number) => void; axe: (page?: Page) => Promise<void> };

export const test = base.extend<{ guard: Guard }>({
  guard: [async ({ page }, use, testInfo) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const requestIds: string[] = [];
    const allowed: Array<{ pattern: RegExp; status: number }> = [];

    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
    page.on('response', async (r) => {
      const id = r.headers()['x-request-id'];
      if (id) requestIds.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname} ${id}`);
      if (r.status() >= 400 && !allowed.some((a) => a.pattern.test(r.url()) && a.status === r.status())) {
        failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`);
      }
    });

    await use({
      allowStatus: (pattern, status) => allowed.push({ pattern, status }),       // e.g. the 409 an AC expects
      axe: async (p = page) => {
        const { violations } = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`), 'axe violations').toEqual([]);
      },
    });

    await testInfo.attach('request-ids', { body: requestIds.join('\n') || '(none)', contentType: 'text/plain' });
    expect(consoleErrors, 'console errors during the test').toEqual([]);
    expect(failedRequests, 'unexpected failed requests during the test').toEqual([]);
  }, { auto: true }],
});

export { expect };
