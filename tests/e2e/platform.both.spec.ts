// The deployed preview itself: which commit it serves, the Request page is rendered per request with a
// fresh form token and is never cached, /inbox does not exist, and the sign-in route answers the way the
// contract says. SECURITY_MODEL "One token per page load" (S0 SEC-2), architecture "Build requirements from S0 -> QA".
import { test, expect } from './support/fixtures';
import { fetchPublicPage, newApi, nonceOf, describe } from './support/api';
import { loadEnv } from './support/env';

test.describe('preview platform', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@smoke health answers ok and reports the commit under test', async ({ playwright }, testInfo) => {
    loadEnv();
    const expected = process.env.QA_EXPECTED_SHA ?? '0dff609';
    // QA_WAIT_BUILD_MS (optional): a new build may take minutes to land, so poll for that long. The assertion
    // itself is unchanged: the version must start with the commit under test.
    const waitMs = Number(process.env.QA_WAIT_BUILD_MS ?? 0);
    if (waitMs > 0) test.setTimeout(waitMs + 60_000);
    const anon = await newApi(playwright);
    const read = async () => {
      const res = await anon.get('/api/health');
      expect(res.status(), await describe(res)).toBe(200);
      return (await res.json()) as { status?: string; version?: string };
    };
    let body = await read();
    if (waitMs > 0) {
      await expect
        .poll(async () => String((body = await read()).version ?? '').startsWith(expected), {
          timeout: waitMs,
          intervals: [15_000],
          message: `deployed commit never started with ${expected}`,
        })
        .toBe(true);
    }
    expect(body.status).toBe('ok');
    await testInfo.attach('health', { body: JSON.stringify(body), contentType: 'application/json' });
    expect(String(body.version ?? ''), 'deployed commit').toContain(expected);
    await anon.dispose();
  });

  test('@smoke SEC-2 two GETs of / carry different form-token nonces and Cache-Control no-store', async ({ playwright }, testInfo) => {
    const anon = await newApi(playwright);
    const first = await fetchPublicPage(anon);
    const second = await fetchPublicPage(anon);
    expect(first.res.status(), `first GET /: ${await describe(first.res)}`).toBe(200);
    expect(second.res.status(), `second GET /: ${await describe(second.res)}`).toBe(200);
    expect(first.token, 'first page embeds a form token').not.toBeNull();
    expect(second.token, 'second page embeds a form token').not.toBeNull();
    expect(nonceOf(first.token as string), 'nonce of the two pages').not.toBe(nonceOf(second.token as string));
    for (const r of [first.res, second.res]) {
      expect(r.headers()['cache-control'] ?? '', 'Cache-Control on /').toContain('no-store');
    }
    await testInfo.attach('cache-control', { body: String(first.res.headers()['cache-control']), contentType: 'text/plain' });
    await anon.dispose();
  });

  test('@smoke the form-token routes are available: a made-up token is 401 form_token_invalid, not 503', async ({ playwright }) => {
    // Invariant 15: with APP_SIGNING_SECRET missing or short, GET / is 500 and these routes answer 503 service_unavailable.
    const anon = await newApi(playwright);
    const res = await anon.post('/api/quote-requests', {
      headers: { 'X-Form-Token': 'v1.1700000000000.00000000-0000-4000-8000-000000000000.invalidsignature' },
      data: { name: 'QA-E2E token probe', phone: '9055550142', email: 'qa-e2e@example.com', address: '1 Test St, Hamilton ON', problem: 'This is a token probe only.', urgency: 'flexible', marketing_consent: false, website: '' },
    });
    const text = await describe(res);
    expect(res.status(), text).toBe(401);
    expect(((await res.json().catch(() => ({}))) as { code?: string }).code, text).toBe('form_token_invalid');
    await anon.dispose();
  });

  test('@regression /inbox returns 404 (there is no such route)', async ({ playwright }) => {
    const anon = await newApi(playwright);
    for (const path of ['/inbox', '/inbox?view=board']) {
      const res = await anon.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} -> location ${res.headers().location ?? 'none'}: ${await describe(res)}`).toBe(404);
    }
    await anon.dispose();
  });
});
