#!/usr/bin/env node
// .github/scripts/api-tests-local-db.mjs (owned by bl-devops). The one runner for the `api-tests` check, used by
// .github/workflows/ci.yml AND by hand, so CI and a laptop run exactly the same thing (kit lesson K5: no live password
// may decide whether the tests run).
//
//   node .github/scripts/api-tests-local-db.mjs            from the repository root
//   node .github/scripts/api-tests-local-db.mjs --stop     the same, then stop the local stack afterwards
//   node .github/scripts/api-tests-local-db.mjs --self-test  checks the parsing and guard helpers; no Docker, no network
//
// What it does:
//   1. Starts the throwaway local Supabase stack (`npx --no-install supabase start`, ports and project_id from
//      supabase/config.toml), or reuses it when it is already running.
//   2. `supabase db reset --local`: drops the local database and applies every file in supabase/migrations (and
//      supabase/seed.sql when one exists), so every run starts from the same empty, migrated database.
//   3. Reads the stack's address and keys from `supabase status -o json` (local demo keys, not secrets).
//   4. Creates the two staff accounts through the Auth admin API with the FIXED test passwords below, then registers them
//      as staff with `supabase/scripts/db.mjs staff-add --local`.
//   5. Runs the same vitest command CI always ran, with the environment pointed at the local stack ONLY. Variables that
//      would aim the tests at a hosted project (SUPABASE_STAGING_REF, SUPABASE_PROD_PROJECT_REF, ...) are removed, and the
//      script refuses to run when any address it is about to hand the tests is not on this machine.
//
// Why every variable the test helpers need is set here: tests/helpers/staging-env.ts and tests/integrations/staging-env.ts
// read `.env.local` (this checkout, then the main checkout) only for a required variable that is ABSENT from the process.
// All of them are set below, so no `.env.local` is ever opened and no real staging value can leak in.
//
// Values here are test data for a database that is deleted when the job ends. They are not secrets and protect nothing.
// Needs: Docker, psql on PATH, `npm ci` done (the Supabase CLI and vitest are devDependencies).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- Fixed test accounts (the ONLY place their passwords are written). Minimum length is 12 (supabase/config.toml). -------
export const TEST_ACCOUNTS = {
  owner: { email: 'owner@northside.test', password: 'northside-local-owner-pw-1' },
  helper: { email: 'helper@northside.test', password: 'northside-local-helper-pw-1' },
};

/** The vitest command CI has always run for `api-tests` (tests/integrations/**\/db.test.ts are excluded from test:offline). */
export const VITEST_ARGS = [
  'run',
  'tests/api',
  'tests/integrations/ghl/db.test.ts',
  'tests/integrations/routes/db.test.ts',
  '--passWithNoTests=false',
];

/** Variables that could aim the tests, the CLI or the app at a hosted project, or add a value CI never provides. */
export const SCRUBBED_ENV = [
  'SUPABASE_STAGING_REF',
  'SUPABASE_PROD_PROJECT_REF',
  'SUPABASE_PRODUCTION_REF',
  'SUPABASE_PRODUCTION_DB_URL',
  'APP_SIGNING_SECRET', // the tests make their own random one per file
  'CRON_SECRET', // same
  'SITE_URL',
  'GHL_PRIVATE_INTEGRATION_TOKEN',
  'GHL_LOCATION_ID',
  'GHL_API_BASE_URL',
  'NEXT_PUBLIC_API_MOCKING',
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_TOKEN',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'STAGING_URL',
  'PRODUCTION_HOSTS',
];

/** Generic pattern, so no provider's access-token variable reaches the tests whatever it is called (no such variable is used by this project). */
export const SCRUBBED_ENV_PATTERN = /_ACCESS_TOKEN$/;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const log = (msg) => console.log(`api-tests-local-db: ${msg}`);

function die(msg) {
  console.error(`api-tests-local-db: ERROR: ${msg}`);
  process.exit(1);
}

/** The first JSON object in the CLI's output (it can print notices before and after). */
export function parseStatusJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('supabase status printed no JSON object');
  const data = JSON.parse(text.slice(start, end + 1));
  return data;
}

