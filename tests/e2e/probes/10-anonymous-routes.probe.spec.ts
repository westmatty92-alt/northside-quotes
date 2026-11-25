// QA2 probes, part 1: the staff API and the pages around it, attacked with no session, a wrong session, the wrong
// method, unknown ids and routes that must not exist. All @probe (excluded from the QA1 command by --grep-invert).
//   PRB-01  every staff route with no session or a useless one                     AC-004.8, SECURITY_MODEL invariant 3
//   PRB-02  the same with a forged, tampered or "alg none" token
//   PRB-03  a signed-in cookie with no bearer is not a session (no CSRF surface)
//   PRB-04  unknown and malformed ids as staff                                     404, never 5xx, no database text
//   PRB-05  methods the contract does not list
//   PRB-06  routes and pages that must not exist (password change, reset, sign-up) AC-004.10
//   PRB-07  signed-out page visits go to sign-in with the tab they asked for       FR-26
//   PRB-08  malformed sign-in bodies
import { test, expect } from '../support/fixtures';
import { credentials } from '../support/env';
import {
  appApi,
  expectNone,
  isProblemJson,
  leaks,
  line,
  lineWithBody,
  newUuid,
  platformRefusal,
  problemOf,
  staffToken,
  supabaseTarget,
  vercelId,
} from './support';

const ID = '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';

interface Route {
  method: 'GET' | 'PUT' | 'POST';
  path: string;
  data?: Record<string, unknown>;
}

const STAFF_ROUTES: Route[] = [
  { method: 'GET', path: '/api/quote-requests' },
  { method: 'GET', path: '/api/quote-requests?status=new&q=a&limit=5' },
  { method: 'GET', path: `/api/quote-requests/${ID}` },
  { method: 'GET', path: `/api/quote-requests/${ID}/photos` },
  { method: 'PUT', path: `/api/quote-requests/${ID}/quote`, data: { price_cents: 1000, note: null, version: 1 } },
  { method: 'POST', path: `/api/quote-requests/${ID}/status-changes`, data: { to_status: 'won', version: 1 } },
  { method: 'POST', path: `/api/quote-requests/${ID}/ghl-copy-retries` },
  { method: 'GET', path: '/api/weekly-counts/current' },
  { method: 'GET', path: '/api/staff/me' },
];

