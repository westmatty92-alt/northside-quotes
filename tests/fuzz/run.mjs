// Schemathesis contract fuzz of the deployed staging API (QA2). Called by tests/fuzz/run.sh.
//
// What it does
//   Runs Schemathesis over docs/openapi.yaml against $STAGING_URL/api, three times:
//     anonymous   no Authorization header (public routes; every staff route must answer a documented 401)
//     staff       Authorization: Bearer <the owner's access token, got from Supabase Auth like a browser does>
//     jobs        the two cron routes with no secret: the documented 401 only (one example each, no mutation)
//   Every run sends x-vercel-protection-bypass to the staging host only.
//
// Kept gentle on the shared staging project: 20 examples per operation, one worker, 5 requests a second, no
// stateful phase (creating a request needs a signed form token a fuzzer cannot get, so every create is a documented 401).
//
// Left out on purpose
//   /auth/sign-in  fuzzed emails would be counted as failed sign-ins and pause this machine's address for everyone
//                  (the lockout is probed by hand in tests/e2e/probes/60-sign-in.probe.spec.ts, throwaway emails only)
//   /storage/...   Supabase Storage, not our app (documented in the contract for the two lanes only)
//   /jobs/...      only in the third run, for the 401
//
// First-run triage (ledger run against staging bb54c17, 2026-11-24): what was configuration noise, and what changed
//   1. Credentials Schemathesis invented. When a header is not given with --header, Schemathesis generates one from the
//      contract's security schemes (Authorization, X-Form-Token) and, in its coverage phase, random header names. Those
//      values hold Latin-1 characters that Vercel's edge refuses with its own plain-text "400 Bad Request" before the app
//      runs, which Schemathesis then reports as "Undocumented Content-Type", "Undocumented HTTP status code" and "Rejected
//      positive data" on 12 cases. Now every identity header is fixed per run: a junk bearer (anonymous), the owner's token
//      (staff), a wrong cron secret (jobs), and one well-formed but unsigned form token on every run. The documented answer
//      for each is 401. (If a plain-text 400 still shows up with these fixed ASCII headers, it is not noise: ticket it.)
//   2. Two checks are off, by name, in EXCLUDED_CHECKS below. Everything else stays on, and not_a_server_error can never be
//      excluded (the script refuses to start if it is listed).
//        unsupported_method       Schemathesis sends TRACE to every operation; Vercel's platform answers it itself
//                                 ("NOT_ALLOWED", plain text, no Allow header) and the request never reaches the app.
//                                 The app's own 405 (problem+json, Allow header) is probed by PRB-05 on 16 methods.
//        missing_required_header  a false positive here: it removes Authorization from the case but the --header value is
//                                 sent again by the transport, so /staff/me answered 200 "with no header". PRB-01 sends
//                                 no Authorization at all to all 9 staff routes and gets 401 on every one (passing at
//                                 bb54c17). For X-Form-Token the check expects 406 where the contract documents 401
//                                 form_token_invalid (PRB-31, PRB-34).
//   3. The create route's body is not fuzzed: with no valid signed form token (one at least 3 seconds old, one of 5
//      submissions per 10 minutes) every create answers the documented 401 first. Its input rules are probed by PRB-74,
//      74b, 75 and 76 instead.
//   4. Reports: junit and har. The HAR file is read after each run and every 5xx is printed with its Vercel request id
//      and request body, so a ticket does not need a second run. Counts only use report files this run wrote.
//
// Exit codes: 0 no finding · 1 findings (a 5xx, a response that breaks the contract, an undocumented status) ·
//             2 setup problem (missing variable name, refused host, no token) or a Schemathesis run that did not
//               complete (a usage error, a crash, or a run that tested nothing: none of these is a pass) ·
//             3 Schemathesis is not installed (NOT RUN, never a pass).
//
// Schemathesis itself: only the pinned one in .baseleap/tools/venv, which tests/fuzz/run.sh installs (exact version,
// exit 3 if the install fails) and passes in as $SCHEMATHESIS_BIN. This file never installs anything. Run it through
// run.sh. Secrets are never printed: every value is replaced by its variable name in the output, and the raw reports
// stay in .baseleap/tools/fuzz-reports (git-ignored).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);
try {
  process.loadEnvFile(path.join(ROOT, '.env.local'));
} catch {
  // no .env.local: the variables must already be in the environment
}

const VENV_BIN = path.join(ROOT, '.baseleap/tools/venv/bin/schemathesis');
const SUMMARY = path.join(ROOT, 'tests/fuzz/last-run.txt');
const REPORTS = path.join(ROOT, '.baseleap/tools/fuzz-reports');

function stop(code, message) {
  console.error(message);
  process.exit(code);
}

