#!/usr/bin/env node
// supabase/scripts/db.mjs: the database side of the npm scripts (owned by bl-architect).
//
//   node supabase/scripts/db.mjs migrate   apply pending supabase/migrations/*.sql   (npm run db:migrate)
//   node supabase/scripts/db.mjs test      migrate, then run every pgTAP file under supabase/tests/ (npm run db:test)
//   node supabase/scripts/db.mjs types     migrate, then write src/types/database.ts      (first half of npm run gen:types)
//   node supabase/scripts/db.mjs check     read-only staging checks (docs/architecture.md "Checks for A2 on staging",
//                                           docs/threat-model.md "Live checks for A2")      (npm run db:check)
//   node supabase/scripts/db.mjs staff-add <email> [name]
//                                           make an existing auth user staff, idempotently  (npm run db:staff-add -- <email>)
//
// Target: SUPABASE_STAGING_DB_URL (the staging project's session-pooler URI, copied from the dashboard's Connect
// dialog). The npm scripts load it with `node --env-file-if-exists=.env.local`. This is what the ledger and CI run.
//
// `--local` (npm run db:test:local, gen:types:local) targets the local Supabase stack instead
// (`npx --no-install supabase start`, ports in supabase/config.toml), for lanes and machines without the staging URL.
// A local run is not proof of hosted behaviour; say which one you ran.
//
// Rules (ledger rulings, 2026-11-20):
//  - Supabase CLI only, with `--remote=<url>`. No access token, no `supabase link`, never `supabase db push`.
//    Hosted runs need `--yes` (the CLI accepts only that flag or SUPABASE_YES for hosted changes).
//  - `supabase migration up` applies pending files and records them in supabase_migrations.schema_migrations.
//  - `supabase test db` installs pgTAP for the run and drops it again; no migration installs pgTAP (S0 SEC-18).
//  - The URL goes to child processes as an argument only. It, its password, user and host are replaced with
//    placeholders in everything this script prints. On a connection failure only the URL's shape is described.
//  - `check` runs only SELECTs, each inside `begin transaction read only` ... `rollback`.
//
// Safety: refuses a URL that names the production project (SUPABASE_PROD_PROJECT_REF or SUPABASE_PRODUCTION_REF,
// whichever is set) or equals SUPABASE_PRODUCTION_DB_URL; when SUPABASE_STAGING_REF is set, the URL must name it.
//
// Needs: the Supabase CLI devDependency and Docker (test db runs pg_prove in a container); psql on PATH (check).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const testsDir = path.join(root, 'supabase', 'tests');
const typesFile = path.join(root, 'src', 'types', 'database.ts');
const supabaseBin = path.join(root, 'node_modules', '.bin', 'supabase');
const VAR = 'SUPABASE_STAGING_DB_URL';

let secrets = [];
let urlShape = '';
const redact = (text) => secrets.reduce((t, s) => (s ? t.split(s).join(`<${VAR}>`) : t), String(text ?? ''));

function fail(msg) {
  console.error(`db: ${redact(msg)}`);
  // On a connection failure, describe the URL's shape (never its values) so a wrong URL can be fixed.
  if (urlShape && /failed to connect|connection to server|tenant\/user|password authentication|could not translate host/i.test(String(msg))) {
    console.error(`db: ${VAR} shape (no values): ${urlShape}`);
    console.error('db: copy the Session pooler string from the dashboard (Connect > Session pooler); the pooler cluster'
      + ' index in the host cannot be derived from the region (https://supabase.com/docs/guides/database/connecting-to-postgres).');
  }
  process.exit(1);
}

