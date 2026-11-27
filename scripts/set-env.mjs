#!/usr/bin/env node
// scripts/set-env.mjs: add settings to this project's .env.local without hand-editing it (rehearsal lesson, Nov 20 2026:
// nano edits that never saved, values pasted without their NAME=, a stray fragment glued to a comment).
//
//   node scripts/set-env.mjs NAME1 NAME2 …            asks for each missing NAME (input hidden), then writes NAME=value
//   node scripts/set-env.mjs STAGING_URL=https://…     a non-secret given inline
//   node scripts/set-env.mjs --check NAME1 NAME2 …      reports which names are present, never a value
//
// Run it in a terminal yourself (Matthew). Agents never run it: values must not pass through them.
import fs from 'node:fs';
import readline from 'node:readline';

const FILE = process.env.SET_ENV_FILE || '.env.local';
const args = process.argv.slice(2);
const check = args[0] === '--check';
const wanted = (check ? args.slice(1) : args).map((a) => {
  const m = a.match(/^([A-Z][A-Z0-9_]*)(?:=(.*))?$/);
  if (!m) { console.error(`set-env: "${a.split('=')[0]}" is not a setting name (CAPITALS_AND_UNDERSCORES).`); process.exit(2); }
  return { name: m[1], value: m[2] };
});
if (!wanted.length) { console.error('usage: node scripts/set-env.mjs NAME [NAME=value] …   |   --check NAME …'); process.exit(2); }

const read = () => (fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '').split('\n');
const namesIn = (lines) => new Set(lines.map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1]).filter(Boolean));
const broken = (lines) => lines.filter((l) => l.trim() && !l.trim().startsWith('#') && !/^[A-Z][A-Z0-9_]*=/.test(l)).length;

function report(lines) {
  const have = namesIn(lines);
  const missing = wanted.map((w) => w.name).filter((n) => !have.has(n));
  console.log(`${FILE}: ${have.size} settings, ${broken(lines)} broken line(s). ${missing.length ? `Missing: ${missing.join(', ')}` : 'All requested names present.'}`);
  return missing.length === 0 && broken(lines) === 0;
}

if (check) process.exit(report(read()) ? 0 : 1);

const piped = process.stdin.isTTY ? [] : fs.readFileSync(0, 'utf8').split('\n');

function ask(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) { resolve((piped.shift() ?? '').trim()); return; } // piped input (tests): one line per prompt
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(question); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a.trim()); });
  });
}

let lines = read();
// Junk glued in front of a comment ("abc123# Copy to …") is cut back to the comment.
lines = lines.map((l) => { const i = l.indexOf('#'); return i > 0 && !/^[A-Z][A-Z0-9_]*=/.test(l) && !l.slice(0, i).includes('=') ? l.slice(i) : l; });
const have = namesIn(lines);
for (const w of wanted) {
  if (have.has(w.name) && w.value === undefined) continue;
  const value = w.value ?? (await ask(`Paste ${w.name}, then Enter (nothing will show): `));
  if (!value) { console.log(`${w.name}: nothing pasted, skipped.`); continue; }
  if (/\s/.test(value)) { console.log(`${w.name}: contained spaces or line breaks, not saved.`); continue; }
  lines = lines.filter((l) => !l.startsWith(`${w.name}=`));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push(`${w.name}=${value}`, '');
  have.add(w.name);
}
fs.writeFileSync(FILE, lines.join('\n'), { mode: 0o600 });
process.exit(report(read()) ? 0 : 1);
