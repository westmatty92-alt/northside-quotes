#!/usr/bin/env node
// export-brand — regenerates every file derived from DESIGN.md, in one approvable command:
//   src/app/theme.css          (Tailwind v4 @theme, what the app imports)
//   docs/tokens.json           (W3C design tokens)
//   design/mockups/tokens.css  (theme.css as :root, what mockups load in a browser)
//
//   node scripts/export-brand.mjs [repoDir]
//
// Writing them with shell redirects (npx … > file) needs a separate approval for every file,
// so the designer runs this instead. Never hand-edit the outputs; check-design compares them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { npxExport, tokensCss } from './check-design.mjs';

export function exportBrand(dir, exporter = npxExport) {
  if (!fs.existsSync(path.join(dir, 'DESIGN.md'))) throw new Error('DESIGN.md missing — the brand contract comes first (ux-brand)');
  const theme = exporter(dir, 'css-tailwind');
  const tokens = exporter(dir, 'dtcg');
  const out = {
    'src/app/theme.css': theme,
    'docs/tokens.json': tokens,
    'design/mockups/tokens.css': tokensCss(theme),
  };
  for (const [rel, text] of Object.entries(out)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return Object.keys(out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const files = exportBrand(path.resolve(process.argv[2] ?? '.'));
    console.log(`exported: ${files.join(', ')}`);
  } catch (e) { console.error(`export-brand: ${e.message}`); process.exit(1); }
}