/** The URL's structure with every identifying value removed: which kind of host, user form, port, database. */
function describeUrl(parsed) {
  const host = parsed.hostname;
  const user = decodeURIComponent(parsed.username);
  const pooler = host.match(/^aws-(\d+)-([a-z0-9-]+)\.pooler\.supabase\.com$/);
  const direct = /^db\.[a-z0-9]{20}\.supabase\.co$/.test(host);
  const local = ['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal'].includes(host);
  const hostKind = pooler ? `Supavisor pooler (cluster aws-${pooler[1]}, region ${pooler[2]})`
    : direct ? 'direct database host (db.<ref>.supabase.co)' : local ? 'local' : 'other host';
  const userKind = /^postgres\.[a-z0-9]{20}$/.test(user) ? 'postgres.<20-char project ref>'
    : user === 'postgres' ? 'postgres (no project ref)'
      : /^postgres\./.test(user) ? `postgres.<suffix of ${user.length - 9} chars, not a 20-char ref>` : 'other user';
  const mode = pooler ? (parsed.port === '6543' ? 'transaction mode' : parsed.port === '5432' || !parsed.port ? 'session mode' : 'unknown mode') : '';
  return [`host: ${hostKind}`, `user: ${userKind}`, `port: ${parsed.port || '(default)'}${mode ? ` (${mode})` : ''}`,
    `database: ${parsed.pathname === '/postgres' ? 'postgres' : 'not "postgres"'}`, `password: ${parsed.password ? 'present' : 'missing'}`,
    pooler && user === 'postgres' ? 'hint: the pooler needs the user as postgres.<project ref>' : ''].filter(Boolean).join('; ');
}

function stagingTarget() {
  const url = process.env[VAR];
  if (!url) fail(`${VAR} is not set (add it to .env.local; see docs/ops/account-setup.md Part 6).`);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`${VAR} is not a valid postgres:// URL.`);
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) fail(`${VAR} must be a postgres:// or postgresql:// URL.`);
  secrets = [url, decodeURIComponent(parsed.password), parsed.password, decodeURIComponent(parsed.username), parsed.username, parsed.hostname]
    .filter((s) => s && s.length >= 4)
    .sort((a, b) => b.length - a.length);
  urlShape = describeUrl(parsed);
  for (const name of ['SUPABASE_PROD_PROJECT_REF', 'SUPABASE_PRODUCTION_REF']) {
    const ref = process.env[name];
    if (ref && url.includes(ref)) fail(`refusing: ${VAR} names the production project (${name}).`);
  }
  if (process.env.SUPABASE_PRODUCTION_DB_URL && process.env.SUPABASE_PRODUCTION_DB_URL === url) {
    fail(`refusing: ${VAR} equals SUPABASE_PRODUCTION_DB_URL.`);
  }
  const stagingRef = process.env.SUPABASE_STAGING_REF;
  if (stagingRef && !url.includes(stagingRef)) fail(`refusing: ${VAR} does not name SUPABASE_STAGING_REF.`);
  return { name: 'staging project', url, args: [`--remote=${url}`, '--yes'] };
}

// The CLI targets the local stack by default (no URL argument). `check` needs a URL for psql: the local stack's
// fixed default credentials on the [db] port from supabase/config.toml (not a secret; local only).
function localTarget() {
  const config = fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');
  const port = config.match(/^\[db\][^[]*?^port\s*=\s*(\d+)/m)?.[1] ?? '54322';
  return { name: 'local stack', url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, args: [] };
}

// The CLI (v3) loads .env.<env>.local, .env.local, .env.<env> and .env from its project directory, and stops on
// any line its own parser rejects (first staging run, 2026-11-20: "failed to parse environment file: .env.local").
// It needs none of them: the target comes in as --remote=<url>. So it runs in a throwaway workdir holding only
// supabase/config.toml, migrations and tests, and gets an environment without the app's secrets.
// That also keeps SUPABASE_* app variables from being read as CLI settings.
const APP_ENV = /^(SUPABASE_|NEXT_PUBLIC_|QA_|VERCEL_|STAGING_|APP_|GHL_|RESEND_|CRON_|BASELEAP_)/;
let workdir = '';
function cliWorkdir() {
  if (workdir) return workdir;
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'northside-db-'));
  const src = path.join(root, 'supabase');
  const dst = path.join(workdir, 'supabase');
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'config.toml'), path.join(dst, 'config.toml'));
  for (const dir of ['migrations', 'tests']) {
    if (fs.existsSync(path.join(src, dir))) fs.cpSync(path.join(src, dir), path.join(dst, dir), { recursive: true });
  }
  process.on('exit', () => fs.rmSync(workdir, { recursive: true, force: true }));
  return workdir;
}

