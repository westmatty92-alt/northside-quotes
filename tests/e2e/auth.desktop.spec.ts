// US-004: staff sign-in, return to the tab opened, sign-out, no sign-up and no password reset.
// Lockout, address limits and the unavailable state are abuse probes and belong to QA2 (@probe), not this file.
import { test, expect, renewSession } from './support/fixtures';
import { describe, newApi, type Problem } from './support/api';
import { credentials } from './support/env';
import { pathIs, signInReturningTo } from './support/paths';
import type { Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function signInUi(page: Page, role: 'owner' | 'helper') {
  const { email, password } = credentials(role);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('sign-in', () => {
  // The sign-out test revokes the owner's sessions, including the saved one the other specs use: sign in again.
  test.afterAll(async ({ browser }, testInfo) => {
    await renewSession(browser, 'owner', testInfo.project.use as Record<string, unknown>);
  });

  test('@smoke AC-004.1 the owner lands on the Requests tab; the main navigation has Requests (current) and Pipeline', async ({ page, guard }) => {
    await page.goto('/sign-in');
    await signInUi(page, 'owner');
    await expect(page).toHaveURL(pathIs('/requests'));
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Requests' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Pipeline' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Pipeline' })).not.toHaveAttribute('aria-current', 'page');
    await guard.axe('requests-after-sign-in');
  });

  test('@regression AC-004.3 a signed-out visit to the Requests address goes to sign-in, then lands on Requests', async ({ page }) => {
    await page.goto('/requests');
    await expect(page).toHaveURL(signInReturningTo('/requests'));
    await signInUi(page, 'owner');
    await expect(page).toHaveURL(pathIs('/requests'));
  });

  test('@regression AC-004.14 a signed-out visit to the Pipeline address goes to sign-in, then lands on Pipeline', async ({ page }) => {
    await page.goto('/pipeline');
    await expect(page).toHaveURL(signInReturningTo('/pipeline'));
    await signInUi(page, 'owner');
    await expect(page).toHaveURL(pathIs('/pipeline'));
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pipeline' })).toHaveAttribute('aria-current', 'page');
  });

  test('@regression AC-004.9 after signing out the tab addresses send the owner to sign-in', async ({ page }) => {
    await page.goto('/sign-in');
    await signInUi(page, 'owner');
    await expect(page).toHaveURL(pathIs('/requests'));
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(pathIs('/sign-in'));
    await page.goto('/requests');
    await expect(page).toHaveURL(signInReturningTo('/requests'));
    await page.goto('/pipeline');
    await expect(page).toHaveURL(signInReturningTo('/pipeline'));
  });

  test('@regression AC-004.4 a wrong password and an unknown email show the same message', async ({ page, guard, run }) => {
    const { email } = credentials('owner');
    guard.allowStatus(/\/api\/auth\/sign-in$/, 401);
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const wrong = page.getByText('Email or password is incorrect');
    await expect(wrong).toBeVisible();
    const wrongText = (await wrong.first().innerText()).trim();

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(`qa-e2e-nobody-${run.id}@example.invalid`);
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const unknown = page.getByText('Email or password is incorrect');
    await expect(unknown).toBeVisible();
    expect((await unknown.first().innerText()).trim()).toBe(wrongText);
  });

  test('@regression AC-004.4 the sign-in route answers an unknown email with 401 invalid_credentials', async ({ playwright, run }) => {
    const anon = await newApi(playwright);
    const res = await anon.post('/api/auth/sign-in', { data: { email: `qa-e2e-nobody-api-${run.id}@example.invalid`, password: 'not-a-real-password-1' } });
    const problem = (await res.json().catch(() => ({}))) as Problem;
    expect(res.status(), await describe(res)).toBe(401);
    expect(problem.code).toBe('invalid_credentials');
    await anon.dispose();
  });

  test('@regression AC-004.6 AC-004.10 sign-in offers no sign-up, no forgot-password and no reset', async ({ page, guard }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    const forbidden = /sign up|signup|create (an )?account|register|forgot|reset|change (your )?password|magic link/i;
    await expect(page.getByRole('link', { name: forbidden })).toHaveCount(0);
    await expect(page.getByRole('button', { name: forbidden })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(forbidden);
    await guard.axe('sign-in-no-reset');
  });
});
