#!/usr/bin/env node
// supabase/scripts/db.mjs: the database side of the npm scripts (owned by bl-architect).
//
//   node supabase/scripts/db.mjs migrate   apply pending supabase/migrations/*.sql
//   node supabase/scripts/db.mjs test      migrate, then run every pgTAP file under supabase/tests/
//   node supabase/scripts/db.mjs types     migrate, then write src/types/database.ts
//
// Target: SUPABASE_PREVIEW_DB_URL (the Supabase preview branch, or a throwaway local Postgres).
// The URL is passed to child processes as an argument/env, never printed.
//
// Safety:
//  - Refuses to run when the URL contains SUPABASE_PROD_PROJECT_REF.
//  - Refuses a non-local host when SUPABASE_PROD_PROJECT_REF is unset (we can't prove it isn't prod).
//  - Never runs `supabase db push` / `link` / `start`. Migrations are applied with psql, one file
//    per transaction (each file has its own begin/commit), and recorded in
//    supabase_migrations.schema_migrations, the same table the Supabase CLI uses, so a later
//    `supabase db push` on a real branch sees them as already applied.
//
// Needs: psql on PATH (tests and migrations); the Supabase CLI devDependency (types).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const testsDir = path.join(root, 'supabase', 'tests');
const typesFile = path.join(root, 'src', 'types', 'database.ts');

function fail(msg) {
  console.error(`db: ${msg}`);
  process.exit(1);
}

function dbUrl() {
  const url = process.env.SUPABASE_PREVIEW_DB_URL;
  if (!url) fail('SUPABASE_PREVIEW_DB_URL is not set (preview branch or throwaway local Postgres).');
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    fail('SUPABASE_PREVIEW_DB_URL is not a valid postgres:// URL.');
  }
  const prodRef = process.env.SUPABASE_PROD_PROJECT_REF;
  if (prodRef && url.includes(prodRef)) fail('refusing: SUPABASE_PREVIEW_DB_URL points at the production project.');
  const local = ['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal'].includes(host);
  if (!local && !prodRef) {
    fail('refusing a non-local database while SUPABASE_PROD_PROJECT_REF is unset (cannot prove it is not production).');
  }
  return url;
}

function psql(url, args, { input } = {}) {
  // PGOPTIONS keeps NOTICE noise out of TAP output.
  const r = spawnSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, PGOPTIONS: '--client-min-messages=warning' },
  });
  if (r.error) fail(`psql not runnable: ${r.error.message}`);
  return r;
}

function scalar(url, sql) {
  const r = psql(url, ['-At', '-c', sql]);
  if (r.status !== 0) fail(`query failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function migrate(url) {
  scalar(url, `create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
  const applied = new Set(scalar(url, 'select version from supabase_migrations.schema_migrations').split('\n').filter(Boolean));
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  let n = 0;
  for (const file of files) {
    const [, version, name] = file.match(/^(\d+)_(.+)\.sql$/);
    if (applied.has(version)) continue;
    const r = psql(url, ['-f', path.join(migrationsDir, file)]);
    if (r.status !== 0) fail(`migration ${file} failed:\n${r.stderr.trim()}`);
    // psql variables are only interpolated in scripts, not in -c, so the insert goes through stdin.
    const rec = psql(url, ['-At', '-v', `v=${version}`, '-v', `n=${name}`],
      { input: "insert into supabase_migrations.schema_migrations (version, name) values (:'v', :'n');\n" });
    if (rec.status !== 0) fail(`could not record migration ${file}: ${rec.stderr.trim()}`);
    console.log(`db: applied ${file}`);
    n += 1;
  }
  console.log(`db: migrations up to date (${files.length} files, ${n} applied now)`);
}

function listTests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listTests(p);
    return e.name.endsWith('.sql') ? [p] : [];
  }).sort();
}

/** Runs one pgTAP file and checks its TAP output: plan matched, no "not ok", no SQL error. */
function runTest(url, file) {
  const rel = path.relative(root, file);
  const r = psql(url, ['-At', '-f', file]);
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const plan = lines.map((l) => l.match(/^1\.\.(\d+)$/)).find(Boolean);
  const oks = lines.filter((l) => /^ok \d+/.test(l)).length;
  const notOks = lines.filter((l) => /^not ok \d+/.test(l));
  const problems = [];
  if (r.status !== 0) problems.push(`psql exited ${r.status}: ${r.stderr.trim()}`);
  if (!plan) problems.push('no TAP plan in output');
  if (notOks.length) problems.push(...notOks);
  if (plan && oks + notOks.length !== Number(plan[1])) problems.push(`planned ${plan[1]} tests, ran ${oks + notOks.length}`);
  const diag = lines.filter((l) => l.startsWith('#'));
  if (problems.length) {
    console.log(`not ok - ${rel}`);
    for (const p of problems) console.log(`    ${p}`);
    for (const d of diag) console.log(`    ${d}`);
    return { ok: false, count: oks + notOks.length };
  }
  console.log(`ok - ${rel} (${oks}/${plan[1]})`);
  return { ok: true, count: oks };
}

function test(url) {
  migrate(url);
  scalar(url, 'create extension if not exists pgtap with schema extensions');
  const files = listTests(testsDir);
  if (!files.length) fail('no pgTAP files under supabase/tests/');
  const results = files.map((f) => runTest(url, f));
  const passed = results.filter((r) => r.ok).length;
  const total = results.reduce((s, r) => s + r.count, 0);
  console.log(`db: ${passed}/${files.length} test files passed, ${total} assertions`);
  if (passed !== files.length) process.exit(1);
}

function types(url) {
  migrate(url);
  // Supabase CLI v3: `gen types --remote=<postgres url>` (v1/v2 spelled it `--db-url`).
  const bin = path.join(root, 'node_modules', '.bin', 'supabase');
  const r = spawnSync(bin, ['gen', 'types', 'typescript', `--remote=${url}`, '--schema', 'public', '--agent', 'no'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) fail(`supabase CLI not runnable: ${r.error.message}`);
  const out = r.stdout ?? '';
  if (r.status !== 0 || !out.includes('export type Database')) {
    const err = (r.stderr || out).replaceAll(url, '<SUPABASE_PREVIEW_DB_URL>').trim();
    fail(`supabase gen types failed (exit ${r.status}):\n${err.slice(-2000)}`);
  }
  // The CLI can print connection notices (e.g. "connected without TLS") on stdout before the code.
  const code = out.slice(out.search(/^export /m));
  fs.mkdirSync(path.dirname(typesFile), { recursive: true });
  const header = '// GENERATED by `npm run gen:types` (supabase gen types) from supabase/migrations. Do not edit.\n\n';
  fs.writeFileSync(typesFile, header + code);
  const fmt = spawnSync(path.join(root, 'node_modules', '.bin', 'prettier'), ['--write', '--log-level', 'warn', typesFile], { cwd: root, encoding: 'utf8' });
  if (fmt.status !== 0) fail(`prettier failed on ${typesFile}: ${fmt.stderr}`);
  console.log(`db: wrote ${path.relative(root, typesFile)}`);
}

const cmd = process.argv[2];
const commands = { migrate, test, types };
if (!commands[cmd]) fail('usage: node supabase/scripts/db.mjs <migrate|test|types>');
commands[cmd](dbUrl());