/** The address and keys the tests need, from the CLI's status. Prefers the JWT keys (ANON_KEY, SERVICE_ROLE_KEY). */
export function pickStack(status) {
  const apiUrl = status.API_URL;
  const anon = status.ANON_KEY || status.PUBLISHABLE_KEY;
  const service = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  const dbUrl = status.DB_URL;
  const missing = Object.entries({ API_URL: apiUrl, ANON_KEY: anon, SERVICE_ROLE_KEY: service, DB_URL: dbUrl })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`supabase status did not report ${missing.join(', ')}`);
  return { apiUrl, anon, service, dbUrl };
}

/** True only for an http(s)/postgres address on this machine. */
export function isLocalAddress(address) {
  try {
    return LOCAL_HOSTS.has(new URL(address).hostname);
  } catch {
    return false;
  }
}

/** The environment the tests get: the parent's, minus the scrubbed names, plus the local stack and the test accounts. */
export function buildTestEnv(parentEnv, stack) {
  const env = { ...parentEnv };
  for (const name of SCRUBBED_ENV) delete env[name];
  for (const name of Object.keys(env)) if (SCRUBBED_ENV_PATTERN.test(name)) delete env[name];
  Object.assign(env, {
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anon,
    SUPABASE_SERVICE_ROLE_KEY: stack.service,
    // the "staging" names some helpers and tests read; here they name the local stack too
    SUPABASE_STAGING_URL: stack.apiUrl,
    SUPABASE_STAGING_ANON_KEY: stack.anon,
    SUPABASE_STAGING_SERVICE_ROLE_KEY: stack.service,
    SUPABASE_STAGING_DB_URL: stack.dbUrl, // the helpers run psql against it
    QA_OWNER_EMAIL: TEST_ACCOUNTS.owner.email,
    QA_OWNER_PASSWORD: TEST_ACCOUNTS.owner.password,
    QA_HELPER_EMAIL: TEST_ACCOUNTS.helper.email,
    QA_HELPER_PASSWORD: TEST_ACCOUNTS.helper.password,
  });
  return env;
}