// ---- 1. target: the staging preview only ------------------------------------------------------------------------
const rawUrl = process.env.STAGING_URL;
if (!rawUrl) stop(2, 'STAGING_URL is not set (set it in .env.local; its value is never printed).');
let target;
try {
  target = new URL(rawUrl);
} catch {
  stop(2, 'STAGING_URL is not a valid URL.');
}
const production = (process.env.PRODUCTION_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
if (target.protocol !== 'https:') stop(2, 'Refusing to fuzz: STAGING_URL must be https.');
if (production.includes(target.host)) stop(2, `Refusing to fuzz production (${target.host}).`);
if (!/^[a-z0-9][a-z0-9-]*-git-staging-[a-z0-9-]+\.vercel\.app$/.test(target.host)) stop(2, `Refusing to fuzz ${target.host}: not a staging preview host (<project>-git-staging-<team>.vercel.app).`);
const base = `${target.origin}/api`;

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (!bypass) stop(2, 'VERCEL_AUTOMATION_BYPASS_SECRET is not set (the preview is protected).');

// ---- 2. Schemathesis ----------------------------------------------------------------------------------------------
const schemathesisBin = process.env.SCHEMATHESIS_BIN || VENV_BIN;
const probe = fs.existsSync(schemathesisBin) ? spawnSync(schemathesisBin, ['--version'], { encoding: 'utf8' }) : null;
if (!probe || probe.status !== 0) {
  stop(3, 'NOT RUN: the pinned Schemathesis is not installed in .baseleap/tools/venv. No fuzz result exists. This is not a pass.\nRun it through tests/fuzz/run.sh, which installs it.');
}
const st = [schemathesisBin];
const stVersion = `${probe.stdout}${probe.stderr}`.match(/\d+\.\d+\.\d+/)?.[0] ?? 'unknown';
const pinned = process.env.SCHEMATHESIS_PINNED_VERSION;
if (pinned && pinned !== stVersion) stop(3, `NOT RUN: Schemathesis ${stVersion} is installed but ${pinned} is pinned. This is not a pass.`);
console.log(`Schemathesis version in use: ${stVersion}${pinned ? ` (pinned ${pinned})` : ' (no pin passed: run through run.sh)'}`);

// ---- 3. a staff token, got the way a browser client gets one ---------------------------------------------------------
async function staffToken() {
  const url = process.env.SUPABASE_STAGING_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_STAGING_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.QA_OWNER_EMAIL;
  const password = process.env.QA_OWNER_PASSWORD;
  if (!url || !anon || !email || !password) stop(2, 'Need SUPABASE_STAGING_URL, SUPABASE_STAGING_ANON_KEY, QA_OWNER_EMAIL and QA_OWNER_PASSWORD (names only; values are never printed).');
  const host = new URL(url).host;
  if (!host.endsWith('.supabase.co')) stop(2, 'The Supabase URL is not a *.supabase.co project.');
  if (process.env.SUPABASE_PROD_PROJECT_REF && host.startsWith(`${process.env.SUPABASE_PROD_PROJECT_REF}.`)) stop(2, 'Refusing to use the production Supabase project.');
  const res = await fetch(`${new URL(url).origin}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) stop(2, `Could not get a staff token (Supabase Auth answered ${res.status}). One successful sign-in is expected; nothing was retried.`);
  const json = await res.json();
  if (!json.access_token) stop(2, 'Supabase Auth answered without an access token.');
  return json.access_token;
}
const token = await staffToken();

// ---- 4. redaction: values never reach the output ------------------------------------------------------------------------
const secrets = [
  ['VERCEL_AUTOMATION_BYPASS_SECRET', bypass],
  ['STAFF_ACCESS_TOKEN', token],
  ['QA_OWNER_PASSWORD', process.env.QA_OWNER_PASSWORD],
  ['SUPABASE_STAGING_ANON_KEY', process.env.SUPABASE_STAGING_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
].filter(([, v]) => typeof v === 'string' && v.length >= 8);
const redact = (text) => secrets.reduce((acc, [name, value]) => acc.split(value).join(`$${name}`), text);

fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
fs.mkdirSync(REPORTS, { recursive: true });
const log = [`# Schemathesis ${stVersion} run ${new Date().toISOString()} against ${base}`];
const echo = (line) => {
  const clean = redact(line);
  log.push(clean);
  console.log(clean);
};

// ---- 5. the runs ------------------------------------------------------------------------------------------------------
// Checks that are off, and why: see the header, point 2. The server-error check must never be one of them.
const EXCLUDED_CHECKS = ['unsupported_method', 'missing_required_header'];
if (EXCLUDED_CHECKS.includes('not_a_server_error')) stop(2, 'not_a_server_error must stay on for every operation: remove it from EXCLUDED_CHECKS.');

// Identity headers are fixed so Schemathesis does not invent them (header, point 1). None of these is a secret.
const FORM_TOKEN_PLACEHOLDER = 'v1.0.00000000-0000-4000-8000-000000000000.fuzz-run-unsigned-token';
const JUNK_BEARER = 'Bearer fuzz-run-not-a-valid-token';
const WRONG_CRON_SECRET = 'Bearer fuzz-run-wrong-cron-secret';
const formToken = ['--header', `X-Form-Token: ${FORM_TOKEN_PLACEHOLDER}`];

const common = [
  '--url', base,
  '--header', `x-vercel-protection-bypass: ${bypass}`,
  '--checks', 'all',
  '--exclude-checks', EXCLUDED_CHECKS.join(','),
  '--rate-limit', '5/s',
  '--workers', '1',
  '--no-color',
];
const extra = (process.env.SCHEMATHESIS_EXTRA_ARGS ?? '').split(' ').filter(Boolean);
const fuzzPhases = ['--phases', 'examples,coverage,fuzzing', '--max-examples', '20', '--exclude-path-regex', '^/(jobs|auth|storage)'];

const runs = [
  { name: 'anonymous', args: [...common, '--header', `Authorization: ${JUNK_BEARER}`, ...formToken, ...fuzzPhases] },
  { name: 'staff', args: [...common, '--header', `Authorization: Bearer ${token}`, ...formToken, ...fuzzPhases] },
  // One generated case per cron route, sent with a wrong secret: the documented 401 only.
  { name: 'jobs', args: [...common, '--header', `Authorization: ${WRONG_CRON_SECRET}`, '--phases', 'fuzzing', '--max-examples', '1', '--include-path-regex', '^/jobs/'] },
];

/** Every 5xx a run saw, with its Vercel request id, read from the HAR report this run wrote. Never throws. */
function serverErrors(dir, since) {
  const found = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((n) => /\.har(\.json)?$/.test(n) && fs.statSync(path.join(dir, n)).mtimeMs >= since);
  } catch {
    return found;
  }
  for (const f of files) {
    try {
      const har = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const entry of har?.log?.entries ?? []) {
        const status = entry?.response?.status;
        if (typeof status !== 'number' || status < 500) continue;
        const id = (entry.response.headers ?? []).find((h) => String(h?.name).toLowerCase() === 'x-vercel-id')?.value ?? 'n/a';
        const body = entry.request?.postData?.text ? ` body ${String(entry.request.postData.text).slice(0, 300)}` : '';
        found.push(`${entry.request?.method} ${entry.request?.url} -> ${status}, request id ${id}${body}`);
      }
    } catch (e) {
      found.push(`could not read the HAR report ${f}: ${e.message}`);
    }
  }
  return found;
}

function runOne(run) {
  return new Promise((resolve) => {
    const dir = path.join(REPORTS, run.name);
    fs.mkdirSync(dir, { recursive: true });
    const [cmd, ...pre] = st;
    const args = [...pre, 'run', 'docs/openapi.yaml', ...run.args, ...extra, '--report', 'junit,har', '--report-dir', dir];
    const since = Date.now() - 1_000;
    echo(`\n## run: ${run.name}`);
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let pending = '';
    const feed = (chunk) => {
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const l of lines) echo(l);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => {
      echo(`could not start Schemathesis: ${e.message}`);
      resolve({ run: run.name, code: 2, tests: 0, failures: 0, errors: 0 });
    });
    child.on('close', (code) => {
      if (pending) echo(pending);
      let tests = 0;
      let failures = 0;
      let errors = 0;
      // Only the report files this run wrote: earlier runs' files stay in the folder and must not be counted again.
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.xml') && fs.statSync(path.join(dir, n)).mtimeMs >= since)) {
        const xml = fs.readFileSync(path.join(dir, f), 'utf8');
        const head = xml.match(/<testsuites?[^>]*>/)?.[0] ?? '';
        tests += Number(head.match(/\btests="(\d+)"/)?.[1] ?? 0);
        failures += Number(head.match(/\bfailures="(\d+)"/)?.[1] ?? 0);
        errors += Number(head.match(/\berrors="(\d+)"/)?.[1] ?? 0);
      }
      const errors5xx = serverErrors(dir, since);
      if (errors5xx.length > 0) {
        echo(`\n5xx responses seen by the ${run.name} run (${errors5xx.length}), with their Vercel request ids:`);
        for (const e of errors5xx) echo(`  ${e}`);
      }
      resolve({ run: run.name, code: code ?? 2, tests, failures, errors });
    });
  });
}

const results = [];
for (const run of runs) results.push(await runOne(run));

echo('\n## summary');
let findings = false;
let incomplete = false;
for (const r of results) {
  echo(`${r.run}: exit ${r.code}, ${r.tests} test cases, ${r.failures} failures, ${r.errors} errors`);
  // Schemathesis exits 1 when a check fails; any other non-zero code (2: usage error, a crash) means the run did not
  // finish, and a run that exercised nothing proves nothing. Neither is a pass.
  if (r.code > 1 || r.code < 0) incomplete = true;
  else if (r.code === 0 && r.tests === 0) incomplete = true;
  if (r.code === 1 || r.failures > 0 || r.errors > 0) findings = true;
}
if (incomplete) echo('NOT PROVEN: at least one Schemathesis run did not complete or tested nothing (see its output above). This is not a pass.');
if (findings) echo('FINDINGS: see the failures above; each prints a curl reproduction.');
fs.writeFileSync(SUMMARY, `${log.join('\n')}\n`);
process.exit(findings ? 1 : incomplete ? 2 : 0);
