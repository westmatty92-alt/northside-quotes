// Every screen renders for its audience, passes axe (WCAG 2.1 AA, no serious or critical violations), and the
// page structure (accessibility tree) is kept as evidence in the test output folder.
// FR-5, AC-001.11, AC-001.18, AC-016.16, AC-016.20, FR-26.
import fs from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { statePath } from './support/env';
import { must } from './support/pool';

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  const tree = await page.locator('body').ariaSnapshot();
  fs.writeFileSync(testInfo.outputPath(`aria-${name}.txt`), tree);
  await testInfo.attach(`aria-${name}`, { body: tree, contentType: 'text/plain' });
}

test.describe('public screens', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@regression AC-001.11 AC-001.18 Request page: structure and axe', async ({ page, guard }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await snapshot(page, testInfo, 'request-page');
    await guard.axe('request-page');
  });

  test('@regression AC-004.1 Sign-in page: structure and axe', async ({ page, guard }, testInfo) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await snapshot(page, testInfo, 'sign-in');
    await guard.axe('sign-in');
  });
});

test.describe('staff screens', () => {
  test.use({ storageState: statePath('owner') });

  test('@regression AC-016.16 AC-005.10 Requests, Pipeline and detail: structure and axe', async ({ page, guard, staffApi }, testInfo) => {
    await page.goto('/requests');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await snapshot(page, testInfo, 'requests');
    await guard.axe('requests');

    await page.goto('/pipeline');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await snapshot(page, testInfo, 'pipeline');
    await guard.axe('pipeline');

    const api = await staffApi('owner');
    const first = must((await api.list({ limit: 1 })).data[0], 'at least one submitted request on staging');
    await page.goto(`/requests/${first.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await snapshot(page, testInfo, 'request-detail');
    await guard.axe('request-detail');
  });
});
