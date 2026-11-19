#!/usr/bin/env node
// osv-gate.mjs: TEMPLATE (bl-devops / bl-security). Judges an osv-scanner JSON report:
// BLOCK on Critical/High in packages that ship; dev-only findings are warnings unless Critical.
// Dev vs shipped comes from OSV's own dependency_groups (no hard-coded package names). Verified on GitHub's runner, Nov 2026.
// Usage: node scripts/osv-gate.mjs <osv.json>   (exit 1 = blocking finding)
import { readFileSync, appendFileSync } from 'node:fs';
const rank = { LOW: 1, MEDIUM: 2, MODERATE: 2, HIGH: 3, CRITICAL: 4 };
const names = ['', 'Low', 'Medium', 'High', 'Critical'];
const fromScore = (s) => (s >= 9 ? 4 : s >= 7 ? 3 : s >= 4 ? 2 : s > 0 ? 1 : 0);
const cmp = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const doc = JSON.parse(readFileSync(process.argv[2] ?? process.env.OSV_JSON, 'utf8'));
const rows = [];
for (const res of doc.results ?? []) {
  for (const pkg of res.packages ?? []) {
    // Only an explicit, exclusive "dev" group counts as dev. Anything else is treated as shipped.
    const groups = pkg.dependency_groups ?? [];
    const dev = groups.length > 0 && groups.every((g) => g === 'dev');
    for (const g of pkg.groups ?? []) {
      const vulns = (pkg.vulnerabilities ?? []).filter((v) => g.ids.includes(v.id));
      // Worst of the CVSS score and the advisory's own label; unknown severity is treated as High.
      let sev = fromScore(parseFloat(g.max_severity));
      for (const v of vulns) sev = Math.max(sev, rank[String(v.database_specific?.severity ?? '').toUpperCase()] ?? 0);
      if (sev === 0) sev = 3;
      const fixed = new Set();
      for (const v of vulns)
        for (const a of v.affected ?? [])
          if (a.package?.name === pkg.package.name)
            for (const r of a.ranges ?? [])
              for (const e of r.events ?? []) if (e.fixed) fixed.add(e.fixed);
      rows.push({
        name: pkg.package.name, version: pkg.package.version, dev, sev,
        id: g.ids[0], fixed: [...fixed].sort(cmp).join(', ') || 'none known',
      });
    }
  }
}
const blocking = rows.filter((r) => (r.dev ? r.sev >= 4 : r.sev >= 3));
const warnings = rows.filter((r) => !blocking.includes(r));
const table = (list) =>
  ['| Package | Version | Severity | Advisory | Fixed in |', '|---|---|---|---|---|',
    ...list.sort((a, b) => b.sev - a.sev || a.name.localeCompare(b.name)).map(
      (r) => `| ${r.name}${r.dev ? ' (dev)' : ''} | ${r.version} | ${names[r.sev]} | ${r.id} | ${r.fixed} |`)].join('\n');
let md = '## OSV-Scanner\n\n';
md += blocking.length ? `### Blocking (${blocking.length})\n\n${table(blocking)}\n\n` : 'No blocking findings.\n\n';
if (warnings.length) md += `### Warnings, not blocking (${warnings.length})\n\n${table(warnings)}\n`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
else console.log(md);
for (const r of warnings.filter((x) => x.dev && x.sev >= 3))
  console.log(`::warning title=Dev-only vulnerability::${r.name}@${r.version} ${r.id} (${names[r.sev]}); fixed in ${r.fixed}`);
for (const r of blocking)
  console.log(`::error title=Blocking vulnerability::${r.name}@${r.version} ${r.id} (${names[r.sev]}${r.dev ? ', dev' : ', ships'}); fixed in ${r.fixed}`);
if (blocking.length) process.exit(1);
