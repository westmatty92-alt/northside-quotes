// Loads Playwright for the render scripts. The designer runs before the architect's scaffold
// exists (no package.json yet), so Playwright is installed once into .baseleap/tools/ (git-ignored),
// not into the project. A project that already has Playwright uses its own copy.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TOOLS_PKGS = { playwright: 'playwright@1', '@axe-core/playwright': '@axe-core/playwright@4' };

function tryRequire(from, name) {
  try { return createRequire(from).resolve(name); } catch { return null; }
}

export async function loadPlaywright(root, { withAxe = false } = {}) {
  const toolsDir = path.join(root, '.baseleap', 'tools');
  const want = withAxe ? ['playwright', '@axe-core/playwright'] : ['playwright'];
  // Each package on its own: the project's (or a global) copy first, then .baseleap/tools.
  // Only what's missing gets installed, so an existing Playwright and its browser are reused.
  const resolveOne = (n) => tryRequire(path.join(root, 'package.json'), n) ?? tryRequire(path.join(toolsDir, 'package.json'), n);
  let found = want.map(resolveOne);
  const missing = want.filter((_, i) => !found[i]);
  if (missing.length) {
    fs.mkdirSync(toolsDir, { recursive: true });
    if (!fs.existsSync(path.join(toolsDir, 'package.json'))) fs.writeFileSync(path.join(toolsDir, 'package.json'), '{ "private": true }\n');
    process.stderr.write(`Installing ${missing.join(', ')} into .baseleap/tools (one time)…\n`);
    const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent', ...missing.map((n) => TOOLS_PKGS[n])], { cwd: toolsDir, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('could not install into .baseleap/tools — check network access to the npm registry');
    found = want.map(resolveOne);
  }
  const [pw, axe] = await Promise.all(found.map((p) => import(pathToFileURL(p).href)));
  const AxeBuilder = axe ? (axe.AxeBuilder ?? axe.default?.AxeBuilder ?? axe.default?.default ?? axe.default) : null;
  const chromium = pw.chromium ?? pw.default?.chromium;
  // the CLI of the same Playwright copy, so the browser it installs matches
  chromium.__cli = path.join(path.dirname(createRequire(found[0]).resolve('playwright/package.json')), 'cli.js');
  return { chromium, AxeBuilder };
}

export async function launch(chromium) {
  try {
    return await chromium.launch();
  } catch (e) {
    if (!/Executable doesn't exist|playwright install/i.test(e.message) || !chromium.__cli) throw e;
    // first run with this Playwright version: fetch its matching Chromium once, then retry
    process.stderr.write('Installing Chromium for Playwright (one time)…\n');
    const r = spawnSync(process.execPath, [chromium.__cli, 'install', 'chromium'], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('could not install Chromium — run: npx playwright install chromium');
    return chromium.launch();
  }
}

/** Mobile, desktop, and GHL-embed widths used by every design screenshot. */
export const WIDTHS = { mobile: 390, desktop: 1280, embed: 800 };
