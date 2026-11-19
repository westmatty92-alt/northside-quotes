#!/usr/bin/env node
// sop-check.mjs: lints SOPs written by bl-docs (docs/sops/**/*.md).
// Errors (exit 1): missing Purpose / Steps / If it goes wrong / Changelog; Steps not a numbered list;
// leftover {{template}} placeholders; secret-looking strings; relative links that don't resolve;
// with --kit, client names (agent teams are products). Warnings: "⚠ unverified" steps (errors with --strict).
// Usage: node scripts/sop-check.mjs [dir=docs/sops] [--strict] [--kit]
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['plan.md', 'changelog.md', 'evidence.md', 'index.md', 'README.md']);
const SECRETS = [
  [/\bsk_(live|test)_[A-Za-z0-9]{8,}/, 'Stripe secret key'],
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, 'Supabase secret key'],
  [/\beyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT / Supabase key'],
  [/\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bpit-[0-9a-f]{8}-[0-9a-f-]{20,}/i, 'GHL private integration token'],
  [/\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9_\-+/]{12,}/i, 'credential assignment'],
];
export const CLIENT_TERMS = ['moravian', 'morovian', 'gas club', 'stay radiant', 'slaps', 'northside', 'maple street'];

const section = (src, name) => {
  const m = src.match(new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi'));
  return m ? m[1] : null;
};

export function checkSop(src, { file = 'sop.md', strict = false, kit = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!/^#\s+\S/m.test(src)) errors.push('no title (# heading)');
  if (!/\*\*Purpose:\*\*\s*\S/.test(src)) errors.push('no **Purpose:** line');
  const steps = section(src, 'Steps');
  if (steps === null) errors.push('no "## Steps" section');
  else if (!/^\s*1\.\s+\S/m.test(steps)) errors.push('"## Steps" must be a numbered list starting at 1.');
  if (section(src, 'If it goes wrong') === null) errors.push('no "## If it goes wrong" section');
  const log = section(src, 'Changelog');
  if (log === null) errors.push('no "## Changelog" section');
  else if (!/^\s*-\s*\d{4}-\d{2}-\d{2}\b/m.test(log)) errors.push('"## Changelog" needs at least one dated line (- YYYY-MM-DD — …)');
  if (/\{\{[^}]*\}\}/.test(src)) errors.push('template placeholders left ({{…}})');
  for (const [re, what] of SECRETS) if (re.test(src)) errors.push(`secret-looking string (${what}): name the setting, never its value`);
  if (kit) for (const t of CLIENT_TERMS) if (src.toLowerCase().includes(t)) errors.push(`client name "${t}" in a kit SOP (agent teams are products)`);
  const unverified = (src.match(/⚠\s*unverified/gi) ?? []).length;
  if (unverified) (strict ? errors : warnings).push(`${unverified} step(s) marked ⚠ unverified`);
  return { file, errors, warnings, unverified };
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue; // .published/
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.md') && !SKIP.has(name)) out.push(p);
  }
  return out;
}

export function checkDir(dir, opts = {}) {
  const results = [];
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8');
    const r = checkSop(src, { ...opts, file });
    for (const [, target] of src.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue; // http:, https:, mailto:, notion:
      if (!existsSync(path.resolve(path.dirname(file), target))) r.errors.push(`broken link: ${target}`);
    }
    results.push(r);
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? 'docs/sops';
  if (!existsSync(dir)) { console.error(`sop-check: ${dir} not found`); process.exit(2); }
  const results = checkDir(dir, { strict: args.includes('--strict'), kit: args.includes('--kit') });
  let errs = 0;
  let unv = 0;
  for (const r of results) {
    for (const e of r.errors) { console.log(`✗ ${r.file}: ${e}`); errs++; }
    for (const w of r.warnings) console.log(`⚠ ${r.file}: ${w}`);
    unv += r.unverified;
  }
  console.log(`sop-check: ${results.length} SOP(s), ${errs} error(s), ${unv} unverified step(s)`);
  process.exit(errs ? 1 : 0);
}
