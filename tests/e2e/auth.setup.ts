// Setup project: signs in once per role through the real sign-in page and saves the session
// (git-ignored, playwright/.cache/auth/<role>.json). Specs reuse these sessions; they never sign in again
// except in the sign-in tests themselves. Also starts a fresh list of the test data this run creates.
import fs from 'node:fs';
import { test as setup, expect } from './support/fixtures';
import { AUTH_DIR, credentials, statePath, type Role } from './support/env';
import { resetCreatedList } from './support/budget';
import { pathIs } from './support/paths';

setup.describe.configure({ retries: 0 });

setup('start a fresh list of created test data', async () => {
  resetCreatedList();
});

for (const role of ['owner', 'helper'] as const satisfies readonly Role[]) {
  setup(`sign in as ${role} and save the session`, async ({ page }) => {
    const { email, password } = credentials(role);
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(pathIs('/requests'));
    await page.context().storageState({ path: statePath(role) });
  });
}
