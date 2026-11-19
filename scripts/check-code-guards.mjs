#!/usr/bin/env node
// check-code-guards — two guards the frontend and backend steps run in their verify.
//
//   node scripts/check-code-guards.mjs generated [repoDir]     generated API code matches a fresh Orval run
//   node scripts/check-code-guards.mjs service-role [repoDir]  the service-role key stays server-side
//
// generated: snapshots src/lib/api/generated/, runs `npx orval`, compares, then puts the snapshot back
//   (so the check never changes your files). Any difference means someone hand-edited generated code
//   or changed the contract without regenerating. Fix: `npm run gen:types`, never edit by hand.
//
// service-role: any file that imports lib/server/admin or names SUPABASE_SERVICE_ROLE_KEY must be on the
//   allow-list (src/lib/server/admin.ts, src/lib/server/env.ts, plus backticked paths in
//   docs/SECURITY_MODEL.md lines about the service role / admin client). Client code is never allowed,
//   even if listed: files with 'use client', src/components/**, src/hooks/**, and pages/layouts under
//   src/app. admin.ts must import 'server-only'.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { globToRegExp } from './lib/permissions.mjs';

const GEN = 'src/lib/api/generated';
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p, base);
    return [path.relative(base, p).split(path.sep).join('/')];
  });
}

// ---------------------------------------------------------------- generated
function snapshot(root) {
  const m = new Map();
  for (const f of walk(path.join(root, GEN))) m.set(f, fs.readFileSync(path.join(root, GEN, f)));
  return m;
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export function runOrval(root) {
  const r = spawnSync('npx', ['--no-install', 'orval'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`orval failed: ${(r.stderr || r.stdout).trim().slice(-600)}`);
}

export function checkGenerated(root, { generate = runOrval } = {}) {
  if (!fs.existsSync(path.join(root, GEN))) return [`${GEN}: missing — run npm run gen:types`];
  const before = snapshot(root);
  const problems = [];
  try {
    generate(root);
    const after = snapshot(root);
    for (const [f, b] of before) {
      if (!after.has(f)) problems.push(`${GEN}/${f}: not produced by a fresh Orval run (hand-added file?)`);
      else if (sha(b) !== sha(after.get(f))) problems.push(`${GEN}/${f}: differs from a fresh Orval run (hand-edited, or the contract changed without regenerating)`);
    }
    for (const f of after.keys()) if (!before.has(f)) problems.push(`${GEN}/${f}: a fresh Orval run creates it but it isn't committed — regenerate`);
  } finally {
    // put the working tree back exactly as it was
    const genDir = path.join(root, GEN);
    for (const f of walk(genDir)) if (!before.has(f)) fs.rmSync(path.join(genDir, f));
    for (const [f, b] of before) { fs.mkdirSync(path.dirname(path.join(genDir, f)), { recursive: true }); fs.writeFileSync(path.join(genDir, f), b); }
  }
  return problems;
}

// ---------------------------------------------------------------- service role
const DEFAULT_ALLOW = ['src/lib/server/admin.ts', 'src/lib/server/env.ts'];
const USES = [
  /\bfrom\s+['"](?:@\/|(?:\.\.?\/)+)(?:[\w/-]*\/)?lib\/server\/admin(?:\.ts)?['"]/,
  /\bimport\(\s*['"](?:@\/|(?:\.\.?\/)+)(?:[\w/-]*\/)?lib\/server\/admin(?:\.ts)?['"]\s*\)/,
  /\brequire\(\s*['"](?:@\/|(?:\.\.?\/)+)(?:[\w/-]*\/)?lib\/server\/admin(?:\.ts)?['"]\s*\)/,
  /\bSUPABASE_SERVICE_ROLE_KEY\b/,
];

export function allowList(root) {
  const allow = new Set(DEFAULT_ALLOW);
  const sm = path.join(root, 'docs/SECURITY_MODEL.md');
  if (fs.existsSync(sm)) {
    for (const line of fs.readFileSync(sm, 'utf8').split('\n')) {
      if (!/service[\s_-]?role|admin client|admin\.ts/i.test(line)) continue;
      for (const m of line.matchAll(/`([^`\s]+)`/g)) if (/^(src|scripts|supabase|tests)\//.test(m[1])) allow.add(m[1]);
    }
  }
  return [...allow];
}

const isClientPath = (f) => /^src\/(components|hooks)\//.test(f) || /^src\/app\/(.*\/)?(page|layout|template|loading|error|not-found|global-error)\.(t|j)sx?$/.test(f);

export function checkServiceRole(root) {
  const problems = [];
  const allow = allowList(root).map((g) => globToRegExp(g));
  for (const f of walk(path.join(root, 'src')).map((x) => `src/${x}`).filter((x) => CODE.test(x))) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    if (!USES.some((re) => re.test(text))) continue;
    const client = /^\s*['"]use client['"]/m.test(text) || isClientPath(f);
    if (client) problems.push(`${f}: client code uses the service-role client/key — it would ship to browsers`);
    else if (!allow.some((re) => re.test(f))) problems.push(`${f}: uses the service-role client/key but isn't on the SECURITY_MODEL.md allow-list`);
  }
  const admin = path.join(root, 'src/lib/server/admin.ts');
  if (fs.existsSync(admin) && !/^\s*import\s+['"]server-only['"]/m.test(fs.readFileSync(admin, 'utf8'))) problems.push("src/lib/server/admin.ts: must start with import 'server-only'");
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, dirArg] = process.argv.slice(2);
  const root = path.resolve(dirArg ?? '.');
  const run = { generated: checkGenerated, 'service-role': checkServiceRole }[mode];
  if (!run) { console.error('usage: check-code-guards.mjs <generated|service-role> [repoDir]'); process.exit(2); }
  let problems;
  try { problems = run(root); } catch (e) { console.error(`check-code-guards ${mode}: ${e.message}`); process.exit(1); }
  if (problems.length) { console.log(problems.join('\n')); console.log(`\ncheck-code-guards ${mode}: ${problems.length} problem(s)`); process.exit(1); }
  console.log(`check-code-guards ${mode}: OK`);
}
