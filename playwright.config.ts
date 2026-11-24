// playwright.config.ts (owned by bl-qa). Tests run against the staging Vercel preview only.
//
// - The base URL is STAGING_URL and must be a staging preview host, else this file throws.
// - .env.local is loaded here with process.loadEnvFile, so `npx playwright test` works as well as
//   `node --env-file=.env.local node_modules/.bin/playwright test`. Values are never printed.
// - The Vercel deployment-protection bypass headers are NOT set here (extraHTTPHeaders would reach
//   *.supabase.co and break the direct photo upload with CORS). tests/e2e/support/fixtures.ts attaches
//   them to requests for the preview host only.
import { defineConfig } from '@playwright/test';
import { loadEnv, runId, stagingUrl, EXPECTED_STAGING_HOST } from './tests/e2e/support/env';

loadEnv();
const base = stagingUrl(); // throws unless this is the staging preview
runId();
if (base.host !== EXPECTED_STAGING_HOST) {
  // Not fatal (it is still a staging preview), but the report must say so.
  console.warn(`[qa] STAGING_URL host differs from the expected ${EXPECTED_STAGING_HOST}`);
}

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1280, height: 800 } };

export default defineConfig({
  testDir: 'tests/e2e',
  // Shared staging, a per-address submission limit (5 accepted per 10 minutes) and one signed-in
  // pair of users: one worker, in file order. See tests/e2e/support/budget.ts.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  // One retry, for detection only: a test that fails then passes is reported FLAKY, never as a pass.
  // Tests that create requests set retries 0 themselves (a retry would spend more of the submission budget).
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: 'docs/qa-reports/playwright-results.json' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL: base.origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    // The deployed preview itself (health, form token, cache headers, /inbox). Needs no session, so it runs
    // even when sign-in setup fails: a broken preview must not hide behind "did not run".
    { name: 'preview', use: { ...desktop, browserName: 'chromium' }, testMatch: /platform\.both\.spec\.ts$/ },
    // Phone (390 x 844, touch). The projects run in this order with one worker, because the staff tests
    // work on the requests the first one creates:
    //   phone        the done spine and the other accepted submissions (5 accepted requests = the whole 10-minute budget)
    //   phone-staff  the form's refusals, the staff tabs, detail and board on a phone
    //   desktop      the same staff specs at 1280 px, plus sign-in and the board drag tests
    //   phone-late   the last 3 accepted requests, after the 10-minute window has passed
    {
      name: 'phone',
      use: { ...phone, browserName: 'chromium' },
      testMatch: /(spine|submissions)\.phone\.spec\.ts$/,
      dependencies: ['setup'],
    },
    {
      name: 'phone-staff',
      use: { ...phone, browserName: 'chromium' },
      testMatch: /\.(phone|both)\.spec\.ts$/,
      testIgnore: /(platform\.both|spine\.phone|submissions\.phone|late\.phone)\.spec\.ts$/,
      dependencies: ['setup'],
    },
    {
      name: 'desktop',
      use: { ...desktop, browserName: 'chromium' },
      testMatch: /\.(desktop|both)\.spec\.ts$/,
      testIgnore: /platform\.both\.spec\.ts$/,
      dependencies: ['setup'],
    },
    {
      name: 'phone-late',
      use: { ...phone, browserName: 'chromium' },
      testMatch: /late\.phone\.spec\.ts$/,
      dependencies: ['setup'],
    },
  ],
});