function cli(target, args, { timeout = 15 * 60 * 1000 } = {}) {
  if (!fs.existsSync(supabaseBin)) fail('the Supabase CLI devDependency is missing: run npm ci.');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !APP_ENV.test(k)));
  const r = spawnSync(supabaseBin, [...args, ...target.args, '--agent', 'no'], {
    cwd: cliWorkdir(), encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024,
    env: { ...env, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
  });
  if (r.error) fail(`supabase ${args.join(' ')} could not run: ${r.error.message}`);
  return { status: r.status, stdout: redact(r.stdout), stderr: redact(r.stderr) };
}

function migrate(target) {
  const r = cli(target, ['migration', 'up']);
  const out = `${r.stdout}\n${r.stderr}`.trim();
  if (r.status !== 0) fail(`supabase migration up failed on the ${target.name} (exit ${r.status}):\n${out.slice(-4000)}`);
  if (out) console.log(out.split('\n').map((l) => `db: ${l}`).join('\n'));
  console.log(`db: migrations up to date on the ${target.name}`);
}

function listTests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listTests(p);
    return e.name.endsWith('.sql') ? [p] : [];
  }).sort();
}

function test(target) {
  migrate(target);
  const files = listTests(testsDir);
  if (!files.length) fail('no pgTAP files under supabase/tests/');
  const r = cli(target, ['test', 'db']);
  const out = `${r.stdout}\n${r.stderr}`.trim();
  console.log(out);
  const summary = out.match(/Files=(\d+),\s*Tests=(\d+)/);
  const passed = /Result:\s*PASS/.test(out);
  if (r.status !== 0 || !passed) fail(`pgTAP run failed on the ${target.name} (exit ${r.status}).`);
  if (!summary) fail('pgTAP run printed no "Files=..., Tests=..." summary.');
  if (Number(summary[1]) !== files.length) fail(`pg_prove ran ${summary[1]} files but supabase/tests/ has ${files.length}.`);
  console.log(`db: ${summary[1]}/${files.length} test files passed on the ${target.name}, ${summary[2]} assertions`);
}

function types(target) {
  migrate(target);
  const r = cli(target, ['gen', 'types', '--lang', 'typescript', '--schema', 'public']);
  const out = r.stdout ?? '';
  if (r.status !== 0 || !out.includes('export type Database')) {
    fail(`supabase gen types failed on the ${target.name} (exit ${r.status}):\n${(r.stderr || out).trim().slice(-2000)}`);
  }
  // The CLI can print connection notices on stdout before the code.
  const code = out.slice(out.search(/^export /m));
  fs.mkdirSync(path.dirname(typesFile), { recursive: true });
  const header = '// GENERATED by `npm run gen:types` (supabase gen types) from supabase/migrations. Do not edit.\n\n';
  fs.writeFileSync(typesFile, header + code);
  const fmt = spawnSync(path.join(root, 'node_modules', '.bin', 'prettier'), ['--write', '--log-level', 'warn', typesFile], { cwd: root, encoding: 'utf8' });
  if (fmt.status !== 0) fail(`prettier failed on ${path.relative(root, typesFile)}: ${fmt.stderr}`);
  console.log(`db: wrote ${path.relative(root, typesFile)} from the ${target.name}`);
}

function query(url, sql) {
  const r = spawnSync('psql', [url, '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1',
    '-c', 'begin transaction read only', '-c', sql, '-c', 'rollback'], { encoding: 'utf8' });
  if (r.error) fail(`psql not runnable: ${r.error.message}`);
  if (r.status !== 0) fail(`query failed: ${r.stderr.trim()}`);
  return r.stdout.split('\n').filter(Boolean).map((l) => l.split('|'));
}

