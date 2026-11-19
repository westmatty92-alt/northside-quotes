// tests/e2e/booking.spec.ts: TEMPLATE. Test names = AC ids from docs/test-plan.md.
import { test, expect } from './fixtures';

test.use({ storageState: '.auth/customer.json' });

test.describe('US-003 Book a slot', () => {
  test('AC-003.1 books an open slot @smoke', async ({ page, guard }) => {
    await page.goto('/bookings/new');
    await guard.axe();
    await page.getByRole('button', { name: /10:00/ }).click();
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByRole('status')).toContainText('Booked');
    await expect(page).toHaveURL(/\/bookings\/[\w-]+$/);
  });

  test('AC-003.2 slot taken shows next 3 slots @regression', async ({ page, guard }) => {
    guard.allowStatus(/\/api\/bookings$/, 409);                       // the AC expects this conflict
    await page.goto('/bookings/new?slot=taken-fixture');
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByRole('alert')).toContainText('just been taken');
    await expect(page.getByRole('list', { name: 'Next available' }).getByRole('listitem')).toHaveCount(3);
  });
});
