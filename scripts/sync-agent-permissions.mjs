#!/usr/bin/env node
// Writes each agent's `tools` and `mcpServers` frontmatter from .claude/permissions.json, the single source of truth.
// Usage:
//   node scripts/sync-agent-permissions.mjs                 write
//   node scripts/sync-agent-permissions.mjs --check         exit 1 if any agent file is out of sync (CI)
//   node scripts/sync-agent-permissions.mjs --enable figma  include an opt-in server (repeatable)
// MCP servers are written inline so each connects only while its agent runs. The Supabase server is pinned to the
// staging branch from infra/environments.json; without a known staging ref it is left out (with a warning), never
// pointed at a guess.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const enabled = new Set(args.flatMap((a, i) => (a === '--enable' ? [args[i + 1]] : [])));
const perms = JSON.parse(fs.readFileSync(path.join(root, '.claude/permissions.json'), 'utf8'));
const catalog = perms.mcpCatalog ?? {};

function stagingRef() {
  const f = path.join(root, 'infra/environments.json');
  if (!fs.existsSync(f)) return null;
  const ref = JSON.parse(fs.readFileSync(f, 'utf8')).environments?.staging?.supabase;
  return ref && !/REPLACE/i.test(ref) ? ref : null;
}

const warnings = [];
export function serversFor(agent, a) {
  const out = [];
  for (const entry of a.mcpServers ?? []) {
    const name = entry.split(/[\s(]/)[0];
    const def = catalog[name];
    if (!def) { warnings.push(`${agent}: no mcpCatalog entry for "${name}"`); continue; }
    if (def.optIn && !enabled.has(name)) continue;
    const { optIn, allowTools = ['*'], ...conf } = def;
    if (JSON.stringify(conf).includes('{{SUPABASE_STAGING_REF}}')) {
      const ref = stagingRef();
      if (!ref) { warnings.push(`${agent}: supabase MCP left out (no staging ref in infra/environments.json)`); continue; }
      conf.url = conf.url.replace('{{SUPABASE_STAGING_REF}}', ref);
    }
    out.push({ name, conf, allow: allowTools.map((t) => (t === '*' ? `mcp__${name}__*` : `mcp__${name}__${t}`)) });
  }
  return out;
}

const yamlScalar = (v) => (typeof v === 'string' && /[:#{}[\],&*?|<>=!%@`'"]|^\s|\s$/.test(v) ? JSON.stringify(v) : String(v));
function mcpYaml(servers) {
  if (!servers.length) return '';
  const lines = ['mcpServers:'];
  for (const { name, conf } of servers) {
    lines.push(`  - ${name}:`);
    for (const [k, v] of Object.entries(conf)) {
      if (Array.isArray(v)) { lines.push(`      ${k}:`); v.forEach((x) => lines.push(`        - ${yamlScalar(x)}`)); }
      else lines.push(`      ${k}: ${yamlScalar(v)}`);
    }
  }
  return lines.join('\n');
}

/** Replace the tools line and the mcpServers block inside a frontmatter string, keeping everything else. */
export function rewriteFrontmatter(front, { tools, mcp }) {
  const lines = front.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^tools:/.test(lines[i]) && tools) continue;
    if (/^mcpServers:/.test(lines[i])) { while (i + 1 < lines.length && /^\s/.test(lines[i + 1])) i++; continue; }
    out.push(lines[i]);
  }
  const at = Math.max(out.findIndex((l) => /^effort:/.test(l)), out.findIndex((l) => /^model:/.test(l))) + 1 || out.length;
  const insert = [tools ? `tools: ${tools}` : null, mcp || null].filter(Boolean);
  out.splice(at, 0, ...insert);
  return out.join('\n');
}

let drift = 0;
for (const [agent, a] of Object.entries(perms.agents)) {
  const file = path.join(root, '.claude/agents', `${agent}.md`);
  if (!fs.existsSync(file)) { warnings.push(`${agent}: no agent file`); continue; }
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) { warnings.push(`${agent}: no frontmatter`); continue; }
  const servers = serversFor(agent, a);
  // A tools allowlist without mcp__ entries blocks every MCP tool, so each server's allowed tools are appended.
  const tools = Array.isArray(a.tools) ? [...a.tools, ...servers.flatMap((s) => s.allow)].join(', ') : null; // "inherits" (orchestrator) → leave as is
  const next = text.replace(m[0], `---\n${rewriteFrontmatter(m[1], { tools, mcp: mcpYaml(servers) })}\n---`);
  if (next !== text) {
    drift++;
    if (check) console.log(`out of sync: ${agent}`);
    else { fs.writeFileSync(file, next); console.log(`updated: ${agent}`); }
  }
}
warnings.forEach((w) => console.log(`note: ${w}`));
if (check) { console.log(drift ? `${drift} agent file(s) out of sync — run node scripts/sync-agent-permissions.mjs` : 'agent permissions in sync'); process.exit(drift ? 1 : 0); }
