#!/usr/bin/env node
// check-architecture — structural checker for bl-architect's blueprint step. No dependencies.
//
//   node scripts/check-architecture.mjs [repoDir]
//
// Exits 0 only when every check passes; prints each problem as file:line: message.
// It checks that the blueprint is complete, traceable and follows the house rules.
// Whether the design is *good* is Matthew's call at Gate 2 (and Redocly / the RLS tests
// cover what this can't).
//
// Checks:
//   files        a NNNN-*stack* decision + index, architecture.md, SECURITY_MODEL.md, openapi.yaml,
//                ≥ 1 migration, ≥ 1 RLS test
//   decisions    every docs/decisions/NNNN-*.md is linked from docs/decisions/README.md
//   architecture required sections; an erDiagram inside "Data model"
//   security     Trust boundaries, Permission matrix, ≥ 5 numbered Security invariants
//   migrations   (comments stripped) every public table: RLS enabled + ≥ 1 policy in the same file;
//                no bare timestamp; no float/real/double/money; every references has on delete;
//                a "-- rollback" block per file
//   contract     OpenAPI 3.1; unique operationId; x-stories with known US ids; ≥ 1 4xx response;
//                security (explicit `security: []` only on /health, /webhooks/* and /auth/*); every Must story
//                in some x-stories or in "Stories served without the API"
//   integration  when PRD build_mode is platform_extension or hybrid: docs/integration-contract.md
//                with its sections, ≥ 1 field-mapping row or "None in v1 — reason", allowed directions, a conflict rule for `both`
//   placeholders no template <placeholders> left in blueprint files

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, lineOf } from './lib/yaml-lite.mjs';

const ARCH_SECTIONS = ['Summary', 'Modules', 'Data model', 'Lane ownership', 'Environment variables', 'Capacity & reliability', 'Observability'];
const SEC_SECTIONS = ['Trust boundaries', 'Permission matrix', 'Security invariants'];
const INT_SECTIONS = ['Systems and roles', 'Record ownership', 'Field mapping', 'Events and webhooks', 'Conflicts', 'When the platform is down', 'Credentials and scopes'];
const DIRECTIONS = ['in', 'out', 'both', 'read-only'];
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];
const INTEGRATION_MODES = ['platform_extension', 'hybrid'];

