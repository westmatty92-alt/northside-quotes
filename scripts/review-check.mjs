#!/usr/bin/env node
// review-check.mjs: structural check of a bl-reviewer / bl-security verdict before it is handed in.
// The seeded-bug drill (Nov 18 2026) showed the template being skipped: an acceptance criterion the diff broke
// was filed as a Minor with "no AC could be assessed", and cross-lane duplicates went under Minor as "dead code".
// Errors (exit 1): missing Verdict line, Findings, Acceptance criteria (code review) or Checks (security),
// Coverage & limits, Cross-lane consolidation, Pre-existing sections; an Acceptance-criteria section that names no
// AC id and doesn't explain why none applies; a Minor that describes duplicated helpers/enums/types.
// Usage: node scripts/review-check.mjs <verdict.md> [--kind code|security]
import { readFileSync } from 'node:fs';

const has = (src, re) => re.test(src);
const section = (src, name) => src.match(new RegExp(`^##\\s+${name}[^\\n]*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi'))?.[1] ?? null;

export function checkReview(src, { kind = 'code' } = {}) {
  const errors = [];
  if (!has(src, /\*\*Verdict:\s*(APPROVED|BLOCKED)\b|^##\s*Verdict[\s\S]*?\b(APPROVED|BLOCKED)\b/mi)) errors.push('no verdict (APPROVED or BLOCKED)');
  if (section(src, 'Findings') === null) errors.push('no "## Findings" section');
  if (section(src, 'Coverage') === null) errors.push('no "## Coverage & limits" section');
  const consolidation = section(src, 'Cross-lane consolidation');
  if (consolidation === null) errors.push('no "## Cross-lane consolidation" section (write "None found" if none)');
  if (section(src, 'Pre-existing') === null) errors.push('no "## Pre-existing" section (write "None" if none)');
  if (kind === 'code') {
    const ac = section(src, 'Acceptance criteria');
    if (ac === null) errors.push('no "## Acceptance criteria" section');
    else if (!/\bAC-\d+(\.\d+)?\b/.test(ac) && !/no (acceptance criteria|AC) (is|are) (touched|affected) because/i.test(ac)) {
      errors.push('Acceptance criteria section names no AC id: list every AC whose behaviour the diff touches (met / not met / can\'t tell), or say "no AC is touched because …"');
    }
  } else if (section(src, 'Checks') === null && section(src, 'Acceptance criteria') === null) {
    errors.push('no "## Checks" section');
  }
  // An AC marked "not met" must point at a Critical finding (review-quality §1).
  const acSec = section(src, 'Acceptance criteria');
  if (kind === 'code' && acSec) {
    for (const line of acSec.split('\n').filter((l) => /\bnot met\b/i.test(l))) {
      for (const id of line.match(/\b(REV|SEC)-\d+\b/g) ?? []) {
        const head = src.match(new RegExp(`^###\\s+${id}\\b[^\\n]*`, 'm'))?.[0] ?? '';
        if (head && !/\bCritical\b/.test(head)) errors.push(`${id} backs an AC marked "not met" but isn't Critical: a broken acceptance criterion is Critical`);
      }
    }
  }
  const minor = section(src, 'Minor');
  if (minor && /\b(duplicat\w*|implemented twice|two (copies|versions)|same (helper|formatter|enum|type))\b/i.test(minor)) {
    errors.push('a duplicate is filed under Minor: duplicates across lanes go in "Cross-lane consolidation", routed to the architect');
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error('usage: review-check.mjs <verdict.md> [--kind code|security]'); process.exit(2); }
  const kind = process.argv.includes('--kind') ? process.argv[process.argv.indexOf('--kind') + 1] : 'code';
  const errors = checkReview(readFileSync(file, 'utf8'), { kind });
  for (const e of errors) console.log(`✗ ${file}: ${e}`);
  console.log(`review-check: ${errors.length} problem(s)`);
  process.exit(errors.length ? 1 : 0);
}