const READABLE = ['events', 'ghl_sync_jobs', 'quote_photos', 'quote_request_status_changes', 'quote_requests', 'staff'];
const COUNTERS = ['rate_limit_hits', 'sign_in_attempts', 'sign_in_pauses', 'spam_refusal_windows'];
const SERVICE_FUNCTIONS = ['claim_ghl_job', 'complete_quote_request', 'find_ghl_contact_match', 'finish_ghl_job',
  'ghl_stage_for_request', 'mark_sign_in_succeeded', 'record_spam_refusal', 'start_quote_request',
  'take_sign_in_attempt', 'take_submission_slot'];
const list = (rows) => rows.map((r) => r.join(' ')).join(', ') || '(no rows)';

const CHECKS = [
  ['postgres and service_role bypass RLS (SEC-1)',
    "select rolname, rolbypassrls from pg_roles where rolname in ('postgres', 'service_role') order by rolname",
    (rows) => rows.length === 2 && rows.every((r) => r[1] === 't')],
  ['every public table is owned by postgres',
    "select c.relname, pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1",
    (rows) => rows.length > 0 && rows.every((r) => r[1] === 'postgres')],
  ['RLS enabled and forced on all 10 public tables',
    "select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1",
    (rows) => rows.length === 10 && rows.every((r) => r[1] === 't' && r[2] === 't')],
  ['anon holds no table privilege in public',
    "select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' order by 1, 2",
    (rows) => rows.length === 0],
  ['authenticated holds SELECT only, on the six readable tables only',
    "select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' order by 1, 2",
    (rows) => rows.every((r) => r[1] === 'SELECT')
      && JSON.stringify(rows.map((r) => r[0]).sort()) === JSON.stringify(READABLE)
      && !rows.some((r) => COUNTERS.includes(r[0]))],
  ['service_role may update events.properties only',
    "select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'events' and grantee = 'service_role' and privilege_type = 'UPDATE' order by 1",
    (rows) => rows.length === 1 && rows[0][0] === 'properties'],
  ['nobody can update a sign-in pause',
    "select has_table_privilege('service_role', 'public.sign_in_pauses', 'UPDATE')",
    (rows) => rows.length === 1 && rows[0][0] === 'f'],
  ['no public function is executable by anon',
    "select p.proname, 'owner=' || pg_get_userbyid(p.proowner), 'returns=' || p.prorettype::regtype, 'definer=' || p.prosecdef, 'acl=' || coalesce(array_to_string(p.proacl, ' '), 'default') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1",
    (rows) => rows.length === 0],
  ['event triggers in the database (informational: platform-installed ones are listed for the record)',
    "select evtname, evtevent, evtfoid::regproc, 'owner=' || pg_get_userbyid(evtowner), 'enabled=' || evtenabled::text from pg_event_trigger order by 1",
    () => true],
  ['app_private trigger and pause functions are not callable by clients',
    "select p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'), has_function_privilege('service_role', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private' and p.proname in ('sign_in_pause_until', 'ghl_sync_jobs_require_consent', 'quote_requests_consent_immutable') order by 1",
    (rows) => rows.length === 3 && rows.every((r) => r[1] === 'f' && r[2] === 'f')
      && rows.find((r) => r[0] === 'sign_in_pause_until')?.[3] === 't'],
  ['both consent triggers exist and are enabled',
    "select tgname, tgenabled from pg_trigger where tgname in ('ghl_sync_jobs_require_consent', 'quote_requests_consent_immutable') order by 1",
    (rows) => rows.length === 2 && rows.every((r) => r[1] === 'O')],
  ['the jobs consent trigger fires on insert and on update of request_id, kind (SEC-23)',
    "select pg_get_triggerdef(oid) from pg_trigger where tgname = 'ghl_sync_jobs_require_consent'",
    (rows) => rows.length === 1 && /BEFORE INSERT OR UPDATE OF request_id, kind ON public\.ghl_sync_jobs/.test(rows[0][0])],
  ['the ten service-role functions are security invoker',
    `select proname, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in (${SERVICE_FUNCTIONS.map((f) => `'${f}'`).join(', ')}) order by 1`,
    (rows) => rows.length === 10 && rows.every((r) => r[1] === 'f')],
  ['pgTAP is absent outside tests (SEC-18)',
    "select extname from pg_extension where extname = 'pgtap'",
    (rows) => rows.length === 0],
  ['quote-photos bucket is private with its limits',
    "select public, file_size_limit, array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'quote-photos'",
    (rows) => rows.length === 1 && rows[0][0] === 'f' && rows[0][1] === '5242880'
      && rows[0][2].split(',').sort().join(',') === 'image/jpeg,image/png,image/webp'],
];

