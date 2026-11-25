// QA2 probes, part 6: sign-in abuse controls (FR-9, ruling 4A, SECURITY_MODEL invariants 19 and 22).
//
// Hard rules for this file (Matthew, 2026-11-24): failed sign-ins are made only for a THROWAWAY email this run invents
// (qa-probe-<run id>-lock@example.test, an address that has no account). Never for owner@northside.test or
// helper@northside.test: the real staff accounts are used only to sign in successfully.
//
// The per-address limit (20 failures from one address in 15 minutes pauses that address for 15 minutes, AC-004.11) is
// deliberately NOT driven here: it would pause this machine's address, and with it every other agent's staff
// sign-in on the shared staging preview, for 15 minutes. This file adds 5 failures per run to that count.
//   PRB-50  AC-004.5 AC-004.12 FR-9  one throwaway email: attempts 1 to 5 are 401, attempts 6 to 20 are 429
//                                    with one body and no Retry-After
//   PRB-51                           the pause on that email does not stop a real staff sign-in
//   PRB-52  FR-26 invariant 22       the sign-in `next` value never leaves the site
import { test, expect, newAnonContext } from '../support/fixtures';
import { credentials, runId, stagingHost } from '../support/env';
import { pathIs } from '../support/paths';
import { appApi, expectNone, line, lineWithBody, problemOf, stableBody } from './support';

test.describe('sign-in abuse controls @probe', () => {
  test('@probe PRB-50 AC-004.5 AC-004.12 five wrong passwords for a throwaway email, then attempts 6 to 20 are refused with one 429 body and no Retry-After', async ({ playwright }, testInfo) => {
    const email = `qa-probe-${runId()}-lock@example.test`;
    const api = await appApi(playwright);
    const failures: string[] = [];
    const first: string[] = [];
    const paused: string[] = [];
    const retryHeaders = /^(retry-after|x-retry-after|ratelimit.*|x-ratelimit.*)$/i;
    for (let n = 1; n <= 20; n += 1) {
      const res = await api.post('/api/auth/sign-in', { data: { email, password: `Wrong-password-${n}-qa-probe` } });
      const problem = await problemOf(res);
      const label = `attempt ${n}`;
      const forbidden = Object.keys(res.headers()).filter((h) => retryHeaders.test(h));
      if (forbidden.length > 0) failures.push(`${line(label, res)} carries ${forbidden.join(', ')} (the pause length would say which limit applied)`);
      if (res.headers()['set-cookie']) failures.push(`${line(label, res)} set a cookie`);
      if (n <= 5) {
        if (res.status() !== 401 || problem?.code !== 'invalid_credentials') failures.push(`${await lineWithBody(label, res)} expected 401 invalid_credentials (a wrong password is not yet paused)`);
        first.push(await stableBody(res));
      } else {
        if (res.status() !== 429 || problem?.code !== 'sign_in_paused') failures.push(`${await lineWithBody(label, res)} expected 429 sign_in_paused`);
        else if (problem.title !== 'Too many sign-in attempts. Try again in a few minutes.') failures.push(`${line(label, res)} title is "${String(problem.title)}"`);
        paused.push(await stableBody(res));
      }
    }
    if (new Set(first).size !== 1) failures.push(`attempts 1 to 5 did not return one identical body (${new Set(first).size} variants)`);
    if (new Set(paused).size !== 1) failures.push(`attempts 6 to 20 did not return one identical body (${new Set(paused).size} variants)`);
    testInfo.annotations.push({ type: 'throwaway-email', description: `${email} (no account; 20 attempts: 5 counted as failures, 15 refused)` });
    await api.dispose();
    await expectNone(testInfo, failures, 'the per-email sign-in limit');
  });

  test('@probe PRB-51 a pause on a throwaway email does not stop the owner signing in (a successful sign-in, not counted)', async ({ playwright }) => {
    const { email, password } = credentials('owner');
    const api = await appApi(playwright);
    const res = await api.post('/api/auth/sign-in', { data: { email, password } });
    expect(res.status(), line('POST /api/auth/sign-in as the owner after the throwaway email was paused', res)).toBe(200);
    expect((await res.json()) as object).toHaveProperty('display_name');
    await api.dispose();
  });

  test('@probe PRB-52 FR-26 the sign-in "next" value is followed only for /requests and /pipeline; an absolute or protocol-relative address lands on /requests', async ({ browser, guard }, testInfo) => {
    const { email, password } = credentials('owner');
    const host = stagingHost();
    const cases: Array<{ next: string; lands: string; label: string }> = [
      { next: '/pipeline', lands: '/pipeline', label: 'control: /pipeline is followed' },
      { next: '//evil.example/phish', lands: '/requests', label: 'protocol-relative' },
      { next: 'https://evil.example/phish', lands: '/requests', label: 'absolute URL' },
      { next: '/\\evil.example', lands: '/requests', label: 'backslash' },
      { next: '/%2F%2Fevil.example', lands: '/requests', label: 'encoded slashes' },
      { next: 'javascript:alert(1)', lands: '/requests', label: 'javascript: URL' },
    ];
    const failures: string[] = [];
    for (const c of cases) {
      const context = await newAnonContext(browser, { viewport: { width: 1280, height: 800 } });
      guard.watchContext(context);
      const page = await context.newPage();
      const hosts = new Set<string>();
      page.on('request', (r) => {
        try {
          hosts.add(new URL(r.url()).host);
        } catch {
          // not a URL (data:, blob:)
        }
      });
      await page.goto(`/sign-in?next=${encodeURIComponent(c.next)}`);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page, `${c.label}: signed in and left the sign-in page`).toHaveURL(pathIs(c.lands));
      const landed = new URL(page.url());
      if (landed.host !== host) failures.push(`${c.label}: landed on ${landed.host}, expected ${host}`);
      if (hosts.has('evil.example')) failures.push(`${c.label}: the browser contacted evil.example`);
      await context.close();
    }
    testInfo.annotations.push({ type: 'cases', description: `${cases.length} sign-ins as the owner (successful), each in a fresh browser` });
    await expectNone(testInfo, failures, 'the sign-in return address');
  });
});
