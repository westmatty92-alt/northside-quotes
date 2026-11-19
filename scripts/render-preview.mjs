#!/usr/bin/env node
// render-preview — the designer's visual review of a built preview (after the build, before Gate 3).
//
//   node scripts/render-preview.mjs <base-url> SCR-01=/board SCR-03--owner=/board?scenario=owner [--repo dir] [--header "Name: value"]
//
// For each screen: screenshots at the same widths as the mockups (390 / 1280, plus 800 for embed screens)
// into docs/design/review/SCR-NN-<width>.png, and an axe-core accessibility scan saved as
// docs/design/review/SCR-NN-axe.json. Exits 1 if any page fails to load. Findings are the designer's job
// (ux-visual-review); this script only gathers the evidence. --header passes e.g. a Vercel protection
// bypass header; give the value through an environment variable, never inline in a plan.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, launch, WIDTHS } from './lib/playwright.mjs';
import { embedScreens } from './render-mockups.mjs';

export function parseArgs(argv) {
  const out = { base: null, routes: [], repo: '.', headers: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') out.repo = argv[++i];
    else if (a === '--header') { const [k, ...v] = argv[++i].split(':'); out.headers[k.trim()] = v.join(':').trim().replace(/^\$(\w+)$/, (_, n) => process.env[n] ?? ''); }
    else if (/^SCR-\d{2,3}(--[a-z0-9-]+)?=/.test(a)) { const eq = a.indexOf('='); out.routes.push({ id: a.slice(0, eq), route: a.slice(eq + 1) || '/' }); }
    else if (!out.base) out.base = a.replace(/\/$/, '');
  }
  if (!out.base || !/^https?:\/\//.test(out.base)) throw new Error('usage: render-preview.mjs <https://preview-url> SCR-01=/route …');
  if (!out.routes.length) throw new Error('name at least one screen: SCR-01=/route');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(args.repo);
  const outDir = path.join(dir, 'docs/design/review');
  fs.mkdirSync(outDir, { recursive: true });
  const embeds = embedScreens(dir);
  const { chromium, AxeBuilder } = await loadPlaywright(dir, { withAxe: true });
  const browser = await launch(chromium);
  const failed = [];
  try {
    for (const { id, route } of args.routes) {
      const url = args.base + (route.startsWith('/') ? route : `/${route}`);
      for (const w of ['mobile', 'desktop', ...(embeds.has(id.split('--')[0]) ? ['embed'] : [])]) {
        const ctx = await browser.newContext({ viewport: { width: WIDTHS[w], height: 900 }, extraHTTPHeaders: args.headers });
        const page = await ctx.newPage();
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        const res = await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => ({ status: () => 0, err: e.message }));
        if (!res || res.status() >= 400 || res.status() === 0) failed.push(`${id} ${w}: ${url} → ${res?.status?.() ?? 'no response'}`);
        await page.screenshot({ path: path.join(outDir, `${id}-${w}.png`), fullPage: true });
        if (w === 'mobile') {
          const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          fs.writeFileSync(path.join(outDir, `${id}-axe.json`), JSON.stringify({ url, violations: axe.violations, console_errors: errors }, null, 2));
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`reviewed ${args.routes.length} screen(s) → docs/design/review/`);
  if (failed.length) { console.log(`pages that didn't load:\n  ${failed.join('\n  ')}`); process.exitCode = 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`render-preview: ${e.message}`); process.exit(1); });
}
