#!/usr/bin/env node
// Structural checker for the PM's three documents (ledger verify for step P0). No dependencies, never auto-fixes.
// Usage: node scripts/check-pm-docs.mjs [--dir docs]
// Exit 0 when PRD.md, user-stories.md and metrics-spec.md all pass; 1 otherwise. Prints every problem as file:line.
import fs from 'node:fs';
import path from 'node:path';

export const BUILD_MODES = ['in_platform', 'platform_extension', 'hybrid', 'custom'];
const REQUIRED_H2 = ['Overview', 'Goals & Success Metrics', 'Scope', 'Functional Requirements', 'Edge Cases', 'Technical Considerations', 'Agent Execution Contract', 'Open Questions'];
const BANNED = ['correctly', 'properly', 'appropriately', 'seamlessly', 'user-friendly', 'intuitive', 'fast', 'robust', 'etc.', 'and so on'];
const TAGS = ['happy', 'edge', 'error', 'nfr'];

export function check(dir) {
  const problems = [];
  const warnings = [];
  const read = (name) => {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) { problems.push(`${name}: missing`); return null; }
    return { name, lines: fs.readFileSync(p, 'utf8').split('\n') };
  };
  const at = (doc, i, msg) => problems.push(`${doc.name}:${i + 1}: ${msg}`);

  // Leftover template text, outside HTML comments and code spans.
  const placeholders = (doc) => {
    let inComment = false;
    doc.lines.forEach((raw, i) => {
      let line = raw;
      if (inComment) { if (!line.includes('-->')) return; line = line.slice(line.indexOf('-->') + 3); inComment = false; }
      line = line.replace(/<!--.*?-->/g, '');
      if (line.includes('<!--')) { line = line.slice(0, line.indexOf('<!--')); inComment = true; }
      line = line.replace(/`[^`]*`/g, '');
      const m = line.match(/<[^<>\n]{1,80}>/) || line.match(/\b(TBD|TODO)\b/) || line.match(/\blorem\b/i);
      if (m) at(doc, i, `leftover template text "${m[0]}"`);
    });
  };

  const prd = read('PRD.md');
  const stories = read('user-stories.md');
  const metrics = read('metrics-spec.md');
  const frIds = new Map();      // FR-n → served stories
  const storyIds = new Map();   // US-NNN → { priority, line }

  // ---------- PRD ----------
  if (prd) {
    placeholders(prd);
    const text = prd.lines.join('\n');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    const ai = fm?.[1].match(/^ai_output:\s*(true|false)\b/m);
    if (!ai) at(prd, 0, 'frontmatter needs "ai_output: true|false"');
    const mode = fm?.[1].match(/^build_mode:\s*(\S+)/m)?.[1];
    if (!BUILD_MODES.includes(mode)) at(prd, 0, `frontmatter needs "build_mode: ${BUILD_MODES.join('|')}" (decided at intake — see build-specs/build-modes.md)`);
    const h2 = prd.lines.map((l, i) => [l.match(/^## (.+?)\s*$/)?.[1], i]).filter(([h]) => h);
    for (const want of REQUIRED_H2) if (!h2.some(([h]) => h === want)) at(prd, 0, `missing section "## ${want}"`);
    const section = (title, level = 2) => {
      const marker = '#'.repeat(level) + ' ';
      const start = prd.lines.findIndex((l) => l.trim() === marker + title);
      if (start === -1) return null;
      let end = prd.lines.findIndex((l, i) => i > start && /^#{1,6} /.test(l) && l.match(/^(#+)/)[1].length <= level);
      if (end === -1) end = prd.lines.length;
      return { start, lines: prd.lines.slice(start + 1, end) };
    };
    const ng = section('Non-goals', 3);
    if (!ng) at(prd, 0, 'missing "### Non-goals" under Scope');
    else if (!ng.lines.some((l) => /\bNG-\d+\b/.test(l))) at(prd, ng.start, 'Non-goals needs at least one NG-n item');
    prd.lines.forEach((l, i) => {
      const m = l.match(/^\s*-\s+\*\*(FR-\d+)\*\*/);
      if (!m) return;
      if (frIds.has(m[1])) at(prd, i, `duplicate ${m[1]}`);
      const serves = l.match(/Serves:\s*(.+)$/);
      if (!serves || !/US-\d{3}/.test(serves[1])) at(prd, i, `${m[1]} must list "Serves: US-…"`);
      frIds.set(m[1], { line: i, serves: serves ? [...serves[1].matchAll(/US-\d{3}/g)].map((x) => x[0]) : [] });
    });
    if (frIds.size === 0) at(prd, section('Functional Requirements')?.start ?? 0, 'no functional requirements (**FR-n**) found');
    const tech = section('Technical Considerations');
    if (tech) {
      if (!tech.lines.some((l) => /^\s*-\s+\*\*System of record:\*\*\s*\S/.test(l))) at(prd, tech.start, 'Technical Considerations needs "- **System of record:** …" (which system owns the customer records)');
      if (!tech.lines.some((l) => /^\s*-\s+\*\*Platform roles:\*\*\s*\S/.test(l))) at(prd, tech.start, 'Technical Considerations needs "- **Platform roles:** …" (what each platform does, or "none")');
    }
    if (ai?.[1] === 'true') {
      const aiSec = section('AI Behaviour and Evaluation');
      if (!aiSec || !aiSec.lines.some((l) => /^\|.*\|/.test(l) && !/^\|\s*-/.test(l))) at(prd, aiSec?.start ?? 0, 'ai_output is true, so "## AI Behaviour and Evaluation" needs its table');
    }
  }

  // ---------- Stories ----------
  if (stories) {
    placeholders(stories);
    const L = stories.lines;
    const heads = L.map((l, i) => [l.match(/^### (US-(\d{3})):/), i]).filter(([m]) => m);
    if (!heads.length) at(stories, 0, 'no stories ("### US-NNN: title") found');
    heads.forEach(([m, start], k) => {
      const id = m[1];
      const end = k + 1 < heads.length ? heads[k + 1][1] : L.findIndex((l, i) => i > start && /^## /.test(l)) === -1 ? L.length : L.findIndex((l, i) => i > start && /^## /.test(l));
      const body = L.slice(start + 1, end);
      if (storyIds.has(id)) at(stories, start, `duplicate ${id}`);
      const meta = body.find((l) => /Priority:/.test(l)) ?? '';
      const pr = meta.match(/Priority:\s*(Must|Should|Could)\b/);
      if (!pr) at(stories, start, `${id}: needs "Priority: Must|Should|Could"`);
      if (!/Persona:\s*\S/.test(meta)) at(stories, start, `${id}: needs "Persona:"`);
      const frs = meta.match(/Serves FR:\s*(.+)$/);
      if (!frs) at(stories, start, `${id}: needs "Serves FR:"`);
      else for (const fr of frs[1].match(/FR-\d+/g) ?? []) if (prd && !frIds.has(fr)) at(stories, start, `${id} references ${fr}, which isn't in PRD.md`);
      storyIds.set(id, { priority: pr?.[1], line: start });
      if (!body.some((l) => /^As .+, I want .+, so that .+/i.test(l.trim()))) at(stories, start, `${id}: needs the "As <persona>, I want …, so that …" sentence`);
      const acs = body.map((l, j) => [l, start + 1 + j]).filter(([l]) => /\*\*AC-/.test(l));
      const tags = new Set();
      for (const [l, i] of acs) {
        const a = l.match(/\*\*AC-(\d{3})\.(\d+)\*\*\s*\[(\w+)\]\s*(.*)$/);
        if (!a) { at(stories, i, 'criterion must look like "**AC-NNN.n** [tag] Given …, when …, then …"'); continue; }
        if (`US-${a[1]}` !== id) at(stories, i, `AC-${a[1]}.${a[2]} sits under ${id}; criterion numbers must match their story`);
        if (!TAGS.includes(a[3])) at(stories, i, `unknown tag [${a[3]}] (use ${TAGS.join('/')})`);
        tags.add(a[3]);
        if (!/^Given\b.+\bwhen\b.+\bthen\b/i.test(a[4])) at(stories, i, `AC-${a[1]}.${a[2]} must read "Given …, when …, then …"`);
        const lower = a[4].toLowerCase();
        for (const w of BANNED) {
          const re = new RegExp(`(^|[^a-z-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z-])`);
          if (re.test(lower)) at(stories, i, `vague word "${w}" in AC-${a[1]}.${a[2]}; say what is observable instead`);
        }
      }
      if (!tags.has('happy')) at(stories, start, `${id}: needs at least one [happy] criterion`);
      if (!tags.has('edge') && !tags.has('error')) at(stories, start, `${id}: needs at least one [edge] or [error] criterion`);
    });
    if (prd) {
      const served = new Set([...frIds.values()].flatMap((f) => f.serves));
      for (const [id, s] of storyIds) if (s.priority === 'Must' && !served.has(id)) at(stories, s.line, `${id} is a Must but no FR in PRD.md serves it`);
      for (const [fr, f] of frIds) for (const us of f.serves) if (stories && !storyIds.has(us)) at(prd, f.line, `${fr} serves ${us}, which isn't in user-stories.md`);
    }
    const total = storyIds.size;
    const musts = [...storyIds.values()].filter((s) => s.priority === 'Must').length;
    if (total && musts / total > 0.6) {
      const msg = `user-stories.md: ${musts} of ${total} stories are Must (over 60%); trim scope or re-prioritise`;
      if (total <= 3) warnings.push(msg); else problems.push(msg);
    }
  }

  // ---------- Metrics ----------
  if (metrics) {
    placeholders(metrics);
    const L = metrics.lines;
    const table = (title) => {
      const start = L.findIndex((l) => l.trim() === `## ${title}`);
      if (start === -1) return null;
      const rows = [];
      let header = null;
      for (let i = start + 1; i < L.length && !/^## /.test(L[i]); i++) {
        if (!/^\|/.test(L[i])) continue;
        const cells = L[i].split('|').slice(1, -1).map((c) => c.trim());
        if (cells.every((c) => /^-+$/.test(c))) continue;
        if (!header) header = cells; else rows.push({ cells, line: i });
      }
      return { start, header: header ?? [], rows };
    };
    const metricNames = new Set();
    const prim = table('Primary metric');
    if (!prim || !prim.rows.length) at(metrics, prim?.start ?? 0, 'needs a "## Primary metric" table with one row');
    else {
      const col = (n) => prim.header.findIndex((h) => h.toLowerCase() === n);
      for (const need of ['baseline', 'target', 'window']) {
        const c = col(need);
        const v = c === -1 ? '' : prim.rows[0].cells[c] ?? '';
        if (!v) at(metrics, prim.rows[0].line, `primary metric needs a ${need}`);
      }
    }
    for (const t of ['Primary metric', 'Guardrails', 'Leading indicators']) for (const r of table(t)?.rows ?? []) if (r.cells[0]) metricNames.add(r.cells[0].replace(/`/g, ''));
    const ev = table('Event inventory');
    if (!ev || !ev.rows.length) at(metrics, ev?.start ?? 0, 'needs an "## Event inventory" table');
    else {
      const piiCol = ev.header.findIndex((h) => h.toLowerCase() === 'pii');
      const feedsCol = ev.header.findIndex((h) => /feeds metric/i.test(h));
      for (const r of ev.rows) {
        const name = r.cells[0].replace(/`/g, '');
        if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) at(metrics, r.line, `event "${name}" must be snake_case object_action`);
        if (piiCol === -1 || !r.cells[piiCol]) at(metrics, r.line, `event "${name}" needs a PII value ("none" if none)`);
        const feeds = feedsCol === -1 ? '' : r.cells[feedsCol];
        // one or more metric names separated by ";" — each may carry a "(note)"; "none" (+ optional note) for audit-only events
        const parts = feeds.replace(/`/g, '').split(';').map((x) => x.replace(/\s*\([^)]*\)\s*$/, '').trim()).filter(Boolean);
        if (!parts.length) at(metrics, r.line, `event "${name}" needs a "Feeds metric" value: one or more metric names separated by ";", or "none" for audit-only events`);
        else if (parts.length === 1 && /^none$/i.test(parts[0])) { /* audit-only event */ }
        else for (const m of parts) if (!metricNames.has(m)) at(metrics, r.line, `event "${name}" feeds "${m}", which isn't a metric in this file (separate several with ";")`);
      }
    }
  }
  return { problems, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dir = path.resolve(args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'docs');
  const { problems, warnings } = check(dir);
  warnings.forEach((w) => console.log(`warning: ${w}`));
  problems.forEach((p) => console.log(`✗ ${p}`));
  console.log(problems.length ? `${problems.length} problem(s) in the PM documents` : '✓ PM documents pass');
  process.exit(problems.length ? 1 : 0);
}
