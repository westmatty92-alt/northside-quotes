#!/usr/bin/env node
// Tests the Baseleap Opengrep rules against the fixture repo.
// Every line with "expect: <rule-id>[, <rule-id>]" must be flagged with exactly those rules; no other line may be flagged.
// Usage: node check-rules.mjs [rules.yml] [fixture-dir]   (defaults: ../templates/opengrep-baseleap.yml, ./fixture-repo)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rules = path.resolve(process.argv[2] ?? path.join(here, '../templates/opengrep-baseleap.yml'));
const repo = path.resolve(process.argv[3] ?? path.join(here, 'fixture-repo'));
const bin = process.env.OPENGREP ?? 'opengrep';

const v = spawnSync(bin, ['scan', '--validate', '--config', rules], { encoding: 'utf8' });
if (v.status !== 0) { console.error(`rule validation failed:\n${v.stdout}\n${v.stderr}`); process.exit(1); }

const r = spawnSync(bin, ['scan', '--config', rules, '--json', '--taint-intrafile', '--no-git-ignore', '--quiet', '.'],
  { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0 && r.status !== 1) { console.error(`opengrep failed (${r.status}):\n${r.stderr}`); process.exit(1); }
const out = JSON.parse(r.stdout);
if (out.errors?.length) console.warn('opengrep reported errors:', JSON.stringify(out.errors.map((e) => e.message ?? e), null, 1));

const key = (file, line, id) => `${file}:${line} ${id}`;
const actual = new Set(out.results.map((x) => key(x.path.replace(/^\.\//, ''), x.start.line, x.check_id.split('.').pop())));

const expected = new Set();
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  fs.readFileSync(p, 'utf8').split('\n').forEach((text, i) => {
    const m = text.match(/expect:\s*([\w, -]+?)\s*(\*\/\})?\s*$/);
    if (m) m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((id) => expected.add(key(path.relative(repo, p), i + 1, id)));
  });
});
walk(repo);

const missed = [...expected].filter((k) => !actual.has(k));
const extra = [...actual].filter((k) => !expected.has(k));
const ruleIds = new Set([...expected].map((k) => k.split(' ')[1]));
console.log(`rules exercised: ${ruleIds.size} · expected hits: ${expected.size} · actual hits: ${actual.size}`);
missed.forEach((k) => console.log(`MISSED   ${k}`));
extra.forEach((k) => console.log(`UNWANTED ${k}`));
if (missed.length || extra.length) process.exit(1);
console.log('PASS: every expected finding fired and nothing else did');
