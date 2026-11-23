// THE DONE SPINE (PRD "Rehearsal definition of done", Agent Execution Contract "Rehearsal done check").
//   1. A homeowner submits with 3 photos, offers box unticked.      AC-001.1, AC-002.1, AC-001.15, AC-003.1, AC-003.6, AC-001.12
//   2. She sees an NQ- reference number.                            AC-001.1, FR-2
//   3. The owner signs in and sees the request first on Requests.   AC-004.1, AC-005.2, AC-005.1
//   4. The owner adds a price and a note.                           AC-006.1
//   5. The owner marks it Won from the list, and the same on the board (Move to). AC-007.1, AC-016.2 (menu path), AC-016.4
//   6. The weekly count updates within 2 seconds.                   AC-008.2
// One journey, on a phone. It leaves the offers box unticked, so it never touches GoHighLevel.
import { test, expect } from './support/fixtures';
import { credentials, stagingHost } from './support/env';
import { pathIs, pathMatches } from './support/paths';
import { jpeg, MB } from './support/files';
import { RequestForm, REF_RE, columnOf, expectCount, moveTo, refLink, tabLink, validHomeowner } from './support/ui';
import { recordCreated } from './support/budget';

test.describe('done spine', () => {
  test.describe.configure({ retries: 0 }); // a retry would spend more of the 5-per-10-minutes submission budget

  test('@smoke the homeowner submits with 3 photos and the owner prices it and marks it Won on the list and on the board', async ({
    page,
    openAnon,
    guard,
    run,
    staffApi,
  }, testInfo) => {
    test.setTimeout(240_000);
    const ownerApi = await staffApi('owner');
    const name = run.tag('Spine Dana Whitfield');

    // ---- 1 and 2: the homeowner, on a phone ---------------------------------------------------------------------
    const hosts = new Set<string>();
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol.startsWith('http')) hosts.add(url.host);
    });
    const form = new RequestForm(page);
    await form.open();
    await expect(form.offers, 'the offers box is unticked when the page loads (AC-001.15)').not.toBeChecked();
    await expect(page.getByText('Northside will use these details to reply to your quote request. It will email you offers only if you tick the box.')).toBeVisible();

    const photos = [
      await jpeg(page, 'under-sink-1.jpg', 2 * MB, 200),
      await jpeg(page, 'under-sink-2.jpg', 2 * MB, 210),
      await jpeg(page, 'under-sink-3.jpg', 2 * MB, 220),
    ];
    await form.fill(validHomeowner(name, { photos }));
    await expect(page.getByRole('button', { name: /^Remove/ }), 'three photo rows with a Remove button each (AC-002.1)').toHaveCount(3);
    await expect(form.offers, 'filling the form does not tick the offers box').not.toBeChecked();
    await guard.axe('request-page-filled');

    await form.submit(testInfo);
    const reference = await form.confirmedReference();
    expect(reference).toMatch(REF_RE);
    recordCreated({ reference, name, note: 'done spine: 3 photos, offers unticked' });
    await testInfo.attach('reference', { body: reference, contentType: 'text/plain' });

    // AC-003.1, AC-003.6, AC-001.12: no puzzle, no third-party widget, no email or SMS service was called.
    const allowed = (h: string) => h === stagingHost() || /\.supabase\.co$/.test(h);
    expect([...hosts].filter((h) => !allowed(h)), 'hosts contacted other than the preview and Supabase').toEqual([]);
    await guard.axe('request-sent');

    // ---- 3: the owner signs in (the real sign-in page) and sees it first ------------------------------------------
    const { page: owner } = await openAnon(); // a second, signed-out phone: the owner's
    const { email, password } = credentials('owner');
    await owner.goto('/sign-in');
    await owner.getByLabel('Email').fill(email);
    await owner.getByLabel('Password', { exact: true }).fill(password);
    await owner.getByRole('button', { name: 'Sign in' }).click();
    await expect(owner).toHaveURL(pathIs('/requests'));
    await expect(tabLink(owner, 'Requests')).toHaveAttribute('aria-current', 'page');

    const first = owner.getByRole('link', { name: REF_RE }).first();
    await expect(first, 'the new request is the first row on Requests (AC-005.2)').toContainText(reference);
    await expect(owner.getByText(name).first()).toBeVisible();

    // ---- 4: price and note ---------------------------------------------------------------------------------------
    await refLink(owner, reference).click();
    await expect(owner).toHaveURL(pathMatches(/^\/requests\/[0-9a-f-]{36}$/));
    await expect(owner.getByRole('button', { name: /^Open photo \d of 3 at full size$/ }), 'all 3 photos are on the request (AC-002.1)').toHaveCount(3);
    await owner.getByLabel(/^Price/).fill('450.00');
    await owner.getByLabel(/^Note/).fill('Replace cartridge, 2 hours, can come Thursday');
    await owner.getByRole('button', { name: /Save price and note|Try saving again/ }).click();
    await expect(owner.getByText(/Saved\./)).toBeVisible();
    await owner.reload();
    await expect(owner.getByText('$450.00 CAD').first(), 'AC-006.1 the price survives a reload').toBeVisible();
    await expect(owner.getByLabel(/^Note/)).toHaveValue('Replace cartridge, 2 hours, can come Thursday');

    const id = owner.url().split('/').pop() as string;
    const stored = await ownerApi.get(id);
    expect(stored.price_cents, 'price stored to the cent').toBe(45000);
    expect(stored.status, 'saving a price never changes the status').toBe('new');
    expect(stored.marketing_consent, 'offers box was left unticked: consent no').toBe(false);
    expect(stored.marketing_consent_at).toBeNull();

    // ---- 5 and 6a: Won from the list; the weekly count moves within 2 seconds ------------------------------------
    await owner.getByRole('link', { name: /Back to Requests/ }).click();
    await expect(owner).toHaveURL(pathIs('/requests'));
    const beforeList = await ownerApi.weekly();
    await moveTo(owner, reference, 'won');
    await expectCount(owner, 'Won', beforeList.won + 1, 2_000);
    expect((await ownerApi.get(id)).status, 'AC-007.1 stored status').toBe('won');
    expect((await ownerApi.get(id)).status_changed_at, 'the status change time is stored').not.toBeNull();
    expect((await ownerApi.weekly()).won).toBe(beforeList.won + 1);

    // ---- 5 and 6b: and the same on the board ----------------------------------------------------------------------
    await ownerApi.setStatus(id, 'new'); // put it back so the board can move it to Won again
    const beforeBoard = await ownerApi.weekly();
    await tabLink(owner, 'Pipeline').click();
    await expect(owner).toHaveURL(pathIs('/pipeline'));
    await expect.poll(() => columnOf(owner, reference), { message: 'card starts in the New column' }).toBe('New');
    await moveTo(owner, reference, 'won');
    await expect.poll(() => columnOf(owner, reference), { message: 'AC-016.2 card is in Won' }).toBe('Won');
    await expectCount(owner, 'Won', beforeBoard.won + 1, 2_000);
    await owner.reload();
    await expect.poll(() => columnOf(owner, reference), { message: 'the move survives a reload' }).toBe('Won');
    expect((await ownerApi.get(id)).status).toBe('won');

    // AC-016.4: the list shows it at its time position with status Won.
    await tabLink(owner, 'Requests').click();
    await expect(owner).toHaveURL(pathIs('/requests'));
    await expect(owner.getByRole('link', { name: REF_RE }).first()).toContainText(reference);
    await expect(owner.locator('tr, li, article').filter({ hasText: reference }).first()).toContainText('Won');
  });
});
