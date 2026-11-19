#!/usr/bin/env node
// Renders PERMISSIONS.md from .claude/permissions.json (the source of truth). Usage: node scripts/render-permissions.mjs [--check]
// --check exits 1 if PERMISSIONS.md is out of date (for CI / the ledger).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(fs.readFileSync(path.join(root, '.claude/permissions.json'), 'utf8'));
const list = (x) => (Array.isArray(x) ? (x.length ? x.map((s) => (s.includes('/') || s.includes('.') ? `\`${s}\`` : s)).join(', ') : '—') : x);
const yn = (b) => (b === true ? 'yes' : b === false ? 'no' : b);

let md = `# Baseleap Dev Team · Access & Permissions Matrix (v${src.version})\n\n`;
md += `> Generated from \`.claude/permissions.json\` by \`scripts/render-permissions.mjs\`. Edit the JSON, not this file.\n\n`;
md += `## Summary\n\n| Agent | Model | Phases | Shell | Web | MCP servers | Writes |\n|---|---|---|---|---|---|---|\n`;
for (const [name, a] of Object.entries(src.agents)) {
  md += `| **${name}** | ${a.model} | ${a.phases} | ${String(a.bash).split(':')[0]} | ${yn(a.web)} | ${list(a.mcpServers)} | ${list(a.write)} |\n`;
}
md += `\n## Per agent\n`;
for (const [name, a] of Object.entries(src.agents)) {
  md += `\n### ${name}\n\n| | |\n|---|---|\n`;
  for (const k of ['tools', 'bash', 'web', 'mcpServers', 'write', 'writeLock', 'read', 'git', 'database', 'secrets', 'production', 'humanGates', 'notes']) {
    if (a[k] === undefined) continue;
    md += `| **${k}** | ${k === 'tools' ? (Array.isArray(a.tools) ? a.tools.join(', ') : a.tools) : list(a[k])} |\n`;
  }
}
md += `\n## Rules for every agent\n\n`;
md += `- **Every agent may write:** ${list(src.global.everyAgentMayWrite)}\n`;
for (const s of ['git', 'secrets', 'mcp']) md += `\n**${s[0].toUpperCase() + s.slice(1)}**\n${src.global[s].map((r) => `- ${r}`).join('\n')}\n`;
md += `\n**Untrusted content:** ${src.global.untrustedContent}\n\n**Permission mode:** ${src.global.permissionMode}\n`;
md += `\n## How it's enforced\n\n${src.global.enforcement.map((r) => `- ${r}`).join('\n')}\n`;

const out = path.join(root, 'PERMISSIONS.md');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== md) { console.error('PERMISSIONS.md is out of date: run node scripts/render-permissions.mjs'); process.exit(1); }
  console.log('PERMISSIONS.md is up to date');
} else {
  fs.writeFileSync(out, md);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}