function check(target) {
  console.log(`# read-only checks on the ${target.name}`);
  let failed = 0;
  for (const [name, sql, ok] of CHECKS) {
    const rows = query(target.url, sql);
    const pass = ok(rows);
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok' : 'not ok'} - ${name}: ${list(rows)}`);
  }
  const applied = query(target.url, 'select version, name from supabase_migrations.schema_migrations order by version');
  console.log(`# migrations recorded: ${applied.length}`);
  for (const [version, name] of applied) console.log(`#   ${version} ${name}`);
  console.log(`db: ${CHECKS.length - failed}/${CHECKS.length} checks passed on the ${target.name}`);
  if (failed) process.exit(1);
}

// staff-add <email> [display name]: make an EXISTING Supabase Auth user a staff member (runbook: Baseleap creates
// the two accounts; there is no in-app user management, NG-4). Idempotent: an existing staff row is left as it is.
// Runs as the URL's user (postgres, BYPASSRLS), one transaction. Values travel as psql variables (:'email'), never
// spliced into SQL. Prints the email and the outcome only.
const EMAIL = /^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/;
const DEFAULT_NAMES = { owner: 'Owner', helper: 'Office helper' };
function staffAdd(target, email, name) {
  if (!email || !EMAIL.test(email)) fail('usage: node supabase/scripts/db.mjs staff-add <email> [display name] [--local]');
  const local = email.split('@')[0].toLowerCase();
  const displayName = (name ?? DEFAULT_NAMES[local] ?? local).trim();
  if (displayName.length < 1 || displayName.length > 50) fail('display name must be 1 to 50 characters (public.staff check).');
  const sql = `
begin;
with target as (
  select u.id from auth.users u where lower(u.email) = lower(:'email')
), ins as (
  insert into public.staff (user_id, display_name)
  select id, :'display_name' from target
  on conflict (user_id) do nothing
  returning user_id
)
select (select count(*) from target), (select count(*) from ins);
commit;
select count(*) from public.staff s join auth.users u on u.id = s.user_id where lower(u.email) = lower(:'email');
`;
  const r = spawnSync('psql', [target.url, '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1',
    '-v', `email=${email}`, '-v', `display_name=${displayName}`], { input: sql, encoding: 'utf8' });
  if (r.error) fail(`psql not runnable: ${r.error.message}`);
  if (r.status !== 0) fail(`staff-add failed: ${r.stderr.trim()}`);
  const [counts, after] = r.stdout.split('\n').filter((l) => /^\d/.test(l));
  const [users, inserted] = (counts ?? '').split('|').map(Number);
  if (users !== 1) fail(`staff-add ${email}: ${users === 0 ? 'no Supabase Auth user has this email (create it in the dashboard first)' : 'more than one auth user matches'}.`);
  if (Number(after) !== 1) fail(`staff-add ${email}: the staff row is missing after the insert.`);
  console.log(`db: ${email} is staff on the ${target.name} (${inserted === 1 ? 'added now' : 'already staff, unchanged'})`);
}

const [cmd, ...rest] = process.argv.slice(2);
const isLocal = rest.includes('--local');
const params = rest.filter((a) => a !== '--local');
const commands = { migrate, test, types, check };
if (cmd === 'staff-add') {
  staffAdd(isLocal ? localTarget() : stagingTarget(), params[0], params.slice(1).join(' ') || undefined);
} else {
  if (!commands[cmd] || params.length) fail('usage: node supabase/scripts/db.mjs <migrate|test|types|check|staff-add <email> [name]> [--local]');
  commands[cmd](isLocal ? localTarget() : stagingTarget());
}
