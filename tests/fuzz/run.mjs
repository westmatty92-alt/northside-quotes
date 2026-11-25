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
const common = ['--url', base, '--header', `x-vercel-protection-bypass: ${bypass}`, '--checks', 'all', '--rate-limit', '5/s', '--workers', '1', '--no-color'];
const extra = (process.env.SCHEMATHESIS_EXTRA_ARGS ?? '').split(' ').filter(Boolean);
const fuzzPhases = ['--phases', 'examples,coverage,fuzzing', '--max-examples', '20', '--exclude-path-regex', '^/(jobs|auth|storage)'];

const runs = [
  { name: 'anonymous', args: [...common, ...fuzzPhases] },
  { name: 'staff', args: [...common, '--header', `Authorization: Bearer ${token}`, ...fuzzPhases] },
  // One generated case per cron route, sent with no secret: the documented 401 only.
  { name: 'jobs', args: [...common, '--phases', 'fuzzing', '--max-examples', '1', '--include-path-regex', '^/jobs/'] },
];

function runOne(run) {
  return new Promise((resolve) => {
    const dir = path.join(REPORTS, run.name);
    fs.mkdirSync(dir, { recursive: true });
    const [cmd, ...pre] = st;
    const args = [...pre, 'run', 'docs/openapi.yaml', ...run.args, ...extra, '--report', 'junit', '--report-dir', dir];
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
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.xml'))) {
        const xml = fs.readFileSync(path.join(dir, f), 'utf8');
        const head = xml.match(/<testsuites?[^>]*>/)?.[0] ?? '';
        tests += Number(head.match(/\btests="(\d+)"/)?.[1] ?? 0);
        failures += Number(head.match(/\bfailures="(\d+)"/)?.[1] ?? 0);
        errors += Number(head.match(/\berrors="(\d+)"/)?.[1] ?? 0);
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