test.describe('anonymous and wrong-session boundaries @probe', () => {
  test('@probe PRB-00 the preview under test answers health and reports the commit these probes ran against', async ({ playwright }, testInfo) => {
    const api = await appApi(playwright);
    const res = await api.get('/api/health');
    expect(res.status(), line('GET /api/health', res)).toBe(200);
    const body = (await res.json()) as { status?: string; version?: string };
    expect(body.status).toBe('ok');
    testInfo.annotations.push({ type: 'commit-under-test', description: String(body.version) });
    await testInfo.attach('health', { body: JSON.stringify(body), contentType: 'application/json' });
    // QA_EXPECTED_COMMIT (a SHA prefix) is optional: when set, the probes refuse to describe a different build.
    const expected = process.env.QA_EXPECTED_COMMIT;
    if (expected) expect(String(body.version).startsWith(expected), `the preview serves ${String(body.version).slice(0, 7)}, expected ${expected}`).toBe(true);
    await api.dispose();
  });

  test('@probe PRB-01 AC-004.8 every staff route with no session, an empty, undefined, garbage or anon-key bearer answers 401 and no data', async ({ playwright }, testInfo) => {
    const anon = await appApi(playwright);
    const anonKey = supabaseTarget().anonKey;
    const variants: Array<{ label: string; headers: Record<string, string> }> = [
      { label: 'no header', headers: {} },
      { label: 'Bearer (empty)', headers: { Authorization: 'Bearer ' } },
      { label: 'Bearer undefined', headers: { Authorization: 'Bearer undefined' } },
      { label: 'Bearer null', headers: { Authorization: 'Bearer null' } },
      { label: 'Bearer not.a.jwt', headers: { Authorization: 'Bearer not.a.jwt' } },
      { label: 'Basic', headers: { Authorization: 'Basic dXNlcjpwYXNzd29yZA==' } },
      { label: 'the public anon key as bearer', headers: { Authorization: `Bearer ${anonKey}` } },
    ];
    const failures: string[] = [];
    let cases = 0;
    for (const route of STAFF_ROUTES) {
      for (const variant of variants) {
        cases += 1;
        const res = await anon.fetch(route.path, { method: route.method, headers: variant.headers, data: route.data });
        const problem = await problemOf(res);
        const label = `${route.method} ${route.path.split('?')[0]?.replace(ID, '{id}')} [${variant.label}]`;
        if (res.status() !== 401) failures.push(`${await lineWithBody(label, res)} expected 401`);
        else if (!isProblemJson(res)) failures.push(`${line(label, res)} 401 is not application/problem+json`);
        else if (!problem?.code || !['unauthorized', 'session_expired'].includes(problem.code)) failures.push(`${line(label, res)} 401 code is ${String(problem?.code)}`);
        else if (res.headers()['set-cookie']) failures.push(`${line(label, res)} a refusal set a cookie`);
        else {
          const leak = await leaks(res);
          if (leak) failures.push(`${line(label, res)} the refusal leaks "${leak}"`);
        }
      }
    }
    testInfo.annotations.push({ type: 'cases', description: `${cases} requests (${STAFF_ROUTES.length} routes x ${variants.length} credentials)` });
    await anon.dispose();
    await expectNone(testInfo, failures, 'routes that did not answer 401 with a clean problem body');
  });

  for (const role of ['owner', 'helper'] as const) {
    test(`@probe PRB-01 positive control (${role}): a real staff token is accepted, so the 401s above are not a blanket refusal`, async ({ playwright }) => {
      const api = await appApi(playwright, await staffToken(playwright, role));
      const me = await api.get('/api/staff/me');
      expect(me.status(), line(`GET /api/staff/me with the ${role} token`, me)).toBe(200);
      expect(Object.keys((await me.json()) as object).sort()).toEqual(['display_name', 'user_id']);
      const list = await api.get('/api/quote-requests?limit=1');
      expect(list.status(), line(`GET /api/quote-requests with the ${role} token`, list)).toBe(200);
      await api.dispose();
    });
  }

  test('@probe PRB-02 a tampered, re-signed-by-nobody or "alg none" token is refused (401 from the app, or Vercel\'s own edge refusal)', async ({ playwright }, testInfo) => {
    const token = await staffToken(playwright, 'owner');
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) throw new Error('the staff token is not a three-part JWT');
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const flipped = `${signature.slice(0, -3)}${signature.endsWith('AAA') ? 'BBB' : 'AAA'}`;
    const forged: Array<[string, string]> = [
      ['signature changed', `${header}.${payload}.${flipped}`],
      ['alg none, no signature', `${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`],
      ['alg none, empty parts', `${b64({ alg: 'none' })}.${b64(claims)}.`],
      ['claims edited to role service_role, signature kept', `${header}.${b64({ ...claims, role: 'service_role' })}.${signature}`],
      ['subject edited, signature kept', `${header}.${b64({ ...claims, sub: newUuid() })}.${signature}`],
      ['truncated', token.slice(0, token.length - 40)],
      ['two parts', `${header}.${payload}`],
    ];
    const api = await appApi(playwright);
    const failures: string[] = [];
    let edgeRefusals = 0;
    for (const [label, bad] of forged) {
      for (const path of ['/api/staff/me', '/api/quote-requests?limit=1', '/api/weekly-counts/current']) {
        const res = await api.get(path, { headers: { Authorization: `Bearer ${bad}` } });
        if (res.status() === 401) continue;
        if (platformRefusal(res)) {
          edgeRefusals += 1; // refused before the app ran; still a refusal with no data
          continue;
        }
        failures.push(`${await lineWithBody(`GET ${path} [${label}]`, res)} expected 401`);
      }
    }
    testInfo.annotations.push({ type: 'edge-refusals', description: `${edgeRefusals} of ${forged.length * 3} forged-token calls were refused by Vercel's edge (403, text/plain) before reaching the app` });
    await api.dispose();
    await expectNone(testInfo, failures, 'forged tokens that were not refused');
  });

  test('@probe PRB-03 a signed-in session cookie with no bearer token is not a session for the API', async ({ playwright }, testInfo) => {
    const { email, password } = credentials('owner');
    const api = await appApi(playwright); // the request context keeps the cookies the sign-in sets
    const signIn = await api.post('/api/auth/sign-in', { data: { email, password } });
    expect(signIn.status(), line('POST /api/auth/sign-in as the owner (a successful sign-in)', signIn)).toBe(200);
    const cookieNames = (await api.storageState()).cookies.map((c) => c.name);
    expect(cookieNames.some((n) => /^sb-.+-auth-token/.test(n)), 'the sign-in set the Supabase session cookie').toBe(true);
    const failures: string[] = [];
    for (const route of STAFF_ROUTES.filter((r) => r.method === 'GET')) {
      const res = await api.get(route.path);
      if (res.status() !== 401) failures.push(`${line(`GET ${route.path.replace(ID, '{id}')} with the session cookie only`, res)} expected 401 (route handlers never authenticate from cookies)`);
    }
    await api.dispose();
    await expectNone(testInfo, failures, 'routes that accepted a cookie instead of a bearer token');
  });

  test('@probe PRB-04 unknown ids answer 404 not_found; malformed ids never reach the database (no 5xx, no database text)', async ({ playwright }, testInfo) => {
    const api = await appApi(playwright, await staffToken(playwright, 'owner'));
    const unknown = newUuid();
    const failures: string[] = [];
    const cases: Array<[string, string, string, Record<string, unknown> | undefined]> = [
      ['GET', `/api/quote-requests/${unknown}`, 'detail', undefined],
      ['GET', `/api/quote-requests/${unknown}/photos`, 'photos', undefined],
      ['PUT', `/api/quote-requests/${unknown}/quote`, 'quote', { price_cents: 1000, note: null, version: 1 }],
      ['POST', `/api/quote-requests/${unknown}/status-changes`, 'status change', { to_status: 'won', version: 1 }],
      ['POST', `/api/quote-requests/${unknown}/ghl-copy-retries`, 'copy retry', undefined],
    ];
    for (const [method, path, label, data] of cases) {
      const res = await api.fetch(path, { method, data });
      const problem = await problemOf(res);
      if (res.status() !== 404 || problem?.code !== 'not_found') failures.push(`${await lineWithBody(`${method} unknown id (${label})`, res)} expected 404 not_found, code ${String(problem?.code)}`);
    }
    const malformed = ['not-a-uuid', '12345', '..%2F..%2Fetc%2Fpasswd', '%27%20OR%201%3D1%20--', '00000000-0000-0000-0000-00000000000g', 'a'.repeat(300), '%00', '%F0%9F%92%A5'];
    let edgeRefusals = 0;
    for (const id of malformed) {
      for (const [method, suffix, data] of [
        ['GET', '', undefined],
        ['GET', '/photos', undefined],
        ['PUT', '/quote', { price_cents: 1000, note: null, version: 1 }],
        ['POST', '/status-changes', { to_status: 'won', version: 1 }],
        ['POST', '/ghl-copy-retries', undefined],
      ] as const) {
        const res = await api.fetch(`/api/quote-requests/${id}${suffix}`, { method, data });
        const label = `${method} /api/quote-requests/${id.slice(0, 24)}${suffix}`;
        if (platformRefusal(res)) {
          edgeRefusals += 1; // for example a NUL byte in the path: refused by Vercel before the app
          continue;
        }
        if (![400, 404, 422].includes(res.status())) failures.push(`${await lineWithBody(label, res)} expected 400, 404 or 422`);
        else if (!isProblemJson(res)) failures.push(`${await lineWithBody(label, res)} not problem+json`);
        else {
          const leak = await leaks(res);
          if (leak) failures.push(`${line(label, res)} leaks "${leak}"`);
        }
      }
    }
    testInfo.annotations.push({ type: 'edge-refusals', description: `${edgeRefusals} malformed-id calls were refused by Vercel's edge (400 or 403, text/plain) before reaching the app` });
    await api.dispose();
    await expectNone(testInfo, failures, 'unknown or malformed ids that were not handled as 404 or a clean 4xx');
  });

  test('@probe PRB-05 a method the contract does not list answers 405 method_not_allowed (a request can never be deleted)', async ({ playwright }, testInfo) => {
    const staff = await appApi(playwright, await staffToken(playwright, 'owner'));
    const anon = await appApi(playwright);
    const id = newUuid();
    const wrong: Array<[string, string]> = [
      ['DELETE', `/api/quote-requests/${id}`],
      ['PATCH', `/api/quote-requests/${id}`],
      ['PUT', `/api/quote-requests/${id}`],
      ['DELETE', '/api/quote-requests'],
      ['PUT', '/api/quote-requests'],
      ['PATCH', '/api/quote-requests'],
      ['POST', '/api/staff/me'],
      ['POST', '/api/weekly-counts/current'],
      ['DELETE', `/api/quote-requests/${id}/photos`],
      ['POST', `/api/quote-requests/${id}/photos`],
      ['GET', `/api/quote-requests/${id}/quote`],
      ['GET', `/api/quote-requests/${id}/status-changes`],
      ['DELETE', `/api/quote-requests/${id}/status-changes`],
      ['GET', `/api/quote-requests/${id}/ghl-copy-retries`],
      ['POST', '/api/health'],
      ['GET', '/api/auth/sign-in'],
    ];
    const failures: string[] = [];
    for (const [method, path] of wrong) {
      const res = await staff.fetch(path, { method });
      const problem = await problemOf(res);
      const label = `${method} ${path.replace(id, '{id}')} (staff)`;
      if (res.status() !== 405) failures.push(`${await lineWithBody(label, res)} expected 405`);
      else if (problem?.code !== 'method_not_allowed') failures.push(`${line(label, res)} expected code method_not_allowed, got ${String(problem?.code)}`);
      else if (!res.headers()['allow']) failures.push(`${line(label, res)} no Allow header`);
      const anonRes = await anon.fetch(path, { method });
      if (![401, 405].includes(anonRes.status())) failures.push(`${line(`${method} ${path.replace(id, '{id}')} (no session)`, anonRes)} expected 401 or 405`);
    }
    // A method override header must not turn a POST into a DELETE or a PUT.
    for (const header of ['X-HTTP-Method-Override', 'X-HTTP-Method', 'X-Method-Override']) {
      const res = await staff.post(`/api/quote-requests/${id}`, { headers: { [header]: 'DELETE' } });
      if (res.status() !== 405) failures.push(`${line(`POST /api/quote-requests/{id} with ${header}: DELETE`, res)} expected 405 (POST is not a listed method for this path and the override must not matter)`);
    }
    await staff.dispose();
    await anon.dispose();
    await expectNone(testInfo, failures, 'methods that were accepted or answered wrongly');
  });

  test('@probe PRB-06 AC-004.10 there is no route or page to change or reset a password, sign up, or recover; nothing is sent', async ({ playwright }, testInfo) => {
    const api = await appApi(playwright);
    const staff = await appApi(playwright, await staffToken(playwright, 'owner'));
    const throwaway = `qa-probe-${Date.now().toString(36)}@example.test`;
    const body = { email: throwaway, password: 'Throwaway-passw0rd-12', new_password: 'Throwaway-passw0rd-13' };
    const apiPaths = [
      '/api/password',
      '/api/reset-password',
      '/api/forgot-password',
      '/api/auth/password',
      '/api/auth/reset',
      '/api/auth/reset-password',
      '/api/auth/forgot',
      '/api/auth/forgot-password',
      '/api/auth/recover',
      '/api/auth/change-password',
      '/api/auth/update-password',
      '/api/auth/sign-up',
      '/api/auth/register',
      '/api/auth/magic-link',
      '/api/staff/password',
      '/api/staff/me/password',
      '/api/inbox',
    ];
    const failures: string[] = [];
    for (const path of apiPaths) {
      for (const method of ['GET', 'POST', 'PUT'] as const) {
        for (const [who, client] of [['no session', api], ['staff', staff]] as const) {
          const res = await client.fetch(path, { method, data: method === 'GET' ? undefined : body });
          if (res.status() === 404) continue;
          // An error page is harmless to read; a 2xx body here would be an app page, so only its title is kept.
          const html = res.status() < 400 ? await res.text() : '';
          const title = html.match(/<title[^>]*>([^<]{0,80})/i)?.[1] ?? '';
          const detail = res.status() >= 400 ? await lineWithBody(`${method} ${path} (${who})`, res) : `${line(`${method} ${path} (${who})`, res)} type=${res.headers()['content-type'] ?? 'n/a'} title="${title}" x-matched-path=${res.headers()['x-matched-path'] ?? 'n/a'}`;
          failures.push(`${detail} expected 404`);
        }
      }
    }
    for (const page of ['/forgot-password', '/reset-password', '/change-password', '/sign-up', '/signup', '/register', '/auth/reset', '/account/password', '/inbox']) {
      const res = await api.get(page, { maxRedirects: 0 });
      if (res.status() !== 404) failures.push(`${line(`GET ${page}`, res)} expected 404`);
    }
    await api.dispose();
    await staff.dispose();
    await expectNone(testInfo, failures, 'password, reset or sign-up paths that exist');
  });

  test('@probe PRB-06b an unknown path answers 404 whatever the method or headers (pinpoints what turns a 404 into a 200)', async ({ playwright }, testInfo) => {
    const api = await appApi(playwright);
    const variants: Array<{ label: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'; headers: Record<string, string>; data?: Record<string, unknown> }> = [
      { label: 'GET, no extra header', method: 'GET', headers: {} },
      { label: 'GET, Authorization: Bearer x', method: 'GET', headers: { Authorization: 'Bearer x' } },
      { label: 'GET, Accept: application/json', method: 'GET', headers: { Accept: 'application/json' } },
      { label: 'GET, Cookie only', method: 'GET', headers: { Cookie: 'a=b' } },
      { label: 'HEAD', method: 'HEAD', headers: {} },
      { label: 'POST, no body', method: 'POST', headers: {} },
      { label: 'POST, JSON body', method: 'POST', headers: {}, data: { a: 1 } },
      { label: 'PUT, JSON body', method: 'PUT', headers: {}, data: { a: 1 } },
      { label: 'DELETE', method: 'DELETE', headers: {} },
    ];
    const failures: string[] = [];
    const table: string[] = [];
    for (const path of ['/api/does-not-exist', '/api/auth/does-not-exist', '/does-not-exist']) {
      for (const v of variants) {
        const res = await api.fetch(path, { method: v.method, headers: v.headers, data: v.data });
        table.push(`${v.label} ${path} -> ${res.status()} (${res.headers()['x-matched-path'] ?? 'n/a'})`);
        if (res.status() !== 404) failures.push(`${line(`${v.label} ${path}`, res)} type=${res.headers()['content-type'] ?? 'n/a'} x-matched-path=${res.headers()['x-matched-path'] ?? 'n/a'} expected 404`);
      }
    }
    await testInfo.attach('status-table', { body: table.join('\n'), contentType: 'text/plain' });
    await api.dispose();
    await expectNone(testInfo, failures, 'unknown paths that did not answer 404');
  });

  test('@probe PRB-07 FR-26 a signed-out visit to a staff page is sent to /sign-in with the tab it asked for, and the page holds no request data', async ({ playwright }, testInfo) => {
    const api = await appApi(playwright);
    const failures: string[] = [];
    for (const path of ['/requests', '/pipeline', `/requests/${ID}`, `/pipeline/${ID}`]) {
      const res = await api.get(path, { maxRedirects: 0 });
      const location = res.headers()['location'] ?? '';
      const text = await res.text();
      if (![302, 303, 307, 308].includes(res.status())) failures.push(`${line(`GET ${path}`, res)} expected a redirect to sign-in`);
      else if (!/\/sign-in\?next=/.test(location)) failures.push(`${line(`GET ${path}`, res)} redirects to ${location.slice(0, 80)}, not /sign-in?next=`);
      if (/NQ-[A-HJKMNP-Z2-9]{6}/.test(text)) failures.push(`${line(`GET ${path}`, res)} the redirect body holds a reference number`);
    }
    await api.dispose();
    await expectNone(testInfo, failures, 'staff pages that did not redirect a signed-out visitor');
  });

  test('@probe PRB-08 malformed sign-in bodies are refused with a clean 4xx, set no session and are never a 5xx', async ({ playwright }, testInfo) => {
    const api = await appApi(playwright);
    const failures: string[] = [];
    const cases: Array<{ label: string; headers?: Record<string, string>; body: string | undefined; expect: number[] }> = [
      { label: 'not JSON', headers: { 'content-type': 'application/json' }, body: '{not json', expect: [400] },
      { label: 'empty body', headers: { 'content-type': 'application/json' }, body: '', expect: [400, 422] },
      { label: 'empty object', headers: { 'content-type': 'application/json' }, body: '{}', expect: [400, 422] },
      { label: 'wrong types', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 123, password: ['x'] }), expect: [400, 422] },
      { label: 'text/plain content type', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ email: 'x@example.test', password: 'x' }), expect: [400, 415, 422] },
    ];
    for (const c of cases) {
      const res = await api.post('/api/auth/sign-in', { headers: c.headers, data: c.body === undefined ? undefined : Buffer.from(c.body) });
      const label = `POST /api/auth/sign-in [${c.label}]`;
      if (!c.expect.includes(res.status())) failures.push(`${await lineWithBody(label, res)} expected ${c.expect.join(' or ')} (request id ${vercelId(res)})`);
      else if (!isProblemJson(res)) failures.push(`${line(label, res)} not problem+json`);
      else if (res.headers()['set-cookie']) failures.push(`${line(label, res)} set a cookie`);
      else {
        const leak = await leaks(res);
        if (leak) failures.push(`${line(label, res)} leaks "${leak}"`);
      }
    }
    await api.dispose();
    await expectNone(testInfo, failures, 'sign-in bodies that were not refused cleanly');
  });
});
