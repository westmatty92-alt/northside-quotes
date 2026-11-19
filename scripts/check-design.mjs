#!/usr/bin/env node
// check-design — structural checker for bl-designer's design step. No dependencies.
//
//   node scripts/check-design.mjs [repoDir] [--skip-export]
//
// Exits 0 only when every check passes; prints each problem as file:line: message.
// It checks that the design set is complete and consistent, not whether it's beautiful —
// Matthew judges that from the screenshots at Gate 2.
//
// Checks:
//   brand      DESIGN.md exists; src/app/theme.css and docs/tokens.json equal a fresh export (no hand edits);
//              design/mockups/tokens.css equals theme.css with @theme unwrapped to :root
//   inventory  docs/user-flows.md has a screen inventory: unique SCR-NN ids, stories, access, data needs
//   coverage   every Must story in docs/user-stories.md is on a screen
//   specs      docs/design-specs.md has a section per screen (and no extras), each with a States table
//              holding empty / loading / error / success / disabled rows, each designed or "N/A — reason"
//   criteria   every [edge] and [error] AC id appears in a States table, the edge-path table, or
//              "## Criteria with no UI" with a reason
//   mockups    one design/mockups/SCR-NN-*.html per screen; screenshots per screen (mobile, desktop, embed
//              when Access says embed); no raw colours, undeclared fonts, network URLs or lorem
//   flows      every SCR id a flow mentions exists
//   conversion every "Conversion: yes" screen is named in the Conversion path section
//   placeholders  no template <placeholders> left outside code spans

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const STATES = ['empty', 'loading', 'error', 'success', 'disabled'];
const GENERIC_FONTS = ['system-ui', '-apple-system', 'blinkmacsystemfont', 'sans-serif', 'serif', 'monospace', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit', 'initial'];

/** Tailwind v4 export → plain CSS a browser can load: `@theme {` becomes `:root {`. */
export function tokensCss(themeCss) {
  return '/* Generated from src/app/theme.css by scripts/render-mockups.mjs — do not edit. */\n'
    + themeCss.replace(/@theme\s*(inline\s*)?\{/g, ':root {');
}

/** Default exporter: the design.md CLI (npx). Tests inject their own. */
export function npxExport(dir, format) {
  const r = spawnSync('npx', ['--yes', '@google/design.md', 'export', '--format', format, 'DESIGN.md'], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`design.md export --format ${format} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout;
}

const read = (dir, rel) => {
  const p = path.join(dir, rel);
  return fs.existsSync(p) ? { rel, lines: fs.readFileSync(p, 'utf8').split('\n') } : null;
};

/** Markdown tables under a heading: [{ header: [...], rows: [{ cells, line }] }] */
function tables(doc, startLine = 0, endLine = doc.lines.length) {
  const out = [];
  let cur = null;
  const cellsOf = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  for (let i = startLine; i < endLine; i++) {
    const l = doc.lines[i];
    if (/^\s*\|/.test(l)) {
      if (!cur) { cur = { header: cellsOf(l), rows: [], line: i }; continue; }
      if (/^\s*\|\s*:?-{2,}/.test(l)) continue;
      cur.rows.push({ cells: cellsOf(l), line: i });
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

function sectionRange(doc, re, level = 2) {
  const start = doc.lines.findIndex((l) => re.test(l));
  if (start === -1) return null;
  let end = doc.lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}} `).test(l));
  return { start, end: end === -1 ? doc.lines.length : end };
}

export function check(dir, { exporter = npxExport, skipExport = false } = {}) {
  const problems = [];
  const warnings = [];
  const at = (doc, line, msg) => problems.push(`${doc?.rel ?? doc}:${(line ?? 0) + 1}: ${msg}`);

  // ---------- brand ----------
  const design = read(dir, 'DESIGN.md');
  const fonts = new Set(GENERIC_FONTS);
  if (!design) at('DESIGN.md', 0, 'missing — the brand contract comes first (ux-brand)');
  else {
    for (const l of design.lines) { const m = l.match(/^\s*fontFamily:\s*["']?([^"'\n]+?)["']?\s*$/); if (m) fonts.add(m[1].trim().toLowerCase()); }
    const theme = read(dir, 'src/app/theme.css');
    if (!theme) at('src/app/theme.css', 0, 'missing — run node scripts/export-brand.mjs');
    const tokens = read(dir, 'docs/tokens.json');
    if (!tokens) at('docs/tokens.json', 0, 'missing — run node scripts/export-brand.mjs');
    if (!skipExport) {
      try {
        if (theme && exporter(dir, 'css-tailwind').trim() !== theme.lines.join('\n').trim()) at(theme, 0, 'differs from a fresh export of DESIGN.md — never hand-edit it; change DESIGN.md and run node scripts/export-brand.mjs');
        if (tokens && exporter(dir, 'dtcg').trim() !== tokens.lines.join('\n').trim()) at(tokens, 0, 'differs from a fresh export of DESIGN.md — run node scripts/export-brand.mjs');
      } catch (e) { at('DESIGN.md', 0, e.message); }
    }
    const tcss = read(dir, 'design/mockups/tokens.css');
    if (theme && (!tcss || tcss.lines.join('\n').trim() !== tokensCss(theme.lines.join('\n')).trim())) {
      at('design/mockups/tokens.css', 0, 'missing or stale — run node scripts/export-brand.mjs');
    }
  }

  // ---------- inventory ----------
  const flows = read(dir, 'docs/user-flows.md');
  const screens = new Map(); // SCR-NN → { stories, access, conversion, line }
  if (!flows) at('docs/user-flows.md', 0, 'missing — screen inventory, navigation and flows (ux-flows)');
  else {
    const inv = sectionRange(flows, /^## Screen inventory/);
    if (!inv) at(flows, 0, 'missing "## Screen inventory"');
    else {
      const t = tables(flows, inv.start, inv.end)[0];
      if (!t) at(flows, inv.start, 'screen inventory has no table');
      else {
        const col = (re) => t.header.findIndex((h) => re.test(h));
        const c = { id: col(/^id$/i), stories: col(/stories/i), access: col(/access/i), conv: col(/conversion/i), data: col(/data needs/i) };
        for (const [k, v] of Object.entries(c)) if (v === -1) at(flows, t.line, `screen inventory needs a "${{ id: 'ID', stories: 'Stories', access: 'Access', conv: 'Conversion', data: 'Data needs' }[k]}" column`);
        if (Object.values(c).every((v) => v !== -1)) {
          for (const r of t.rows) {
            const id = r.cells[c.id];
            if (!/^SCR-\d{2,3}$/.test(id)) { at(flows, r.line, `screen id "${id}" must look like SCR-01`); continue; }
            if (screens.has(id)) at(flows, r.line, `duplicate ${id}`);
            const stories = [...(r.cells[c.stories] ?? '').matchAll(/US-\d{3}/g)].map((m) => m[0]);
            if (!stories.length) at(flows, r.line, `${id} lists no stories (US-NNN)`);
            if (!r.cells[c.access]) at(flows, r.line, `${id} needs an Access value (public / signed-in / owner-only / embed …)`);
            if (!/^(yes|no)$/i.test(r.cells[c.conv] ?? '')) at(flows, r.line, `${id} Conversion must be yes or no`);
            if (!r.cells[c.data]) at(flows, r.line, `${id} needs its data needs, in plain words, for the architect`);
            screens.set(id, { stories, access: (r.cells[c.access] ?? '').toLowerCase(), conversion: /^yes$/i.test(r.cells[c.conv] ?? ''), line: r.line });
          }
          if (!screens.size) at(flows, t.line, 'screen inventory is empty');
        }
      }
    }
    // flows reference known screens
    flows.lines.forEach((l, i) => { for (const m of l.matchAll(/SCR-\d{2,3}/g)) if (screens.size && !screens.has(m[0])) at(flows, i, `${m[0]} isn't in the screen inventory`); });
  }

  // ---------- coverage ----------
  const stories = read(dir, 'docs/user-stories.md');
  const edgeErrorAcs = [];
  if (!stories) at('docs/user-stories.md', 0, 'missing — the designer works from the PM\'s stories');
  else {
    let cur = null;
    const onScreen = new Set([...screens.values()].flatMap((s) => s.stories));
    stories.lines.forEach((l, i) => {
      const h = l.match(/^### (US-\d{3})/); if (h) cur = { id: h[1], line: i };
      const p = l.match(/^Priority:\s*(Must|Should|Could)/i);
      if (p && cur && screens.size && !onScreen.has(cur.id)) {
        if (/must/i.test(p[1])) at(flows ?? 'docs/user-flows.md', 0, `Must story ${cur.id} isn't on any screen`);
        else warnings.push(`${p[1]} story ${cur.id} isn't on any screen (fine if it has no UI — say so in design-specs)`);
      }
      const ac = l.match(/\*\*(AC-\d{3}\.\d+)\*\*\s*\[(edge|error)\]/); if (ac) edgeErrorAcs.push(ac[1]);
    });
  }

  // ---------- specs ----------
  const specs = read(dir, 'docs/design-specs.md');
  const acsCovered = new Set();
  if (!specs) at('docs/design-specs.md', 0, 'missing — how each screen looks and behaves (ux-handoff)');
  else {
    const seen = new Set();
    specs.lines.forEach((l, i) => {
      const m = l.match(/^### (SCR-\d{2,3})\b/);
      if (!m) return;
      const id = m[1];
      seen.add(id);
      if (screens.size && !screens.has(id)) at(specs, i, `${id} has a spec but isn't in the screen inventory`);
      const range = sectionRange(specs, new RegExp(`^### ${id}\\b`), 3);
      const st = tables(specs, range.start, range.end).find((t) => /state/i.test(t.header[0] ?? ''));
      if (!st) { at(specs, i, `${id} has no States table`); return; }
      const acCol = st.header.findIndex((h) => /^ac$/i.test(h));
      const have = new Map(st.rows.map((r) => [r.cells[0].toLowerCase(), r]));
      for (const s of STATES) {
        const row = [...have.entries()].find(([k]) => k.startsWith(s))?.[1];
        if (!row) { at(specs, st.line, `${id} States table needs a "${s}" row (designed, or "N/A — reason")`); continue; }
        const design = row.cells[1] ?? '';
        if (!design) at(specs, row.line, `${id} "${s}" row is empty — design it or write "N/A — reason"`);
        else if (/^n\/a\b/i.test(design) && !/^n\/a\s*[—–-]\s*\S/i.test(design)) at(specs, row.line, `${id} "${s}" is N/A without a reason`);
      }
      for (const r of st.rows) for (const m2 of (r.cells[acCol] ?? r.cells.join(' ')).matchAll(/AC-\d{3}\.\d+/g)) acsCovered.add(m2[0]);
    });
    for (const id of screens.keys()) if (!seen.has(id)) at(specs, 0, `${id} is in the inventory but has no "### ${id} · …" section`);
    // criteria with no UI
    const noUi = sectionRange(specs, /^## Criteria with no UI/);
    if (noUi) for (const t of tables(specs, noUi.start, noUi.end)) for (const r of t.rows) {
      const ids = [...r.cells.join(' ').matchAll(/AC-\d{3}\.\d+/g)].map((m) => m[0]);
      if (ids.length && !(r.cells[1] ?? '').trim()) at(specs, r.line, `${ids.join(', ')} listed with no UI but no reason`);
      ids.forEach((x) => acsCovered.add(x));
    }
    // conversion
    const conv = sectionRange(specs, /^## Conversion path/);
    const convText = conv ? specs.lines.slice(conv.start, conv.end).join('\n') : '';
    for (const [id, s] of screens) if (s.conversion && !convText.includes(id)) at(specs, conv?.start ?? 0, `${id} is a conversion screen but isn't in "## Conversion path"`);
  }
  if (flows) {
    const edge = sectionRange(flows, /^## Edge paths/);
    if (edge) for (const l of flows.lines.slice(edge.start, edge.end)) for (const m of l.matchAll(/AC-\d{3}\.\d+/g)) acsCovered.add(m[0]);
  }
  for (const ac of edgeErrorAcs) if (!acsCovered.has(ac)) at(specs ?? 'docs/design-specs.md', 0, `${ac} ([edge]/[error]) has no designed state — add it to a States table, the edge-path table, or "## Criteria with no UI" with a reason`);

  // ---------- mockups + screenshots ----------
  const mockDir = path.join(dir, 'design/mockups');
  const mockups = fs.existsSync(mockDir) ? fs.readdirSync(mockDir).filter((f) => /^SCR-\d{2,3}.*\.html$/.test(f)) : [];
  const shotDir = path.join(dir, 'docs/design/screens');
  const shots = fs.existsSync(shotDir) ? new Set(fs.readdirSync(shotDir)) : new Set();
  for (const [id, s] of screens) {
    if (!mockups.some((f) => f.startsWith(`${id}-`) || f === `${id}.html`)) at('design/mockups', 0, `${id} has no mockup (design/mockups/${id}-<name>.html)`);
    const need = ['mobile', 'desktop', ...(s.access.includes('embed') ? ['embed'] : [])];
    for (const w of need) if (!shots.has(`${id}-${w}.png`)) at('docs/design/screens', 0, `${id}-${w}.png missing — run node scripts/render-mockups.mjs`);
  }
  // shared stylesheets next to the mockups follow the same rules (tokens.css is generated, so it's exempt)
  const sharedCss = fs.existsSync(mockDir) ? fs.readdirSync(mockDir).filter((f) => f.endsWith('.css') && f !== 'tokens.css') : [];
  for (const f of [...mockups, ...sharedCss]) {
    const rel = `design/mockups/${f}`;
    const raw = fs.readFileSync(path.join(mockDir, f), 'utf8');
    const blank = (c) => c.replace(/[^\n]/g, ' ');
    const lines = raw
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      // embedded images (data: URIs, e.g. inline SVG icons) load nothing; their xmlns isn't a request
      .replace(/data:[a-z]+\/[a-z0-9.+-]+[^"')\s]*/gi, blank)
      .replace(/\bxmlns(:\w+)?=["'][^"']*["']/gi, blank)
      .split('\n');
    const id = f.match(/^(SCR-\d{2,3})/)?.[1];
    if (id && screens.size && !screens.has(id)) at(rel, 0, `${id} isn't in the screen inventory`);
    lines.forEach((l, i) => {
      if (/#[0-9a-f]{3,8}\b(?![\w-])/i.test(l.replace(/href="#[^"]*"|id="[^"]*"|aria-[a-z]+="#[^"]*"/gi, ''))) at(rel, i, 'raw hex colour — use a DESIGN.md token (var(--color-…))');
      if (/\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/i.test(l)) at(rel, i, 'raw colour function — use a DESIGN.md token');
      if (/https?:\/\//i.test(l)) at(rel, i, 'network URL — mockups load nothing from the network');
      if (/\blorem\b|\bipsum\b/i.test(l)) at(rel, i, 'lorem ipsum — use realistic content from the PRD and research');
      for (const m of l.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
        // stop at the end of an inline style attribute: style="font-family: X">
        const list = m[1].replace(/"\s*\/?>[\s\S]*$/, '').replace(/"\s*$/, '');
        for (const fam of list.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').toLowerCase())) {
          if (!fam || fam.startsWith('var(')) continue;
          if (!fonts.has(fam)) at(rel, i, `font "${fam}" isn't declared in DESIGN.md`);
        }
      }
    });
  }

  // ---------- placeholders ----------
  for (const doc of [flows, specs].filter(Boolean)) {
    let inCode = false;
    doc.lines.forEach((l, i) => {
      if (/^```/.test(l.trim())) { inCode = !inCode; return; }
      if (inCode) return;
      const stripped = l.replace(/`[^`]*`/g, '').replace(/<!--.*?-->/g, '');
      if (/<[A-Za-z][^<>]{0,60}>/.test(stripped) && !/<(br|sup|sub|kbd|b|i|em|strong)\s*\/?>/i.test(stripped)) at(doc, i, 'leftover template placeholder <…>');
    });
  }

  return { problems, warnings, screens: [...screens.keys()] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.');
  const { problems, warnings, screens } = check(dir, { skipExport: args.includes('--skip-export') });
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const p of problems) console.log(p);
  console.log(problems.length ? `\n${problems.length} problem(s) in the design set.` : `design set OK: ${screens.length} screen(s).`);
  process.exit(problems.length ? 1 : 0);
}
