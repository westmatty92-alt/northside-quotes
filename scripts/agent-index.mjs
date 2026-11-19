#!/usr/bin/env node
// agent-index.mjs: a readable index of the team's agents, generated from .claude/agents/*.md and
// .claude/permissions.json (the source of truth). Never edited by hand (docs-index).
// Usage: node scripts/agent-index.mjs [root=.] > docs/sops/agents/index.md
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export function readAgents(root = '.') {
  const dir = path.join(root, '.claude/agents');
  const permsFile = path.join(root, '.claude/permissions.json');
  const perms = existsSync(permsFile) ? JSON.parse(readFileSync(permsFile, 'utf8')).agents ?? {} : {};
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const front = readFileSync(path.join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const field = (k) => front.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim() ?? '';
    const skills = [...(front.match(/^skills:\n((?:\s+- .+\n?)+)/m)?.[1] ?? '').matchAll(/- (\S+)/g)].map((m) => m[1]);
    const name = field('name') || f.replace(/\.md$/, '');
    return { name, status: field('baseleap-status') || 'unknown', description: field('description'), skills, write: perms[name]?.write ?? [], phases: perms[name]?.phases ?? '' };
  });
}

export function renderIndex(agents, { kit = '' } = {}) {
  const ready = agents.filter((a) => a.status === 'ready').length;
  const lines = [
    '# Baseleap dev team: agents',
    '',
    `Generated from the kit${kit ? ` (${kit})` : ''} by \`scripts/agent-index.mjs\`. Don't edit by hand: change the agent file and regenerate.`,
    '',
    `${agents.length} agents · ${ready} ready · ${agents.length - ready} not yet built (skeleton)`,
    '',
    '| Agent | Status | When it runs | Job |',
    '|---|---|---|---|',
    ...agents.map((a) => `| \`${a.name}\` | ${a.status === 'ready' ? '✅ ready' : '⏳ ' + a.status} | ${a.phases.replace(/\|/g, '/') || '—'} | ${a.description.split('. ')[0].replace(/\|/g, '/')}. |`),
    '',
  ];
  for (const a of agents) {
    lines.push(`## ${a.name}`, '', a.description, '', `**Skills:** ${a.skills.map((s) => `\`${s}\``).join(', ') || '—'}`, '', `**May write:** ${a.write.map((w) => `\`${w}\``).join(', ') || 'nothing (reads only, or the orchestrator)'}`, '');
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(renderIndex(readAgents(process.argv[2] ?? '.'), { kit: process.env.KIT_VERSION ?? '' }));
}
