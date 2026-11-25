// QA2 probes, part 7: what the deployed pages tell the browser, and what the shipped JavaScript contains.
//   PRB-60  invariant 13  Content-Security-Policy with a fresh nonce, no framing, no unsafe-eval, plus the other headers
//   PRB-61                the API sets no CORS headers, so a page on another site cannot call it from a browser
//   PRB-62  invariant 2   no secret, service-role key or private key in the HTML or in any JavaScript the app serves
//                         (public pages, and every script a signed-in staff browser loads on all three staff screens)
import { test, expect, newAnonContext } from '../support/fixtures';
import { credentials, loadEnv, stagingHost } from '../support/env';
import { appApi, expectNone, line, probeTag, staffToken } from './support';

test.describe('headers and bundles @probe', () => {
  test('@probe PRB-60 every page sends a nonce CSP that forbids framing, plus nosniff, a referrer policy and X-Frame-Options DENY; two loads get different nonces', async ({ playwright }, testInfo) => {
    const api = await appApi(playwright);
    const failures: string[] = [];
    const nonces = new Set<string>();
    for (const path of ['/', '/sign-in', '/', '/sign-in']) {
      const res = await api.get(path);
      const csp = res.headers()['content-security-policy'] ?? '';
      const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';
      const nonce = directive('script-src').match(/'nonce-([^']+)'/)?.[1];
      if (!csp) failures.push(`${line(`GET ${path}`, res)} no Content-Security-Policy header`);
      else {
        if (!nonce) failures.push(`GET ${path}: script-src has no nonce`);
        else nonces.add(`${path}:${nonce}`);
        if (!directive('script-src').includes("'strict-dynamic'")) failures.push(`GET ${path}: script-src lacks 'strict-dynamic'`);
        if (/'unsafe-eval'|'unsafe-inline'/.test(directive('script-src'))) failures.push(`GET ${path}: script-src allows unsafe-eval or unsafe-inline`);
        if (!/frame-ancestors 'none'/.test(csp)) failures.push(`GET ${path}: frame-ancestors is not 'none'`);
        if (!/default-src 'self'/.test(csp)) failures.push(`GET ${path}: default-src is not 'self'`);
        if (!/object-src 'none'/.test(csp)) failures.push(`GET ${path}: object-src is not 'none'`);
        if (!/base-uri 'none'/.test(csp)) failures.push(`GET ${path}: base-uri is not 'none'`);
        if (!/form-action 'self'/.test(csp)) failures.push(`GET ${path}: form-action is not 'self'`);
      }
      const h = res.headers();
      if ((h['x-frame-options'] ?? '').toUpperCase() !== 'DENY') failures.push(`GET ${path}: X-Frame-Options is "${h['x-frame-options'] ?? 'missing'}", expected DENY`);
      if ((h['x-content-type-options'] ?? '').toLowerCase() !== 'nosniff') failures.push(`GET ${path}: X-Content-Type-Options is "${h['x-content-type-options'] ?? 'missing'}"`);
      if ((h['referrer-policy'] ?? '') !== 'strict-origin-when-cross-origin') failures.push(`GET ${path}: Referrer-Policy is "${h['referrer-policy'] ?? 'missing'}"`);
    }
    const homeNonces = [...nonces].filter((n) => n.startsWith('/:'));
    if (new Set(homeNonces).size < 2) failures.push('two loads of / carried the same CSP nonce');
    await api.dispose();
    await expectNone(testInfo, failures, 'page security headers');
  });

  test('@probe PRB-61 no CORS: a call from another origin gets no Access-Control-Allow-Origin, on the API, the form routes and the job routes', async ({ playwright }, testInfo) => {
    const api = await appApi(playwright);
    const failures: string[] = [];
    const origin = 'https://evil.example';
    const targets: Array<[string, string, string?]> = [
      ['GET', '/api/health'],
      ['GET', '/api/staff/me'],
      ['POST', '/api/quote-requests', 'x-form-token,content-type'],
      ['POST', '/api/auth/sign-in', 'content-type'],
      ['GET', '/api/jobs/ghl-sync'],
      ['PUT', '/api/quote-requests/6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10/quote', 'authorization,content-type'],
    ];
    for (const [method, path, requested] of targets) {
      const preflight = await api.fetch(path, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method, ...(requested ? { 'Access-Control-Request-Headers': requested } : {}) } });
      const actual = await api.fetch(path, { method: method === 'GET' ? 'GET' : 'POST', headers: { Origin: origin } });
      for (const [kind, res] of [['preflight', preflight], ['request', actual]] as const) {
        const allow = res.headers()['access-control-allow-origin'];
        if (allow === '*' || allow === origin) failures.push(`${line(`${kind} ${method} ${path}`, res)} Access-Control-Allow-Origin is ${allow}`);
        if (res.headers()['access-control-allow-credentials']) failures.push(`${line(`${kind} ${method} ${path}`, res)} Access-Control-Allow-Credentials is set`);
      }
    }
    await api.dispose();
    await expectNone(testInfo, failures, 'CORS headers');
  });

  test('@probe PRB-62 invariant 2 no service-role key, private key, signing secret or provider token appears in any page or script the app ships', async ({ browser, playwright, guard }, testInfo) => {
    loadEnv();
    const { email, password } = credentials('owner');
    const owner = await appApi(playwright, await staffToken(playwright, 'owner'));
    const probe = (await (await owner.get(`/api/quote-requests?q=${encodeURIComponent(probeTag())}&limit=1`)).json()) as { data: Array<{ id: string }> };
    const anyId = probe.data[0]?.id;
    await owner.dispose();

    // Real secret values held on this machine are looked for by value (never printed); names alone prove nothing.
    const secretNames = ['SUPABASE_STAGING_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_SIGNING_SECRET', 'CRON_SECRET', 'GHL_PRIVATE_INTEGRATION_TOKEN', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'QA_OWNER_PASSWORD', 'QA_HELPER_PASSWORD'];
    const secrets = secretNames.map((name) => ({ name, value: process.env[name] ?? '' })).filter((s) => s.value.length >= 12);
    const patterns: Array<[string, RegExp]> = [
      ['the word service_role', /service_role/],
      ['a live or test Stripe key', /\bsk_(?:live|test)_[A-Za-z0-9]{8,}/],
      ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ['a GoHighLevel private integration token', /\bpit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/],
      ['the name of a server-only variable', /\b(?:CRON_SECRET|APP_SIGNING_SECRET|SUPABASE_SERVICE_ROLE_KEY|GHL_PRIVATE_INTEGRATION_TOKEN)\b/],
    ];
    const seen = new Map<string, string>(); // url (no query) -> body
    const addBody = (url: string, body: string) => {
      try {
        const u = new URL(url);
        seen.set(`${u.host}${u.pathname}`, body);
      } catch {
        // ignore
      }
    };

    // Public pages: the HTML and every script it loads.
    const anon = await appApi(playwright);
    for (const path of ['/', '/sign-in']) {
      const res = await anon.get(path);
      const html = await res.text();
      addBody(`https://${stagingHost()}${path}#html`, html);
      for (const src of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)) {
        const url = src[1];
        if (!url || seen.has(`${stagingHost()}${url}`)) continue;
        const js = await anon.get(url);
        if (js.status() === 200) addBody(`https://${stagingHost()}${url}`, await js.text());
      }
    }
    await anon.dispose();

    // Signed-in staff screens: every JavaScript response the browser receives.
    const context = await newAnonContext(browser, { viewport: { width: 1280, height: 800 } });
    guard.watchContext(context);
    const page = await context.newPage();
    const pending: Array<Promise<void>> = [];
    page.on('response', (r) => {
      const type = r.headers()['content-type'] ?? '';
      if (r.status() === 200 && /javascript/.test(type) && new URL(r.url()).host === stagingHost()) {
        pending.push(r.text().then((t) => addBody(r.url(), t)).catch(() => undefined));
      }
    });
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/requests$/);
    await page.goto('/pipeline');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    if (anyId) {
      await page.goto(`/requests/${anyId}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    }
    await Promise.all(pending);
    await context.close();

    const failures: string[] = [];
    for (const [where, body] of seen) {
      for (const [what, re] of patterns) if (re.test(body)) failures.push(`${where} contains ${what}`);
      for (const s of secrets) if (body.includes(s.value)) failures.push(`${where} contains the value of ${s.name}`);
      // Any JWT shipped to the browser must be the public anon key (role anon), never service_role.
      for (const m of body.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
        try {
          const claims = JSON.parse(Buffer.from(m[1] ?? '', 'base64url').toString('utf8')) as { role?: string };
          if (claims.role && claims.role !== 'anon') failures.push(`${where} contains a JWT with role ${claims.role}`);
        } catch {
          // not a JWT
        }
      }
    }
    testInfo.annotations.push({ type: 'scanned', description: `${seen.size} documents and scripts, ${secrets.length} real secret values checked by value` });
    expect(seen.size, 'at least the app scripts were scanned').toBeGreaterThan(3);
    await expectNone(testInfo, failures, 'secrets in what the app ships');
  });
});