// ---- self-test ------------------------------------------------------------------------------------------------------
function selfTest() {
  const results = [];
  const expect = (name, ok) => results.push([name, Boolean(ok)]);
  const stack = { apiUrl: 'http://127.0.0.1:1', anon: 'a', service: 's', dbUrl: 'postgresql://127.0.0.1:2/postgres' };
  const parsed = parseStatusJson('Stopped services: [x]\n{"API_URL":"http://127.0.0.1:1","ANON_KEY":"a","SERVICE_ROLE_KEY":"s","DB_URL":"postgresql://127.0.0.1:2/postgres"}\nnotice');
  expect('status JSON is found between CLI notices', parsed.API_URL === 'http://127.0.0.1:1');
  expect('pickStack returns the four values', pickStack(parsed).service === 's');
  expect('pickStack falls back to the new key names', pickStack({ API_URL: 'u', PUBLISHABLE_KEY: 'p', SECRET_KEY: 's', DB_URL: 'd' }).anon === 'p');
  expect('pickStack names what is missing', (() => { try { pickStack({ API_URL: 'u' }); return false; } catch (e) { return /ANON_KEY, SERVICE_ROLE_KEY, DB_URL/.test(e.message); } })());
  expect('no JSON is an error', (() => { try { parseStatusJson('nothing'); return false; } catch { return true; } })());
  const env = buildTestEnv({ SUPABASE_STAGING_REF: 'abc', SUPABASE_PROD_PROJECT_REF: 'def', APP_SIGNING_SECRET: 'x', PATH: '/bin', NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co' }, stack);
  expect('the hosted-project guards are removed', env.SUPABASE_STAGING_REF === undefined && env.SUPABASE_PROD_PROJECT_REF === undefined);
  const tokenEnv = buildTestEnv({ EXAMPLE_ACCESS_TOKEN: 't', OTHER_ACCESS_TOKEN: 't', ACCESS_TOKEN_NOTE: 'keep', PATH: '/bin' }, stack);
  expect('any name ending _ACCESS_TOKEN is removed', tokenEnv.EXAMPLE_ACCESS_TOKEN === undefined && tokenEnv.OTHER_ACCESS_TOKEN === undefined);
  expect('only the ending is matched', tokenEnv.ACCESS_TOKEN_NOTE === 'keep' && tokenEnv.PATH === '/bin');
  expect('a parent value for a required name is replaced by the local one', env.NEXT_PUBLIC_SUPABASE_URL === stack.apiUrl);
  expect('every variable the helpers require is set', ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STAGING_DB_URL', 'QA_OWNER_PASSWORD', 'QA_HELPER_PASSWORD'].every((n) => env[n]));
  expect('unrelated variables survive', env.PATH === '/bin');
  expect('a hosted address is not local', !isLocalAddress('https://abcdefghijklmnopqrst.supabase.co') && !isLocalAddress('postgresql://aws-0-ca-central-1.pooler.supabase.com:5432/postgres') && !isLocalAddress('nonsense'));
  expect('local addresses are local', isLocalAddress('http://127.0.0.1:61421') && isLocalAddress('postgresql://localhost:61422/postgres'));
  expect('test passwords meet the 12-character minimum', Object.values(TEST_ACCOUNTS).every((a) => a.password.length >= 12));
  const failed = results.filter(([, ok]) => !ok);
  for (const [name, ok] of results) console.log(`${ok ? 'ok' : 'NOT OK'} - ${name}`);
  console.log(failed.length ? `self-test FAILED: ${failed.length} of ${results.length}` : `self-test passed: ${results.length} of ${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

// ---- main -----------------------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The Supabase CLI reads every .env* file in its project directory (and stops on a line it cannot parse), and treats
 * SUPABASE_* variables as its own settings. It needs neither, so it runs in a throwaway directory holding only the config,
 * the migrations and the seed (the same approach as supabase/scripts/db.mjs). The stack is found by project_id, so the
 * containers are the same ones whichever directory starts them.
 */
function makeCliDir(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'northside-api-tests-'));
  const src = path.join(root, 'supabase');
  const dst = path.join(dir, 'supabase');
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'config.toml'), path.join(dst, 'config.toml'));
  if (fs.existsSync(path.join(src, 'migrations'))) fs.cpSync(path.join(src, 'migrations'), path.join(dst, 'migrations'), { recursive: true });
  if (fs.existsSync(path.join(src, 'seed.sql'))) fs.copyFileSync(path.join(src, 'seed.sql'), path.join(dst, 'seed.sql'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const unknown = args.filter((a) => a !== '--stop');
  if (unknown.length) die(`unknown argument(s): ${unknown.join(' ')} (usage: --stop | --self-test)`);
  const stopAfter = args.includes('--stop');

  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'supabase', 'config.toml')) || !fs.existsSync(path.join(root, 'package.json'))) {
    die('run this from the repository root (supabase/config.toml and package.json must be in the current directory).');
  }
  const bin = (name) => path.join(root, 'node_modules', '.bin', name);
  for (const tool of ['supabase', 'vitest']) {
    if (!fs.existsSync(bin(tool))) die(`${tool} is not installed (node_modules/.bin/${tool}); run npm ci first.`);
  }
  const psql = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  if (psql.error || psql.status !== 0) die('psql is not installed or not on PATH; the tests clean up with it.');
  log(psql.stdout.trim());

  if (fs.existsSync(path.join(root, '.env.local'))) {
    log('note: .env.local exists here. This script does not read it, and every variable the test helpers load it for is set, so it is never opened by them. (`next start`, which a few tests launch, would still load it for names that are not set.)');
  }

  const cliDir = makeCliDir(root);
  const cliEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SUPABASE_|NEXT_PUBLIC_|QA_|VERCEL_|STAGING_|APP_|GHL_|CRON_)/.test(k)));
  Object.assign(cliEnv, { SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' });
  const cli = (cliArgs, { capture = false } = {}) =>
    spawnSync(bin('supabase'), [...cliArgs, '--agent', 'no'], {
      cwd: cliDir,
      env: cliEnv,
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      maxBuffer: 64 * 1024 * 1024,
    });

  // 1. start, or reuse
  const running = cli(['status', '-o', 'json'], { capture: true });
  if (running.status === 0) {
    log('the local Supabase stack is already running: reusing it');
  } else {
    log('starting the local Supabase stack (npx --no-install supabase start)');
    const started = cli(['start']);
    if (started.status !== 0) die(`supabase start failed (exit ${started.status}). Is Docker running? Stale containers: run \`npx --no-install supabase stop --no-backup\` and try again.`);
  }

  // 2. a clean, fully migrated database on every run
  log('resetting the local database (supabase db reset --local): applies supabase/migrations' + (fs.existsSync(path.join(root, 'supabase', 'seed.sql')) ? ' and supabase/seed.sql' : ''));
  const reset = cli(['db', 'reset', '--local']);
  if (reset.status !== 0) die(`supabase db reset failed (exit ${reset.status}). Try \`npx --no-install supabase stop --no-backup\` and run this again.`);

  // 3. address and keys
  const statusRun = cli(['status', '-o', 'json'], { capture: true });
  if (statusRun.status !== 0) die(`supabase status failed (exit ${statusRun.status}).`);
  let stack;
  try {
    stack = pickStack(parseStatusJson(statusRun.stdout));
  } catch (e) {
    die(e.message);
  }
  for (const [what, address] of [['API address', stack.apiUrl], ['database address', stack.dbUrl]]) {
    if (!isLocalAddress(address)) die(`the ${what} reported by the stack is not on this machine; refusing to run tests that delete rows.`);
  }
  log(`stack: API ${stack.apiUrl}, database port ${new URL(stack.dbUrl).port} (local demo keys)`);

  // 4. the two staff accounts
  for (const [role, account] of Object.entries(TEST_ACCOUNTS)) {
    await createAuthUser(stack, account);
    const staff = spawnSync(process.execPath, ['supabase/scripts/db.mjs', 'staff-add', account.email, '--local'], { cwd: root, encoding: 'utf8', env: buildTestEnv(process.env, stack) });
    if (staff.status !== 0) die(`registering the ${role} as staff failed (exit ${staff.status}): ${(staff.stderr || staff.stdout).trim().slice(-500)}`);
    log((staff.stdout.trim().split('\n').pop() ?? '').replace(/^db: /, ''));
  }

  // 5. the tests
  const testEnv = buildTestEnv(process.env, stack);
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_STAGING_URL', 'SUPABASE_STAGING_DB_URL']) {
    if (!isLocalAddress(testEnv[name])) die(`${name} is not a local address; refusing to run.`);
  }
  log(`vitest ${VITEST_ARGS.join(' ')}`);
  const tests = spawnSync(bin('vitest'), VITEST_ARGS, { cwd: root, env: testEnv, stdio: 'inherit' });

  if (stopAfter) {
    log('stopping the local Supabase stack');
    cli(['stop']);
  }
  if (tests.error) die(`vitest could not run: ${tests.error.message}`);
  process.exit(tests.status ?? 1);
}

/** Creates one confirmed Auth user with the admin API; when it already exists, sets its password. Prints no key and no password. */
async function createAuthUser(stack, account) {
  const headers = { apikey: stack.service, authorization: `Bearer ${stack.service}`, 'content-type': 'application/json' };
  const base = `${stack.apiUrl}/auth/v1/admin/users`;
  let last = '';
  // the Auth container can still be settling right after a reset: retry for up to 60 s
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ email: account.email, password: account.password, email_confirm: true }) });
      if (res.ok) {
        log(`created Auth user ${account.email}`);
        return;
      }
      const body = await res.text();
      if (res.status === 422 && /already|exists|registered/i.test(body)) {
        const list = await fetch(`${base}?per_page=1000`, { headers });
        const users = (await list.json()).users ?? [];
        const found = users.find((u) => String(u.email).toLowerCase() === account.email);
        if (!found) die(`Auth says ${account.email} exists but it is not in the user list.`);
        const put = await fetch(`${base}/${found.id}`, { method: 'PUT', headers, body: JSON.stringify({ password: account.password, email_confirm: true }) });
        if (!put.ok) die(`could not reset the password of ${account.email} (HTTP ${put.status}).`);
        log(`Auth user ${account.email} already existed: password set to the test value`);
        return;
      }
      last = `HTTP ${res.status}`;
      if (res.status < 500) die(`creating ${account.email} failed (${last}): ${body.slice(0, 300)}`);
    } catch (e) {
      last = `no answer (${e.cause?.code ?? e.message})`;
    }
    await sleep(2000);
  }
  die(`creating ${account.email} failed after 60 s (${last}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
