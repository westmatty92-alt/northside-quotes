// QA2 probes, part 5: what a signed-in staff member (or a script holding her token) can and cannot do through the API,
// and what the staff screens do with the script text a homeowner sent. Works on this run's "QA-PROBE <run id>" requests
// (created in 40-public-form) and puts price, note and status back when it is done.
//   PRB-40  mass assignment on the staff writes: extra fields are refused or ignored, never applied
//   PRB-41  write boundaries: price, note, version, status; explicit null; stale version
//   PRB-42  AC-014.4  a copy retry on an unticked request is 409 not_retryable and changes nothing
//   PRB-43  AC-001.5  stored script text renders as text on the list, the board and the detail, on a phone and a desktop
import { test, expect, newAnonContext } from '../support/fixtures';
import type { Detail, ListItem } from '../support/api';
import { pathIs } from '../support/paths';
import { credentials } from '../support/env';
import { ChangeQuoteRequestStatusResponse, SaveQuoteResponse } from '../../../src/lib/api/generated/index.zod';
import { appApi, contractIssues, expectNone, isProblemJson, leaks, line, lineWithBody, newUuid, probeTag, problemOf, staffToken, XSS_IMG, XSS_SCRIPT } from './support';
import type { APIRequestContext } from '@playwright/test';

/** This run's probe requests; when this run made none (a partial re-run), the probe requests of earlier runs. */
async function probeRequests(owner: APIRequestContext): Promise<ListItem[]> {
  for (const prefix of [probeTag(), 'QA-PROBE']) {
    const res = await owner.get(`/api/quote-requests?q=${encodeURIComponent(prefix)}&limit=100`);
    if (res.status() !== 200) throw new Error(`could not list the probe requests: ${line('GET list', res)}`);
    const found = ((await res.json()) as { data: ListItem[] }).data.filter((r) => r.name.startsWith(prefix));
    if (found.length > 0) return found;
  }
  return [];
}

async function detailOf(owner: APIRequestContext, id: string): Promise<Detail> {
  const res = await owner.get(`/api/quote-requests/${id}`);
  if (res.status() !== 200) throw new Error(`could not read ${id}: ${line('GET detail', res)}`);
  return (await res.json()) as Detail;
}

/** Put price, note and status back to the defaults (new, no price, no note). */
async function reset(owner: APIRequestContext, id: string): Promise<void> {
  let d = await detailOf(owner, id);
  if (d.price_cents !== null || d.note !== null) {
    await owner.put(`/api/quote-requests/${id}/quote`, { data: { price_cents: null, note: null, version: d.version } });
    d = await detailOf(owner, id);
  }
  if (d.status !== 'new') await owner.post(`/api/quote-requests/${id}/status-changes`, { data: { to_status: 'new', version: d.version } });
}

