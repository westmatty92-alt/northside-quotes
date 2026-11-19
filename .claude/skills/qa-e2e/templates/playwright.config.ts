// playwright.config.ts: TEMPLATE (owned by bl-qa). Tests run against the staging Vercel preview only.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL;
const PRODUCTION_HOSTS = (process.env.PRODUCTION_HOSTS ?? '').split(',').filter(Boolean); // set by DevOps, e.g. app.client.com
if (!BASE_URL) throw new Error('BASE_URL is required (the staging Vercel preview URL). Tests never run locally.');
if (PRODUCTION_HOSTS.includes(new URL(BASE_URL).host)) throw new Error(`Refusing to run against production (${BASE_URL}).`);

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,            // a pass on retry is reported as FLAKY, never as a pass (see qa-regression)
  reporter: [['list'], ['json', { outputFile: 'docs/qa-reports/playwright.json' }], ['html', { open: 'never', outputFolder: '.baseleap/reports/playwright-html' }]],
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },                          // creates tenant + per-role users, saves .auth/<role>.json
    { name: 'mobile', use: { ...devices['iPhone 13'] }, dependencies: ['setup'], testIgnore: /api\// },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } }, dependencies: ['setup'], testIgnore: /api\// },
    { name: 'embed', use: { viewport: { width: 400, height: 800 } }, dependencies: ['setup'], testMatch: /embed\.spec\.ts/ },
    { name: 'api', testMatch: /api\/.*\.spec\.ts/, dependencies: ['setup'] },
  ],
});
