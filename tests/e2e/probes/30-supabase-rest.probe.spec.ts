// QA2 probes, part 3: the database itself, called directly the way a curious visitor or a staff member with a
// browser console would, skipping the app. Targets the staging Supabase project's REST, RPC and Auth endpoints with
// the public (anon) key and with a staff token. No Vercel bypass header goes to supabase.co.
//   PRB-20  anon key: no table readable                                      SECURITY_MODEL invariant 1
//   PRB-21  anon key: no table writable (insert, update, delete)
//   PRB-22  staff token: only the six readable tables; pending requests invisible; no personal data in events or jobs
//   PRB-23  staff token: no table writable                                   invariant 4
//   PRB-24  RPCs: service-only functions closed to anon and staff; staff functions closed to anon
//   PRB-25  schemas other than public are not exposed
//   PRB-26  Supabase Auth: sign-up, anonymous sign-in and magic link are off  (threat model "live checks")
//
// Writes are aimed at a row that cannot exist (id = all zeros) or carry a body that fails a not-null check, so even
// a missing protection cannot change data. A write that is NOT answered 401/403 means a table grant exists: reported.
import { test, expect } from '../support/fixtures';
import { credentials } from '../support/env';
import { appApi, expectNone, line, lineWithBody, newSupabase, newUuid, rowsOf, staffToken, supabaseTarget, ZERO_UUID } from './support';

interface Table {
  name: string;
  key: string;
  staffCanRead: boolean;
}

const TABLES: Table[] = [
  { name: 'staff', key: 'user_id', staffCanRead: true },
  { name: 'quote_requests', key: 'id', staffCanRead: true },
  { name: 'quote_photos', key: 'id', staffCanRead: true },
  { name: 'quote_request_status_changes', key: 'id', staffCanRead: true },
  { name: 'ghl_sync_jobs', key: 'id', staffCanRead: true },
  { name: 'events', key: 'id', staffCanRead: true },
  { name: 'rate_limit_hits', key: 'id', staffCanRead: false },
  { name: 'spam_refusal_windows', key: 'id', staffCanRead: false },
  { name: 'sign_in_attempts', key: 'id', staffCanRead: false },
  { name: 'sign_in_pauses', key: 'id', staffCanRead: false },
];

const DENIED = [401, 403];