test.describe('staff write boundaries and stored script text @probe', () => {
  test('@probe PRB-40 extra fields on the staff writes (status, reference, consent, id, from_status, changed_by) are refused or ignored, never applied', async ({ playwright }, testInfo) => {
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const items = await probeRequests(owner);
    const target = items[0];
    if (!target) throw new Error('no QA-PROBE request exists: 40-public-form must run first');
    const failures: string[] = [];
    const base = await detailOf(owner, target.id);
    try {
      const extras = { status: 'won', reference: 'NQ-AAAAAA', marketing_consent: true, marketing_consent_at: '2000-01-01T00:00:00Z', id: newUuid(), ghl_contact_id: 'abc', state: 'pending', submitted_at: '2000-01-01T00:00:00Z' };
      const put = await owner.put(`/api/quote-requests/${target.id}/quote`, { data: { price_cents: 12345, note: 'qa-probe mass assignment', version: base.version, ...extras } });
      if (![200, 400, 422].includes(put.status())) failures.push(`${await lineWithBody('PUT quote with extra fields', put)} expected 200 (extras ignored), 400 or 422`);
      const afterPut = await detailOf(owner, target.id);
      for (const [field, wanted] of [['status', base.status], ['reference', base.reference], ['marketing_consent', false], ['marketing_consent_at', null], ['id', base.id], ['submitted_at', base.submitted_at]] as const) {
        if ((afterPut as unknown as Record<string, unknown>)[field] !== wanted) failures.push(`PUT quote with extras changed ${field}`);
      }
      if (put.status() !== 200 && (afterPut.price_cents !== base.price_cents || afterPut.note !== base.note)) failures.push('PUT quote was refused but price or note changed');
      await reset(owner, target.id);

      const fresh = await detailOf(owner, target.id);
      const post = await owner.post(`/api/quote-requests/${target.id}/status-changes`, {
        data: { to_status: 'quoted', version: fresh.version, from_status: 'won', changed_by: newUuid(), status_changed_at: '2000-01-01T00:00:00Z', price_cents: 1, reference: 'NQ-AAAAAA', marketing_consent: true },
      });
      if (![200, 201, 400, 422].includes(post.status())) failures.push(`${await lineWithBody('POST status change with extra fields', post)} expected 201 (extras ignored), 400 or 422`);
      const afterPost = await detailOf(owner, target.id);
      if (afterPost.price_cents !== null) failures.push('POST status change with extras set a price');
      if (afterPost.reference !== base.reference) failures.push('POST status change with extras changed the reference');
      if (afterPost.marketing_consent !== false) failures.push('POST status change with extras set consent');
      if (afterPost.status_changed_at && new Date(afterPost.status_changed_at).getFullYear() < 2020) failures.push('POST status change with extras let the caller set status_changed_at');
      if (post.status() !== 201 && afterPost.status !== base.status) failures.push('POST status change was refused but the status changed');
    } finally {
      await reset(owner, target.id);
    }
    await owner.dispose();
    await expectNone(testInfo, failures, 'mass assignment on staff writes');
  });

  test('@probe PRB-41 write boundaries: price, note, version and status are validated (422 with the field, 409 stale, explicit null accepted where optional), never a 5xx', async ({ playwright }, testInfo) => {
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const items = await probeRequests(owner);
    const target = items[1] ?? items[0];
    if (!target) throw new Error('no QA-PROBE request exists: 40-public-form must run first');
    const failures: string[] = [];
    const version = async () => (await detailOf(owner, target.id)).version;
    const check = async (label: string, res: Awaited<ReturnType<APIRequestContext['put']>>, statuses: number[], field?: RegExp) => {
      if (!statuses.includes(res.status())) {
        failures.push(`${await lineWithBody(label, res)} expected ${statuses.join(' or ')}`);
        return;
      }
      if (res.status() >= 400) {
        if (!isProblemJson(res)) failures.push(`${line(label, res)} not problem+json`);
        const leak = await leaks(res);
        if (leak) failures.push(`${line(label, res)} leaks "${leak}"`);
        if (field && res.status() === 422) {
          const problem = await problemOf(res);
          if (!problem?.errors?.some((e) => field.test(e.field))) failures.push(`${line(label, res)} 422 does not name the field (${field.source}) in errors[]`);
        }
      }
    };
    try {
      const v = await version();
      const quote = (data: unknown, label: string, statuses: number[], field?: RegExp) => owner.put(`/api/quote-requests/${target.id}/quote`, { data }).then((res) => check(`PUT quote [${label}]`, res, statuses, field));
      await quote({ price_cents: 0, note: null, version: v }, 'price 0', [422], /price/);
      await quote({ price_cents: 10_000_000, note: null, version: v }, 'price 100000.00', [422], /price/);
      await quote({ price_cents: -5, note: null, version: v }, 'price -5', [422], /price/);
      await quote({ price_cents: 1.5, note: null, version: v }, 'price 1.5 cents', [422], /price/);
      await quote({ price_cents: '450', note: null, version: v }, 'price as text', [400, 422], /price/);
      await quote({ price_cents: true, note: null, version: v }, 'price true', [400, 422], /price/);
      await quote({ price_cents: null, note: 'x'.repeat(1001), version: v }, 'note 1001 characters', [422], /note/);
      await quote({ price_cents: null, note: 42, version: v }, 'note a number', [400, 422], /note/);
      await quote({ note: null, version: v }, 'price_cents missing', [400, 422], /price/);
      await quote({ price_cents: null, version: v }, 'note missing', [400, 422], /note/);
      await quote({ price_cents: null, note: null }, 'version missing', [400, 422], /version/);
      await quote({ price_cents: null, note: null, version: 0 }, 'version 0', [422], /version/);
      await quote({ price_cents: null, note: null, version: -1 }, 'version -1', [422], /version/);
      await quote({ price_cents: null, note: null, version: '1' }, 'version as text', [400, 422], /version/);
      await quote({ price_cents: null, note: null, version: null }, 'version null', [400, 422], /version/);
      await quote({ price_cents: null, note: null, version: 1.5 }, 'version 1.5', [422], /version/);
      await quote({ price_cents: null, note: null, version: v + 100 }, 'stale version', [409]);

      const raw = await owner.put(`/api/quote-requests/${target.id}/quote`, { headers: { 'content-type': 'application/json' }, data: Buffer.from('{not json') });
      await check('PUT quote [malformed JSON]', raw, [400]);
      const empty = await owner.put(`/api/quote-requests/${target.id}/quote`, { headers: { 'content-type': 'application/json' }, data: Buffer.from('') });
      await check('PUT quote [empty body]', empty, [400, 422]);

      // Valid edges are accepted and stored as given (each one re-read), then cleared.
      const accepted: Array<[string, Record<string, unknown>]> = [
        ['price 1 cent', { price_cents: 1, note: null }],
        ['price 9999999', { price_cents: 9_999_999, note: null }],
        ['note 1000 characters', { price_cents: null, note: 'n'.repeat(1000) }],
        ['note with emoji and accents', { price_cents: null, note: '💥 Réparation: tête de robinet' }],
        ['note with script text', { price_cents: null, note: `${XSS_IMG} ${XSS_SCRIPT}` }],
        ['both null', { price_cents: null, note: null }],
        ['empty note', { price_cents: null, note: '' }],
      ];
      for (const [label, body] of accepted) {
        const res = await owner.put(`/api/quote-requests/${target.id}/quote`, { data: { ...body, version: await version() } });
        await check(`PUT quote [${label}]`, res, [200]);
        if (res.status() === 200) {
          failures.push(...contractIssues(SaveQuoteResponse, await res.json(), `PUT quote [${label}] 200`));
          const d = await detailOf(owner, target.id);
          if (d.price_cents !== body['price_cents']) failures.push(`PUT quote [${label}] price_cents stored as ${String(d.price_cents)}`);
          const wantedNote = body['note'] === '' ? null : body['note'];
          if (d.note !== wantedNote) failures.push(`PUT quote [${label}] note was not stored as sent`);
        }
      }

      const status = (data: unknown, label: string, statuses: number[], field?: RegExp) => owner.post(`/api/quote-requests/${target.id}/status-changes`, { data }).then((res) => check(`POST status [${label}]`, res, statuses, field));
      const sv = await version();
      await status({ to_status: 'paid', version: sv }, 'to_status paid', [422], /to_status|status/);
      await status({ to_status: 'WON', version: sv }, 'to_status upper case', [422], /to_status|status/);
      await status({ to_status: null, version: sv }, 'to_status null', [400, 422], /to_status|status/);
      await status({ version: sv }, 'to_status missing', [400, 422], /to_status|status/);
      await status({ to_status: 'won' }, 'version missing', [400, 422], /version/);
      await status({ to_status: 'won', version: null }, 'version null', [400, 422], /version/);
      await status({ to_status: 'won', version: 0 }, 'version 0', [422], /version/);
      await status({ to_status: 'won', version: sv + 100 }, 'stale version', [409]);
      const same = await owner.post(`/api/quote-requests/${target.id}/status-changes`, { data: { to_status: 'new', version: sv } });
      await check('POST status [current status again]', same, [200]);
      if (same.status() === 200) {
        const sameBody: unknown = await same.json();
        failures.push(...contractIssues(ChangeQuoteRequestStatusResponse, sameBody, 'POST status [current status again] 200'));
        if ((sameBody as { changed?: boolean }).changed !== false) failures.push('POST status to the current status reported changed true');
      }
    } finally {
      await reset(owner, target.id);
    }
    await owner.dispose();
    await expectNone(testInfo, failures, 'staff write boundaries');
  });

  test('@probe PRB-42 AC-014.4 a copy retry on an unticked request is 409 not_retryable and changes nothing', async ({ playwright }, testInfo) => {
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const target = (await probeRequests(owner))[2] ?? (await probeRequests(owner))[0];
    if (!target) throw new Error('no QA-PROBE request exists: 40-public-form must run first');
    const before = await detailOf(owner, target.id);
    const res = await owner.post(`/api/quote-requests/${target.id}/ghl-copy-retries`);
    const problem = await problemOf(res);
    const failures: string[] = [];
    if (res.status() !== 409 || problem?.code !== 'not_retryable') failures.push(`${await lineWithBody('POST ghl-copy-retries on an unticked request', res)} expected 409 not_retryable`);
    const after = await detailOf(owner, target.id);
    if (JSON.stringify(after.ghl) !== JSON.stringify(before.ghl) || after.version !== before.version) failures.push('the refused retry changed the request or its GoHighLevel state');
    await owner.dispose();
    await expectNone(testInfo, failures, 'copy retry boundary');
  });

  test('@probe PRB-44 an unpaired surrogate or invalid UTF-8 in the staff note or in the search text is refused or handled, never a 5xx', async ({ playwright }, testInfo) => {
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const items = await probeRequests(owner);
    const target = items[3] ?? items[0];
    if (!target) throw new Error('no QA-PROBE request exists: 40-public-form must run first');
    const failures: string[] = [];
    try {
      for (const [label, note] of [
        ['note with a lone high surrogate', 'Replace the tap \ud800 and check the trap'],
        ['note with a lone low surrogate', 'Replace the tap \udc00 and check the trap'],
        ['note with a NUL character', 'Replace the tap \u0000 and check the trap'],
      ] as const) {
        const d = await detailOf(owner, target.id);
        const res = await owner.put(`/api/quote-requests/${target.id}/quote`, { data: { price_cents: null, note, version: d.version } });
        if (res.status() >= 500) failures.push(`${await lineWithBody(`PUT quote [${label}]`, res)} a server error`);
        else if (res.status() >= 400 && !isProblemJson(res)) failures.push(`${await lineWithBody(`PUT quote [${label}]`, res)} an error that is not problem+json`);
      }
      for (const [label, query] of [
        ['search with an encoded lone surrogate', 'q=%ED%A0%80'],
        ['search with invalid UTF-8', 'q=%FF%FE'],
        ['search with a NUL byte', 'q=a%00b'],
        ['cursor with invalid UTF-8', 'cursor=%FF%FE'],
      ] as const) {
        const res = await owner.get(`/api/quote-requests?${query}`);
        if (res.status() >= 500) failures.push(`${await lineWithBody(`list [${label}]`, res)} a server error`);
      }
    } finally {
      await reset(owner, target.id);
    }
    await owner.dispose();
    await expectNone(testInfo, failures, 'invalid text in staff inputs');
  });

  test('@probe PRB-45 BUG-QA2-4 a huge version (above the 32-bit integer limit) on a quote save or a status change is 409 stale_version or 422 naming version, never a 5xx, and changes nothing', async ({ playwright }, testInfo) => {
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const items = await probeRequests(owner);
    const target = items[4] ?? items[0];
    if (!target) throw new Error('no QA-PROBE request exists: 40-public-form must run first');
    const failures: string[] = [];
    // Written as raw JSON text: the last two are beyond what a JavaScript number holds exactly, and must still arrive as sent.
    const hugeVersions = ['2147483647', '2147483648', '10000000001', '367499305219', '9007199254740991', '1687381385382380550179543211573248'];
    try {
      const before = await detailOf(owner, target.id);
      const otherStatus = before.status === 'won' ? 'lost' : 'won';
      const requests: Array<[string, string]> = [
        ['an existing request', target.id],
        ['an unknown request id', newUuid()],
      ];
      for (const [whose, id] of requests) {
        const allowed = whose === 'an existing request' ? [409, 422] : [404, 409, 422];
        for (const version of hugeVersions) {
          const calls: Array<[string, string, string, string]> = [
            ['PUT quote', 'PUT', `/api/quote-requests/${id}/quote`, `{"price_cents":6895,"note":"","version":${version}}`],
            ['POST status change', 'POST', `/api/quote-requests/${id}/status-changes`, `{"to_status":"${otherStatus}","version":${version}}`],
          ];
          for (const [name, method, path, raw] of calls) {
            const label = `${name} on ${whose} [version ${version}]`;
            const res = await owner.fetch(path, { method, headers: { 'content-type': 'application/json' }, data: Buffer.from(raw) });
            if (!allowed.includes(res.status())) {
              failures.push(`${await lineWithBody(label, res)} expected ${allowed.join(' or ')}`);
              continue;
            }
            if (!isProblemJson(res)) failures.push(`${line(label, res)} not problem+json`);
            const leak = await leaks(res);
            if (leak) failures.push(`${line(label, res)} leaks "${leak}"`);
            if (res.status() === 422) {
              const problem = await problemOf(res);
              if (!problem?.errors?.some((e) => /version/.test(e.field))) failures.push(`${line(label, res)} 422 does not name version in errors[]`);
            }
          }
        }
      }
      const after = await detailOf(owner, target.id);
      if (after.version !== before.version || after.status !== before.status || after.price_cents !== before.price_cents || after.note !== before.note) {
        failures.push('a refused huge-version write changed the request (version, status, price or note)');
      }
      testInfo.annotations.push({ type: 'cases', description: `${requests.length * hugeVersions.length * 2} requests (2 request ids x ${hugeVersions.length} versions x 2 writes)` });
    } finally {
      await reset(owner, target.id);
    }
    await owner.dispose();
    await expectNone(testInfo, failures, 'huge version numbers on staff writes');
  });

  test('@probe PRB-43 AC-001.5 script text a homeowner sent (and one a staff member saved) shows as plain text on the list, the board and the detail, on a phone and a desktop, and never runs', async ({ playwright, browser, guard }, testInfo) => {
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const items = await probeRequests(owner);
    const target = items.find((i) => i.name.includes(XSS_IMG));
    if (!target) throw new Error('no QA-PROBE request with script text in its name exists: 40-public-form must run first');
    const base = await detailOf(owner, target.id);
    const note = `${XSS_IMG} staff note ${XSS_SCRIPT}`;
    const failures: string[] = [];
    const { email, password } = credentials('owner');
    try {
      const saved = await owner.put(`/api/quote-requests/${target.id}/quote`, { data: { price_cents: null, note, version: base.version } });
      if (saved.status() !== 200) throw new Error(`could not save the staff note: ${line('PUT quote', saved)}`);

      const screens: Array<{ label: string; viewport: { width: number; height: number }; mobile: boolean }> = [
        { label: 'phone 390', viewport: { width: 390, height: 844 }, mobile: true },
        { label: 'desktop 1280', viewport: { width: 1280, height: 800 }, mobile: false },
      ];
      for (const screen of screens) {
        const context = await newAnonContext(browser, { viewport: screen.viewport, isMobile: screen.mobile, hasTouch: screen.mobile, deviceScaleFactor: screen.mobile ? 2 : 1 });
        guard.watchContext(context);
        const page = await context.newPage();
        const dialogs: string[] = [];
        page.on('dialog', (d) => {
          dialogs.push(d.message());
          void d.dismiss();
        });
        await page.goto('/sign-in');
        await page.getByLabel('Email').fill(email);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page).toHaveURL(pathIs('/requests'));

        const inspect = async (where: string) => {
          const state = await page.evaluate(() => ({
            ran: (window as unknown as { __xss?: unknown }).__xss,
            onerror: document.querySelectorAll('[onerror]').length,
            badImg: document.querySelectorAll('img[src="x"]').length,
          }));
          if (state.ran !== undefined) failures.push(`CRITICAL ${screen.label} ${where}: window.__xss is set, so stored script text ran`);
          if (state.onerror > 0) failures.push(`${screen.label} ${where}: ${state.onerror} element(s) carry an onerror attribute (script text was parsed as HTML)`);
          if (state.badImg > 0) failures.push(`${screen.label} ${where}: an <img src="x"> exists in the page (script text was parsed as HTML)`);
          if (dialogs.length > 0) failures.push(`${screen.label} ${where}: a dialog opened (${dialogs.join(' | ').slice(0, 80)})`);
        };

        // The list (Requests tab)
        await expect(page.getByText(target.name, { exact: false }).first(), `${screen.label}: the script-text name shows as text on the list`).toBeVisible();
        await inspect('Requests list');
        // The board (Pipeline tab). On a phone the card sits in its column list.
        await page.goto('/pipeline');
        await expect(page.getByText(target.name, { exact: false }).first(), `${screen.label}: the script-text name shows as text on the board`).toBeVisible();
        await inspect('Pipeline board');
        // The detail: name, address, problem and the staff note
        await page.goto(`/requests/${target.id}`);
        await expect(page.getByText(XSS_IMG, { exact: false }).first(), `${screen.label}: the script text shows as text on the detail`).toBeVisible();
        await expect(page.getByText(`${XSS_SCRIPT}`, { exact: false }).first(), `${screen.label}: the address and problem script text show as text`).toBeVisible();
        await inspect('request detail');
        await context.close();
      }
    } finally {
      await reset(owner, target.id);
    }
    await owner.dispose();
    await expectNone(testInfo, failures, 'stored script text');
  });
});