const readText = (dir, rel) => {
  const p = path.join(dir, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** Markdown `## ` sections: { name, line (1-based), body } */
function sections(text) {
  const out = [];
  const lines = text.split('\n');
  let cur = null, fence = false;
  lines.forEach((l, idx) => {
    if (/^\s*```/.test(l)) fence = !fence;
    const h = !fence && l.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = { name: h[1], line: idx + 1, body: [] }; out.push(cur); return; }
    if (cur) cur.body.push({ text: l, line: idx + 1 });
  });
  return out;
}
const findSection = (secs, name) => secs.find((s) => s.name.toLowerCase().startsWith(name.toLowerCase()));

/** First markdown table in a list of {text,line}: { header, rows: [{cells, line}] } */
function firstTable(body) {
  const cellsOf = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  let t = null;
  for (const { text, line } of body) {
    if (/^\s*\|/.test(text)) {
      if (!t) { t = { header: cellsOf(text).map((h) => h.toLowerCase()), rows: [] }; continue; }
      if (/^\s*\|\s*:?-{2,}/.test(text)) continue;
      t.rows.push({ cells: cellsOf(text), line });
    } else if (t) break;
  }
  return t;
}

/** Remove SQL comments (-- to end of line, /* *\/), keeping line numbers and string literals. */
export function stripSqlComments(sql) {
  let out = '', i = 0, q = null;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (q) {
      out += c;
      if (q === '$$' && c === '$' && n === '$') { out += n; i += 2; q = null; continue; }
      if (q === "'" && c === "'") q = null;
      i++; continue;
    }
    if (c === "'") { q = "'"; out += c; i++; continue; }
    if (c === '$' && n === '$') { q = '$$'; out += '$$'; i += 2; continue; }
    if (c === '-' && n === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) { if (sql[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    out += c; i++;
  }
  return out;
}

/** Split on commas at paren depth 0. Returns [{ text, offset }] */
function splitTopLevel(s, baseOffset) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) { parts.push({ text: s.slice(start, i), offset: baseOffset + start }); start = i + 1; }
  }
  parts.push({ text: s.slice(start), offset: baseOffset + start });
  return parts;
}

const TABLE_NAME = String.raw`(?:(?:"?public"?)\.)?"?([a-z_][a-z0-9_]*)"?`;

export function checkMigration(rel, sql, at) {
  if (!/^\s*--\s*rollback\b/im.test(sql)) at(rel, 1, 'no "-- rollback" block — every migration says how to undo it');
  const code = stripSqlComments(sql);

  // public tables created here (skip other schemas)
  const created = [];
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)\s*\(/gi;
  for (const m of code.matchAll(createRe)) {
    const full = m[1].replace(/"/g, '').toLowerCase();
    const [schema, name] = full.includes('.') ? full.split('.') : ['public', full];
    // body: from "(" to its matching ")"
    let depth = 0, j = m.index + m[0].length - 1, end = -1;
    for (; j < code.length; j++) { if (code[j] === '(') depth++; else if (code[j] === ')') { depth--; if (depth === 0) { end = j; break; } } }
    const bodyStart = m.index + m[0].length;
    const body = code.slice(bodyStart, end < 0 ? code.length : end);
    if (schema === 'public') created.push({ name, line: lineAt(code, m.index) });
    for (const col of splitTopLevel(body, bodyStart)) {
      checkColumn(rel, code, col.text, col.offset, at);
    }
  }
  // columns added later
  for (const m of code.matchAll(/alter\s+table\s+[^;]*?add\s+column\s+([^;]+)/gi)) {
    for (const col of splitTopLevel(m[1].replace(/,\s*add\s+column\s+/gi, ', '), m.index + m[0].indexOf(m[1]))) checkColumn(rel, code, col.text, col.offset, at);
  }

  for (const t of created) {
    const rls = new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${TABLE_NAME.replace('([a-z_][a-z0-9_]*)', t.name)}\s+enable\s+row\s+level\s+security`, 'i');
    const policy = new RegExp(String.raw`create\s+policy\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)\s+on\s+${TABLE_NAME.replace('([a-z_][a-z0-9_]*)', t.name)}\b`, 'i');
    if (!rls.test(code)) at(rel, t.line, `table public.${t.name} has no "enable row level security" in this migration (comments don't count)`);
    if (!policy.test(code)) at(rel, t.line, `table public.${t.name} has no "create policy" in this migration`);
  }
}

function checkColumn(rel, code, text, offset, at) {
  const t = text.trim();
  if (!t) return;
  const ln = lineAt(code, offset + (text.length - text.trimStart().length));
  const col = t.split(/\s+/)[0];
  if (/\btimestamp\b(?!\s*tz)(?!\s+with\s+time\s+zone)/i.test(t) || /\btimestamp\s+without\s+time\s+zone\b/i.test(t)) at(rel, ln, `${col}: timestamp without time zone — use timestamptz`);
  const fl = t.match(/\b(float\d*|real|double\s+precision|money)\b/i);
  if (fl && !/^(constraint|check)\b/i.test(t)) at(rel, ln, `${col}: ${fl[1].toLowerCase()} column — store money as integer cents (bigint) and measurements as numeric`);
  if (/\breferences\b/i.test(t) && !/\bon\s+delete\b/i.test(t)) at(rel, ln, `${col}: references without "on delete" — say what happens to these rows (cascade / restrict / set null)`);
}

/** Story ids and priorities from docs/user-stories.md */
function stories(text) {
  const out = new Map();
  let cur = null;
  text.split('\n').forEach((l) => {
    const h = l.match(/^###\s+(US-\d{3})/); if (h) { cur = h[1]; out.set(cur, 'unknown'); return; }
    const p = l.match(/^Priority:\s*(Must|Should|Could|Won't)/i);
    if (p && cur) out.set(cur, p[1].toLowerCase());
  });
  return out;
}

function prdMode(text) {
  const fm = text?.match(/^---\n([\s\S]*?)\n---/);
  return fm?.[1].match(/^build_mode:\s*([a-z_]+)/m)?.[1] ?? null;
}

const PLACEHOLDER_MD = /<(?!!--)(?!\/?(?:br|sub|sup|details|summary|kbd)\b)[A-Za-z][^<>\n`]{0,80}>/g;
const PLACEHOLDER_CODE = /<[A-Za-z_][\w -]{0,40}>/g;

function placeholdersMd(rel, text, at) {
  let fence = false;
  text.split('\n').forEach((l, idx) => {
    if (/^\s*```/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const outside = l.replace(/`[^`]*`/g, '');
    for (const m of outside.matchAll(PLACEHOLDER_MD)) at(rel, idx + 1, `template placeholder left: ${m[0]}`);
  });
}

export function check(dir) {
  const problems = [];
  const at = (file, line, msg) => problems.push(`${file}:${line}: ${msg}`);

  // ---- files
  const need = ['docs/decisions/README.md', 'docs/architecture.md', 'docs/SECURITY_MODEL.md', 'docs/openapi.yaml', 'docs/user-stories.md'];
  for (const f of need) if (!fs.existsSync(path.join(dir, f))) at(f, 0, 'missing');
  const migDir = path.join(dir, 'supabase/migrations');
  const migrations = fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort() : [];
  if (!migrations.length) at('supabase/migrations', 0, 'no migrations');
  const rlsDir = path.join(dir, 'supabase/tests/rls');
  if (!(fs.existsSync(rlsDir) && fs.readdirSync(rlsDir).some((f) => f.endsWith('.sql')))) at('supabase/tests/rls', 0, 'no RLS tests — prove one user can\'t read another\'s rows');

  // ---- decisions index
  const decDir = path.join(dir, 'docs/decisions');
  const index = readText(dir, 'docs/decisions/README.md');
  const decFiles = fs.existsSync(decDir) ? fs.readdirSync(decDir) : [];
  if (!decFiles.some((f) => /^\d{4}-.*stack.*\.md$/.test(f))) at('docs/decisions', 0, 'no stack decision (docs/decisions/NNNN-stack.md) — number it after any intake decisions already there');
  if (fs.existsSync(decDir) && index != null) {
    for (const f of fs.readdirSync(decDir).filter((f) => /^\d{4}-.+\.md$/.test(f))) {
      if (!index.includes(f)) at('docs/decisions/README.md', 0, `${f} isn't listed in the decisions index`);
    }
  }

  // ---- architecture.md
  const arch = readText(dir, 'docs/architecture.md');
  let archSecs = [];
  if (arch != null) {
    archSecs = sections(arch);
    for (const s of ARCH_SECTIONS) if (!findSection(archSecs, s)) at('docs/architecture.md', 0, `missing section "## ${s}"`);
    const dm = findSection(archSecs, 'Data model');
    if (dm && !dm.body.some((b) => /^\s*erDiagram\b/.test(b.text))) at('docs/architecture.md', dm.line, '"Data model" has no mermaid erDiagram');
  }

  // ---- SECURITY_MODEL.md
  const sec = readText(dir, 'docs/SECURITY_MODEL.md');
  if (sec != null) {
    const secs = sections(sec);
    for (const s of SEC_SECTIONS) if (!findSection(secs, s)) at('docs/SECURITY_MODEL.md', 0, `missing section "## ${s}"`);
    const inv = findSection(secs, 'Security invariants');
    if (inv) {
      const n = inv.body.filter((b) => /^\s*\d+\.\s+\S/.test(b.text)).length;
      if (n < 5) at('docs/SECURITY_MODEL.md', inv.line, `only ${n} numbered security invariants — need at least 5`);
    }
  }

  // ---- migrations
  for (const f of migrations) {
    const rel = `supabase/migrations/${f}`;
    const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
    checkMigration(rel, sql, at);
    const code = stripSqlComments(sql);
    code.split('\n').forEach((l, idx) => { for (const m of l.replace(/'[^']*'/g, '').matchAll(PLACEHOLDER_CODE)) at(rel, idx + 1, `template placeholder left: ${m[0]}`); });
  }

  // ---- contract
  const storyText = readText(dir, 'docs/user-stories.md');
  const known = storyText ? stories(storyText) : new Map();
  const served = new Set();
  const openapiText = readText(dir, 'docs/openapi.yaml');
  if (openapiText != null) {
    let api = null;
    try { api = parseYaml(openapiText); } catch (e) { at('docs/openapi.yaml', Number(String(e.message).match(/line (\d+)/)?.[1] ?? 0), `can't read YAML: ${e.message}`); }
    if (api) checkContract(api, known, served, at);
    openapiText.split('\n').forEach((l, idx) => { const s = l.replace(/#.*$/, ''); for (const m of s.matchAll(PLACEHOLDER_CODE)) at('docs/openapi.yaml', idx + 1, `template placeholder left: ${m[0]}`); });
  }
  // Must coverage
  const without = findSection(archSecs, 'Stories served without the API');
  if (without) for (const b of without.body) for (const m of b.text.matchAll(/US-\d{3}/g)) served.add(m[0]);
  for (const [id, prio] of known) if (prio === 'must' && !served.has(id)) at('docs/openapi.yaml', 0, `Must story ${id} isn't in any operation's x-stories or in architecture.md "Stories served without the API"`);

  // ---- integration contract
  const mode = prdMode(readText(dir, 'docs/PRD.md'));
  const intText = readText(dir, 'docs/integration-contract.md');
  if (INTEGRATION_MODES.includes(mode)) {
    if (intText == null) at('docs/integration-contract.md', 0, `missing — build_mode is ${mode}, so the blueprint needs an integration contract`);
    else checkIntegration(intText, at);
  }

  // ---- placeholders in prose files
  for (const rel of ['docs/architecture.md', 'docs/SECURITY_MODEL.md', ...(INTEGRATION_MODES.includes(mode) ? ['docs/integration-contract.md'] : [])]) {
    const t = readText(dir, rel); if (t != null) placeholdersMd(rel, t, at);
  }
  if (fs.existsSync(decDir)) for (const f of fs.readdirSync(decDir).filter((f) => f.endsWith('.md'))) placeholdersMd(`docs/decisions/${f}`, fs.readFileSync(path.join(decDir, f), 'utf8'), at);

  return problems;
}

function checkContract(api, known, served, at) {
  const F = 'docs/openapi.yaml';
  if (!/^3\.1\./.test(String(api.openapi ?? ''))) at(F, lineOf(api, 'openapi'), `openapi must be 3.1.x (found ${api.openapi ?? 'none'})`);
  const globalSecure = Array.isArray(api.security) && api.security.length > 0;
  const ids = new Map();
  const paths = api.paths ?? {};
  if (!Object.keys(paths).length) at(F, lineOf(api, 'paths'), 'no paths');
  for (const [p, item] of Object.entries(paths)) {
    if (!item || typeof item !== 'object') continue;
    if (item.$ref) { at(F, lineOf(paths, p), `${p}: $ref path items aren't supported — keep the contract in one file`); continue; }
    const open = /(^|\/)health\/?$/.test(p) || /(^|\/)webhooks(\/|$)/.test(p) || /^\/auth(\/|$)/.test(p);
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const ln = lineOf(item, m);
      const name = `${m.toUpperCase()} ${p}`;
      if (!op.operationId) at(F, ln, `${name}: no operationId`);
      else if (ids.has(op.operationId)) at(F, ln, `${name}: operationId ${op.operationId} is also used at line ${ids.get(op.operationId)}`);
      else ids.set(op.operationId, ln);
      const xs = op['x-stories'];
      if (!Array.isArray(xs) || !xs.length) at(F, ln, `${name}: no x-stories — say which user stories this serves`);
      else for (const s of xs) {
        if (!/^US-\d{3}$/.test(String(s))) at(F, lineOf(op, 'x-stories'), `${name}: x-stories entry "${s}" isn't a story id (US-NNN)`);
        else if (!known.has(s)) at(F, lineOf(op, 'x-stories'), `${name}: x-stories ${s} isn't in docs/user-stories.md`);
        else served.add(s);
      }
      const codes = Object.keys(op.responses ?? {});
      if (!codes.some((c) => /^4(\d\d|XX)$/i.test(c))) at(F, lineOf(op, 'responses') || ln, `${name}: no 4xx response — document how it fails`);
      const hasOwn = Object.prototype.hasOwnProperty.call(op, 'security');
      const explicitOpen = hasOwn && Array.isArray(op.security) && op.security.length === 0;
      if (explicitOpen && !open) at(F, lineOf(op, 'security'), `${name}: security: [] (no auth) is only allowed on /health, /webhooks/* and /auth/*`);
      if (!globalSecure && !hasOwn) at(F, ln, `${name}: no security — add it (or a global security block)`);
      if (!globalSecure && hasOwn && !explicitOpen && (!Array.isArray(op.security))) at(F, lineOf(op, 'security'), `${name}: security must be a list`);
    }
  }
}

function checkIntegration(text, at) {
  const F = 'docs/integration-contract.md';
  const secs = sections(text);
  for (const s of INT_SECTIONS) if (!findSection(secs, s)) at(F, 0, `missing section "## ${s}"`);
  const fm = findSection(secs, 'Field mapping');
  let both = false;
  if (fm) {
    const t = firstTable(fm.body);
    const di = t ? t.header.findIndex((h) => h.startsWith('direction')) : -1;
    const noneDeclared = fm.body.some((b) => /^\s*(\*\*)?\s*(none|no (field|sync|fields))\b[^\n]*\bv1\b/i.test(b.text));
    if ((!t || !t.rows.length) && noneDeclared) { /* "None in v1 — <reason>" is a valid answer */ }
    else if (!t || !t.rows.length) at(F, fm.line, '"Field mapping" has no table rows (or say "None in v1 — <reason>")');
    else if (di < 0) at(F, fm.line, '"Field mapping" table has no Direction column');
    else for (const r of t.rows) {
      const d = (r.cells[di] ?? '').replace(/`/g, '').trim().toLowerCase();
      if (!DIRECTIONS.includes(d)) at(F, r.line, `direction "${r.cells[di]}" — use one of ${DIRECTIONS.join(', ')}`);
      if (d === 'both') both = true;
    }
  }
  const cf = findSection(secs, 'Conflicts');
  if (both && cf && !cf.body.some((b) => b.text.trim() && !/^\s*(none|n\/a)\b/i.test(b.text))) at(F, cf.line, 'a field syncs both ways but "Conflicts" has no rule');
  const down = findSection(secs, 'When the platform is down');
  if (down) { const t = firstTable(down.body); if (!t || !t.rows.length) at(F, down.line, '"When the platform is down" has no situations'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? '.');
  const problems = check(dir);
  if (problems.length) {
    for (const p of problems) console.log(p);
    console.log(`\ncheck-architecture: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
    process.exit(1);
  }
  console.log('check-architecture: OK');
}