test.describe('direct database boundaries @probe', () => {
  test('@probe PRB-20 the anon key can read no table (every select is refused, none returns rows)', async ({ playwright }) => {
    const sb = await newSupabase(playwright);
    const failures: string[] = [];
    for (const t of TABLES) {
      const res = await sb.get(`/rest/v1/${t.name}?select=*&limit=1`);
      const rows = res.status() === 200 ? await rowsOf(res) : null;
      if (rows && rows.length > 0) failures.push(`CRITICAL ${line(`anon select ${t.name}`, res)} returned ${rows.length} row(s)`);
      else if (!DENIED.includes(res.status())) failures.push(`${line(`anon select ${t.name}`, res)} expected 401/403 (anon holds no privilege on any table)`);
    }
    const root = await sb.get('/rest/v1/');
    const rootText = root.status() === 200 ? await root.text() : '';
    if (/"paths"|"definitions"/.test(rootText)) failures.push(`${line('anon GET /rest/v1/', root)} returns the schema listing`);
    await sb.dispose();
    expect(failures, 'tables the anon key could read').toEqual([]);
  });

  test('@probe PRB-21 the anon key can write no table (insert, update and delete are all refused as permission errors)', async ({ playwright }) => {
    const sb = await newSupabase(playwright);
    const failures: string[] = [];
    for (const t of TABLES) {
      const filter = `${t.key}=eq.${ZERO_UUID}`;
      const attempts: Array<[string, () => ReturnType<typeof sb.post>]> = [
        ['insert', () => sb.post(`/rest/v1/${t.name}`, { data: {}, headers: { Prefer: 'return=minimal' } })],
        ['update', () => sb.patch(`/rest/v1/${t.name}?${filter}`, { data: { [t.key]: ZERO_UUID }, headers: { Prefer: 'return=minimal' } })],
        ['delete', () => sb.delete(`/rest/v1/${t.name}?${filter}`, { headers: { Prefer: 'return=minimal' } })],
      ];
      for (const [verb, send] of attempts) {
        const res = await send();
        if (res.status() >= 200 && res.status() < 300) failures.push(`CRITICAL ${line(`anon ${verb} ${t.name}`, res)} was accepted`);
        else if (!DENIED.includes(res.status())) failures.push(`${line(`anon ${verb} ${t.name}`, res)} expected 401/403: a grant exists and a check other than the privilege answered`);
      }
    }
    await sb.dispose();
    expect(failures, 'tables the anon key could write').toEqual([]);
  });

  for (const role of ['owner', 'helper'] as const) {
    test(`@probe PRB-22 (${role}) a staff token reads only the six readable tables; pending requests are invisible; events and jobs hold no personal data`, async ({ playwright }, testInfo) => {
      const token = await staffToken(playwright, role);
      const sb = await newSupabase(playwright, token);
      const failures: string[] = [];
      for (const t of TABLES) {
        const res = await sb.get(`/rest/v1/${t.name}?select=*&limit=1`);
        if (t.staffCanRead && res.status() !== 200) failures.push(`${line(`${role} select ${t.name}`, res)} expected 200 (the matrix lets staff read it)`);
        if (!t.staffCanRead && !DENIED.includes(res.status())) failures.push(`${line(`${role} select ${t.name}`, res)} expected 401/403 (no select grant on a counter table)`);
      }
      const pending = await sb.get('/rest/v1/quote_requests?select=id&state=neq.submitted&limit=5');
      const pendingRows = await rowsOf(pending);
      if (!pendingRows || pendingRows.length > 0) failures.push(`${line(`${role} select quote_requests where state is not submitted`, pending)} expected an empty list (invariant 5)`);
      const noRef = await sb.get('/rest/v1/quote_requests?select=id&reference=is.null&limit=5');
      const noRefRows = await rowsOf(noRef);
      if (!noRefRows || noRefRows.length > 0) failures.push(`${line(`${role} select quote_requests with no reference`, noRef)} expected an empty list`);

      // Invariant 11: ids, enums, booleans and counts only. An email or a phone number in events or job rows is a finding.
      const emailLike = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
      const phoneLike = /\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/;
      const hashLike = /\b[0-9a-f]{64}\b/;
      for (const table of ['events', 'ghl_sync_jobs']) {
        const res = await sb.get(`/rest/v1/${table}?select=*&limit=1000`);
        const text = res.status() === 200 ? JSON.stringify(await res.json()) : '';
        if (emailLike.test(text)) failures.push(`${table} holds something that looks like an email address (invariant 11)`);
        if (phoneLike.test(text)) failures.push(`${table} holds something that looks like a phone number (invariant 11)`);
        if (table === 'events' && hashLike.test(text)) failures.push('events holds a 64-hex value that looks like an address or email hash (invariant 11, SECURITY_MODEL "Network address")');
      }
      await sb.dispose();
      await expectNone(testInfo, failures, `${role} token read boundaries`);
    });

    test(`@probe PRB-23 (${role}) a staff token can write no table directly (insert, update, delete): every change goes through the RPCs`, async ({ playwright }, testInfo) => {
      const token = await staffToken(playwright, role);
      const sb = await newSupabase(playwright, token);
      const failures: string[] = [];
      for (const t of TABLES) {
        const filter = `${t.key}=eq.${ZERO_UUID}`;
        const attempts: Array<[string, () => ReturnType<typeof sb.post>]> = [
          ['insert', () => sb.post(`/rest/v1/${t.name}`, { data: {}, headers: { Prefer: 'return=minimal' } })],
          ['update', () => sb.patch(`/rest/v1/${t.name}?${filter}`, { data: { [t.key]: ZERO_UUID }, headers: { Prefer: 'return=minimal' } })],
          ['delete', () => sb.delete(`/rest/v1/${t.name}?${filter}`, { headers: { Prefer: 'return=minimal' } })],
        ];
        for (const [verb, send] of attempts) {
          const res = await send();
          if (res.status() >= 200 && res.status() < 300) failures.push(`CRITICAL ${line(`${role} ${verb} ${t.name}`, res)} was accepted`);
          else if (!DENIED.includes(res.status())) failures.push(`${line(`${role} ${verb} ${t.name}`, res)} expected 401/403 (authenticated has select only)`);
        }
      }
      await sb.dispose();
      await expectNone(testInfo, failures, `${role} token writes`);
    });
  }

  test('@probe PRB-28 a staff token stops working the moment its session is signed out (the API and the database both refuse it)', async ({ playwright }, testInfo) => {
    // Uses the helper account and `scope=local`, so only this one new session ends and no saved session of the owner or
    // the helper (QA1's) is touched. It is a successful sign-in followed by a sign-out of that same session.
    const { email, password } = credentials('helper');
    const grantClient = await newSupabase(playwright);
    const grant = await grantClient.post('/auth/v1/token?grant_type=password', { data: { email, password } });
    expect(grant.status(), line('helper sign-in through Supabase Auth', grant)).toBe(200);
    const token = ((await grant.json()) as { access_token: string }).access_token;
    await grantClient.dispose();

    const app = await appApi(playwright, token);
    const sb = await newSupabase(playwright, token);
    const failures: string[] = [];
    const before = await app.get('/api/staff/me');
    if (before.status() !== 200) failures.push(`${line('GET /api/staff/me with a fresh helper token', before)} expected 200 before sign-out`);
    const beforeRows = await rowsOf(await sb.get('/rest/v1/quote_requests?select=id&limit=1'));
    if (!beforeRows || beforeRows.length === 0) failures.push('REST read of quote_requests with a fresh helper token returned no rows before sign-out');

    const out = await sb.post('/auth/v1/logout?scope=local');
    if (out.status() !== 204) failures.push(`${line('POST /auth/v1/logout?scope=local', out)} expected 204`);

    for (const path of ['/api/staff/me', '/api/quote-requests?limit=1', '/api/weekly-counts/current']) {
      const res = await app.get(path);
      if (res.status() !== 401) failures.push(`CRITICAL ${await lineWithBody(`GET ${path} after the session was signed out`, res)} expected 401 (a signed-out session must stop working at once)`);
    }
    const afterRes = await sb.get('/rest/v1/quote_requests?select=id&limit=1');
    const afterRows = afterRes.status() === 200 ? await rowsOf(afterRes) : [];
    if (afterRows && afterRows.length > 0) failures.push('CRITICAL REST read of quote_requests still returns rows with a signed-out token');
    const afterStaff = await sb.get('/rest/v1/staff?select=user_id&limit=1');
    const afterStaffRows = afterStaff.status() === 200 ? await rowsOf(afterStaff) : [];
    if (afterStaffRows && afterStaffRows.length > 0) failures.push('CRITICAL REST read of staff still returns rows with a signed-out token');
    await app.dispose();
    await sb.dispose();
    await expectNone(testInfo, failures, 'session revocation');
  });

  test('@probe PRB-24 service-only functions are closed to anon and staff tokens; staff functions are closed to anon', async ({ playwright }) => {
    const anon = await newSupabase(playwright);
    const owner = await newSupabase(playwright, await staffToken(playwright, 'owner'));
    const helper = await newSupabase(playwright, await staffToken(playwright, 'helper'));
    // Arguments are chosen so that, if a call were ever allowed, it changes nothing (all-zero ids, null keys, an
    // invalid reason): the privilege check answers first (401/403); anything else means the function was reached.
    const serviceOnly: Array<[string, Record<string, unknown>]> = [
      ['take_submission_slot', { p_ip_hash: 'qa-probe' }],
      ['start_quote_request', { p_submission_key: null, p_name: 'x', p_phone: 'x', p_email: 'x', p_address: 'x', p_problem: 'x', p_urgency: 'soon', p_photo_count: 0, p_ip_hash: null }],
      ['record_spam_refusal', { p_ip_hash: 'qa-probe', p_reason: 'qa-probe-invalid' }],
      ['take_sign_in_attempt', { p_email_hash: null, p_ip_hash: null }],
      ['mark_sign_in_succeeded', { p_attempt_id: ZERO_UUID }],
      ['complete_quote_request', { p_request_id: ZERO_UUID }],
      ['claim_ghl_job', { p_request_id: ZERO_UUID, p_job_id: ZERO_UUID }],
      ['finish_ghl_job', { p_job_id: ZERO_UUID, p_lease_id: ZERO_UUID, p_outcome: 'qa-probe-invalid' }],
      ['find_ghl_contact_match', { p_request_id: ZERO_UUID }],
      ['ghl_stage_for_request', { p_request_id: ZERO_UUID }],
    ];
    const staffOnly: Array<[string, Record<string, unknown>]> = [
      ['save_quote_request_quote', { p_request_id: ZERO_UUID, p_price_cents: null, p_note: null, p_expected_version: 1 }],
      ['change_quote_request_status', { p_request_id: ZERO_UUID, p_to_status: 'won', p_expected_version: 1 }],
      ['request_ghl_copy_retry', { p_request_id: ZERO_UUID }],
      ['list_quote_requests', {}],
      ['weekly_counts', {}],
      ['current_staff', {}],
    ];
    const failures: string[] = [];
    for (const [fn, args] of serviceOnly) {
      for (const [who, client] of [['anon', anon], ['owner', owner], ['helper', helper]] as const) {
        const res = await client.post(`/rest/v1/rpc/${fn}`, { data: args });
        if (!DENIED.includes(res.status())) failures.push(`${line(`${who} rpc ${fn}`, res)} expected 401/403 (execute is granted to service_role only)`);
      }
    }
    for (const [fn, args] of staffOnly) {
      const res = await anon.post(`/rest/v1/rpc/${fn}`, { data: args });
      if (!DENIED.includes(res.status())) failures.push(`${line(`anon rpc ${fn}`, res)} expected 401/403 (revoked from anon)`);
    }
    await anon.dispose();
    await owner.dispose();
    await helper.dispose();
    expect(failures, 'functions that were reachable').toEqual([]);
  });

  test('@probe PRB-25 the private schemas (app_private, auth, storage) are not exposed through the REST API', async ({ playwright }) => {
    const staff = await newSupabase(playwright, await staffToken(playwright, 'owner'));
    const anon = await newSupabase(playwright);
    const failures: string[] = [];
    const targets: Array<[string, string]> = [
      ['app_private', 'quote_requests'],
      ['app_private', 'is_staff'],
      ['auth', 'users'],
      ['auth', 'sessions'],
      ['storage', 'objects'],
    ];
    for (const [schema, name] of targets) {
      for (const [who, client] of [['anon', anon], ['staff', staff]] as const) {
        const res = await client.get(`/rest/v1/${name}?select=*&limit=1`, { headers: { 'Accept-Profile': schema } });
        const rows = res.status() === 200 ? await rowsOf(res) : null;
        if (res.status() === 200) failures.push(`CRITICAL ${line(`${who} select ${schema}.${name} through the REST API`, res)} answered 200 (${rows ? rows.length : '?'} row(s))`);
      }
    }
    await staff.dispose();
    await anon.dispose();
    expect(failures, 'private schemas reachable through REST').toEqual([]);
  });

  test('@probe PRB-26 Supabase Auth: sign-up, anonymous sign-in and one-time-link creation are off (no account, no session, nothing sent)', async ({ playwright }) => {
    const anon = await newSupabase(playwright);
    const throwaway = `qa-probe-${Date.now().toString(36)}-${newUuid().slice(0, 6)}@example.test`;
    const failures: string[] = [];

    const settings = await anon.get('/auth/v1/settings');
    if (settings.status() === 200) {
      const s = (await settings.json()) as { disable_signup?: boolean; external?: Record<string, boolean>; mailer_autoconfirm?: boolean };
      if (s.disable_signup !== true) failures.push('settings: disable_signup is not true');
      const enabled = Object.entries(s.external ?? {}).filter(([name, on]) => on && name !== 'email').map(([name]) => name);
      if (enabled.length > 0) failures.push(`settings: external providers enabled besides email: ${enabled.join(', ')}`);
      if (s.external?.['anonymous_users']) failures.push('settings: anonymous sign-ins are enabled');
    } else {
      failures.push(`${line('GET /auth/v1/settings', settings)} could not read the public settings`);
    }

    const signUp = await anon.post('/auth/v1/signup', { data: { email: throwaway, password: 'Throwaway-passw0rd-14!' } });
    const signUpBody = signUp.status() < 300 ? JSON.stringify(await signUp.json()) : '';
    if (signUp.status() < 300) failures.push(`CRITICAL ${line('POST /auth/v1/signup with a throwaway email', signUp)} was accepted${/access_token/.test(signUpBody) ? ' and returned a session' : ''}. A throwaway account now exists on staging and must be removed.`);

    const anonymous = await anon.post('/auth/v1/signup', { data: {} });
    const anonBody = anonymous.status() < 300 ? JSON.stringify(await anonymous.json()) : '';
    if (anonymous.status() < 300) failures.push(`CRITICAL ${line('POST /auth/v1/signup with no email (anonymous sign-in)', anonymous)} was accepted${/access_token/.test(anonBody) ? ' and returned a session' : ''}`);

    const otp = await anon.post('/auth/v1/otp', { data: { email: throwaway, create_user: false } });
    const otpBody = otp.status() < 300 ? await otp.text() : '';
    if (/access_token/.test(otpBody)) failures.push(`${line('POST /auth/v1/otp', otp)} returned a session`);

    const fakeLogin = await anon.post('/auth/v1/token?grant_type=password', { data: { email: throwaway, password: 'Throwaway-passw0rd-14!' } });
    if (fakeLogin.status() === 200) failures.push(`CRITICAL ${line('password grant for a throwaway email', fakeLogin)} signed someone in`);

    await anon.dispose();
    expect(failures, 'Supabase Auth settings that did not hold').toEqual([]);
  });

  test('@probe PRB-27 the Supabase URL probed is the one the staging app uses (so these results describe the app\'s own database)', async ({ playwright }) => {
    const target = supabaseTarget();
    const app = await appApi(playwright);
    const home = await app.get('/sign-in');
    const html = await home.text();
    const csp = home.headers()['content-security-policy'] ?? '';
    await app.dispose();
    expect(home.status(), line('GET /sign-in', home)).toBe(200);
    expect(html.includes(target.host) || csp.includes(target.host), 'the sign-in page or its CSP names the Supabase host the probes call').toBe(true);
  });
});
