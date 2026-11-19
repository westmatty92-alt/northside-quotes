#!/usr/bin/env node
// render-mockups — turns design/mockups/SCR-*.html into screenshots for Matthew and the designer.
//
//   node scripts/render-mockups.mjs [repoDir]
//
// 1. Regenerates design/mockups/tokens.css from src/app/theme.css (@theme → :root, so a browser can load it).
// 2. Renders every mockup at 390 px (mobile) and 1280 px (desktop), and at 800 px (embed) for screens whose
//    inventory Access mentions "embed". Full page. Nothing loads from the network (all requests outside
//    the repo are blocked), so a screenshot shows only what the mockup itself declares.
// 3. Writes docs/design/screens/<file stem>-<width>.png, where the stem drops the screen-name slug:
//    SCR-02-board.html → SCR-02-mobile.png · SCR-02-board--empty.html → SCR-02--empty-mobile.png
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tokensCss } from './check-design.mjs';
import { loadPlaywright, launch, WIDTHS } from './lib/playwright.mjs';

export function screenshotStem(file) {
  const m = file.match(/^(SCR-\d{2,3})(?:-[^.]*?)?(--[a-z0-9-]+)?\.html$/);
  return m ? `${m[1]}${m[2] ?? ''}` : null;
}

export function embedScreens(dir) {
  const p = path.join(dir, 'docs/user-flows.md');
  if (!fs.existsSync(p)) return new Set();
  const out = new Set();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\|\s*(SCR-\d{2,3})\s*\|/);
    if (m && /\bembed\b/i.test(l.split('|')[5] ?? '')) out.add(m[1]);
  }
  return out;
}

async function main() {
  const dir = path.resolve(process.argv[2] ?? '.');
  const themePath = path.join(dir, 'src/app/theme.css');
  const mockDir = path.join(dir, 'design/mockups');
  if (!fs.existsSync(themePath)) throw new Error('src/app/theme.css missing — export DESIGN.md first (ux-brand §3)');
  fs.mkdirSync(mockDir, { recursive: true });
  fs.writeFileSync(path.join(mockDir, 'tokens.css'), tokensCss(fs.readFileSync(themePath, 'utf8')));

  const files = fs.readdirSync(mockDir).filter((f) => screenshotStem(f));
  if (!files.length) { console.log('no design/mockups/SCR-*.html yet — tokens.css regenerated'); return; }
  const embeds = embedScreens(dir);
  const outDir = path.join(dir, 'docs/design/screens');
  fs.mkdirSync(outDir, { recursive: true });

  const { chromium } = await loadPlaywright(dir);
  const browser = await launch(chromium);
  const blocked = [];
  try {
    for (const f of files) {
      const stem = screenshotStem(f);
      const widths = ['mobile', 'desktop', ...(embeds.has(stem.match(/^SCR-\d+/)[0]) ? ['embed'] : [])];
      for (const w of widths) {
        const page = await browser.newPage({ viewport: { width: WIDTHS[w], height: 900 }, deviceScaleFactor: 1 });
        await page.route('**/*', (route) => {
          const u = route.request().url();
          if (u.startsWith('file://')) return route.continue();
          blocked.push(`${f}: ${u}`);
          return route.abort();
        });
        await page.goto(pathToFileURL(path.join(mockDir, f)).href, { waitUntil: 'load' });
        await page.screenshot({ path: path.join(outDir, `${stem}-${w}.png`), fullPage: true });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`rendered ${files.length} mockup(s) → docs/design/screens/`);
  if (blocked.length) {
    console.log(`blocked ${blocked.length} network request(s) — mockups must be self-contained:\n  ${blocked.join('\n  ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`render-mockups: ${e.message}`); process.exit(1); });
}
