#!/usr/bin/env node
// scripts/env-check.mjs: TEMPLATE (owned by bl-devops). Environment drift check — names only, never values.
// Usage: node scripts/env-check.mjs [--vercel] [--root <dir>]
// Exits 1 on any error. With --vercel, reads Vercel project variables via the REST API WITHOUT decrypting values.
import fs from 'node:fs';
import path from 'node:path';

const SECRETISH = /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|WEBHOOK|_SK_|^SK_)/;
const IGNORED_RUNTIME = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_GIT_COMMIT_SHA', 'CI']);

export function scanSource(root) {
  const used = new Set();
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'generated'].includes(e.name)) walk(p); continue; }
      if (!/\.(ts|tsx|js|mjs)$/.test(e.name)) continue;
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) used.add(m[1] ?? m[2]);
    }
  };
  walk(path.join(root, 'src'));
  return used;
}

export function readEnvExample(root) {
  const p = path.join(root, '.env.example');
  if (!fs.existsSync(p)) return null;
  const vars = new Map();
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) vars.set(m[1], m[2].trim());
  }
  return vars;
}

export function checkLocal(manifest, used, example) {
  const errors = [];
  const declared = new Map(manifest.variables.map((v) => [v.name, v]));
  for (const name of used) if (!declared.has(name) && !IGNORED_RUNTIME.has(name)) errors.push(`undeclared: ${name} is used in src/ but not in infra/environments.json`);
  for (const v of manifest.variables) {
    if (v.public && !v.name.startsWith('NEXT_PUBLIC_')) errors.push(`public-name: ${v.name} is marked public but isn't NEXT_PUBLIC_*`);
    if (v.name.startsWith('NEXT_PUBLIC_') && SECRETISH.test(v.name.replace('NEXT_PUBLIC_', ''))) errors.push(`public-secret: ${v.name} looks secret but would ship to the browser`);
    if (v.sensitive && v.name.startsWith('NEXT_PUBLIC_')) errors.push(`public-secret: ${v.name} is sensitive but NEXT_PUBLIC_*`);
    if (!v.sensitive && !v.public && SECRETISH.test(v.name)) errors.push(`unmarked-secret: ${v.name} looks secret; mark it "sensitive": true`);
    if (example && !example.has(v.name)) errors.push(`example-missing: ${v.name} is not in .env.example`);
    if (example && v.sensitive && example.get(v.name) && !/^(|<.*>|your[-_].*|changeme|placeholder.*)$/i.test(example.get(v.name))) errors.push(`example-value: .env.example has a non-placeholder value for ${v.name}`);
  }
  if (!example) errors.push('example-missing: .env.example does not exist');
  return errors;
}

// Vercel API rows: { key, target: ['production'|'preview'|'development'], gitBranch?, type: 'encrypted'|'sensitive'|'plain'|'system' }
export function checkVercel(manifest, rows) {
  const errors = [];
  const has = (name, target, branch) => rows.some((r) => r.key === name && r.target.includes(target) && (branch ? (r.gitBranch === branch || !r.gitBranch) : !r.gitBranch));
  const hasBranchSpecific = (name, branch) => rows.some((r) => r.key === name && r.target.includes('preview') && r.gitBranch === branch);
  for (const v of manifest.variables) {
    for (const target of ['production', 'preview']) {
      const rule = v[target];
      if (rule === 'required' && !has(v.name, target)) errors.push(`missing: ${v.name} not set for ${target}`);
      if (rule === 'absent' && rows.some((r) => r.key === v.name && r.target.includes(target) && !r.gitBranch)) errors.push(`must-be-absent: ${v.name} is set for all ${target} deployments`);
    }
    for (const [branch, rule] of Object.entries(v.branches ?? {})) {
      if (rule === 'required' && !has(v.name, 'preview', branch)) errors.push(`missing: ${v.name} not set for preview branch ${branch}`);
      if (rule === 'absent' && hasBranchSpecific(v.name, branch)) errors.push(`must-be-absent: ${v.name} is set for preview branch ${branch}`);
    }
    if (v.sensitive) for (const r of rows.filter((x) => x.key === v.name && x.type === 'plain')) errors.push(`plain-secret: ${v.name} is stored as plain text in Vercel (${r.target.join(',')}); re-add it as sensitive`);
  }
  const declared = new Set(manifest.variables.map((v) => v.name));
  for (const r of rows) if (!declared.has(r.key) && r.type !== 'system') errors.push(`undeclared-in-vercel: ${r.key} is set in Vercel but not in the manifest`);
  return errors;
}

async function fetchVercelRows() {
  const { VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID } = process.env;
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) throw new Error('--vercel needs VERCEL_TOKEN and VERCEL_PROJECT_ID');
  const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/env`);
  if (VERCEL_TEAM_ID) url.searchParams.set('teamId', VERCEL_TEAM_ID);   // decrypt is never requested: values stay encrypted
  const res = await fetch(url, { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } });
  if (!res.ok) throw new Error(`Vercel API ${res.status}`);
  const body = await res.json();
  return (body.envs ?? []).map(({ key, target, gitBranch, type }) => ({ key, target: [].concat(target ?? []), gitBranch: gitBranch ?? null, type }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const root = path.resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'infra/environments.json'), 'utf8'));
  const errors = checkLocal(manifest, scanSource(root), readEnvExample(root));
  if (args.includes('--vercel')) errors.push(...checkVercel(manifest, await fetchVercelRows()));
  errors.forEach((e) => console.log(`✗ ${e}`));
  console.log(errors.length ? `${errors.length} problem(s)` : '✓ environments match the manifest');
  process.exit(errors.length ? 1 : 0);
}
