#!/usr/bin/env node
// verify-ui — the frontend's repeatable visual proof (and the ledger re-runs it).
//
//   node scripts/verify-ui.mjs <base-url> SCR-03=/board SCR-03--empty=/board?state=empty \
//        [--step FE1] [--repo dir] [--click "SCR-03=button:has-text('Refresh')"] \
//        [--allow-request "/_vercel/insights"] [--allow-request "SCR-03--error=/api/board"]
//        [--header "x-vercel-protection-bypass: $BYPASS"] [--serve "npm run start -- -p 3201" --env NEXT_PUBLIC_API_MOCKING=on]
//
// For each screen (an id like SCR-03 or SCR-03--empty for a state) it opens the page at phone (390),
// desktop (1280) and, for embed screens in docs/user-flows.md, embed (800) widths; screenshots each;
// records console errors and failed requests on load and after an optional click; runs axe at phone
// width. Evidence goes to .baseleap/reports/<STEP>/ (screenshots + verify-ui.json).
// Exit 1 on any console error, failed request (≥ 400 or network error) not allowed by --allow-request,
// axe violation, or page that doesn't load.
//
// Evidence comes from the lane's Vercel preview in real builds (bl-frontend F3); dry runs may use a
// local `next start` build (F13). --header values given as $NAME are read from the environment.
// --allow-request "SCR-NN--state=<regex>" allows a failing request on that one screen only (an error state
// fails a request on purpose); without the SCR prefix it applies to every screen.
// --wait "SCR-03--loading=load" screenshots that screen once the page has loaded instead of waiting for the
// network to go quiet (a loading state never finishes on purpose).
// --serve "<command>" starts the app itself (with any --env NAME=value), waits for <base-url> to answer,
// runs, then stops it — so the whole check is one command the ledger can re-run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadPlaywright, launch, WIDTHS } from './lib/playwright.mjs';
import { embedScreens } from './render-mockups.mjs';

const ID = /^SCR-\d{2,3}(--[a-z0-9-]+)?$/;

export function parseArgs(argv, env = process.env) {
  const out = { base: null, screens: [], repo: '.', step: 'verify-ui', headers: {}, clicks: {}, allow: [], serve: null, env: {}, wait: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--repo') out.repo = next();
    else if (a === '--step') out.step = next();
    else if (a === '--allow-request') {
      const raw = next(); const m = raw.match(/^(SCR-\d{2,3}(?:--[a-z0-9-]+)?)=(.+)$/);
      out.allow.push(m ? { id: m[1], re: new RegExp(m[2]) } : { id: null, re: new RegExp(raw) });
    } else if (a === '--wait') {
      const raw = next(); const m = raw.match(/^(SCR-\d{2,3}(?:--[a-z0-9-]+)?)=(load|networkidle)$/);
      if (!m) throw new Error('--wait wants SCR-NN[--state]=load|networkidle');
      out.wait[m[1]] = m[2];
    } else if (a === '--serve') out.serve = next();
    else if (a === '--env') {
      const raw = next(); const eq = raw.indexOf('=');
      if (eq < 1 || !/^[A-Z_][A-Z0-9_]*$/.test(raw.slice(0, eq))) throw new Error('--env wants NAME=value');
      out.env[raw.slice(0, eq)] = raw.slice(eq + 1);
    }
    else if (a === '--header') {
      const [k, ...v] = next().split(':');
      out.headers[k.trim()] = v.join(':').trim().replace(/^\$(\w+)$/, (_, n) => env[n] ?? '');
    } else if (a === '--click') {
      const raw = next(); const eq = raw.indexOf('=');
      if (eq < 0) throw new Error('--click wants SCR-NN=<selector>');
      out.clicks[raw.slice(0, eq)] = raw.slice(eq + 1);
    } else if (a.includes('=') && ID.test(a.split('=')[0])) {
      const [id, ...route] = a.split('=');
      out.screens.push({ id, route: route.join('=') || '/' });
    } else if (!out.base) out.base = a.replace(/\/$/, '');
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!out.base || !/^https?:\/\//.test(out.base)) throw new Error('usage: verify-ui.mjs <base-url> SCR-01=/route …');
  if (!out.screens.length) throw new Error('name at least one screen: SCR-01=/route');
  if (!/^[\w.-]+$/.test(out.step)) throw new Error('--step must be a plain step id');
  return out;
}

/** The SCR-NN part of SCR-NN--state, used for the embed lookup. */
export const baseId = (id) => id.split('--')[0];

/**
 * Turns raw observations into problems. results: [{ id, width, status, console: [], failedRequests: [{url, status}], axe: [] }]
 */
export function evaluate(results, allow = []) {
  const problems = [];
  for (const r of results) {
    const where = `${r.id} @ ${r.width}`;
    if (!r.status || r.status >= 400) problems.push(`${where}: page didn't load (${r.status || 'no response'})`);
    for (const c of r.console ?? []) problems.push(`${where}: console error: ${c.slice(0, 200)}`);
    for (const f of r.failedRequests ?? []) {
      if (allow.some((a) => (a instanceof RegExp ? a : a.re).test(f.url) && (a instanceof RegExp || !a.id || a.id === r.id))) continue;
      problems.push(`${where}: request failed: ${f.status || 'network'} ${f.url}`);
    }
    for (const v of r.axe ?? []) problems.push(`${where}: axe ${v.impact ?? ''} ${v.id}: ${v.help} (${v.nodes} node${v.nodes === 1 ? '' : 's'})${v.where?.length ? ` at ${v.where.map((w) => `${w.target}${w.detail ? ` — ${w.detail}` : ''}`).join('; ')}` : ''}`.replace(/\s+/g, ' '));
  }
  return problems;
}

async function observe(browser, { url, width, headers, click, withAxe, AxeBuilder, shot, waitUntil = 'networkidle' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: headers });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  // Chrome also logs every ≥ 400 response as "Failed to load resource"; those are counted once, as failed requests.
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource:/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`uncaught: ${e.message}`));
  page.on('requestfailed', (req) => failedRequests.push({ url: req.url(), status: 0, error: req.failure()?.errorText }));
  page.on('response', (res) => { if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() }); });
  let status = 0;
  try {
    const res = await page.goto(url, { waitUntil, timeout: 45_000 });
    if (waitUntil === 'load') await page.waitForTimeout(1500); // let the loading UI render
    status = res?.status() ?? 0;
    // the document's own error status is reported as "didn't load", not twice as a failed request
    const doc = res?.url();
    for (let i = failedRequests.length - 1; i >= 0; i--) if (failedRequests[i].url === doc) failedRequests.splice(i, 1);
    if (click) {
      await page.locator(click).first().click({ timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    }
  } catch (e) {
    consoleErrors.push(`verify-ui: ${e.message.split('\n')[0]}`);
  }
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  let axe = [];
  if (withAxe && status && status < 400) {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    axe = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
      where: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), detail: (n.any[0]?.message ?? n.failureSummary ?? '').slice(0, 200) })) }));
  }
  await ctx.close();
  return { status, console: consoleErrors, failedRequests, axe };
}

/** Starts the app with --serve and waits until base answers. Returns a stop function. */
export async function startServer(command, { cwd, env, base, timeoutMs = 60_000, fetchFn = fetch, spawnFn = spawn }) {
  const child = spawnFn('sh', ['-c', command], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout?.on('data', (d) => { log += d; });
  child.stderr?.on('data', (d) => { log += d; });
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } } };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) { stop(); throw new Error(`--serve exited (${child.exitCode}): ${log.trim().slice(-400)}`); }
    try { await fetchFn(base, { redirect: 'manual' }); return stop; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`--serve: ${base} didn't answer within ${timeoutMs / 1000}s. ${log.trim().slice(-300)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(args.repo);
  const stopServer = args.serve ? await startServer(args.serve, { cwd: dir, env: args.env, base: args.base }) : () => {};
  try {
    const outDir = path.join(dir, '.baseleap/reports', args.step);
    fs.mkdirSync(outDir, { recursive: true });
    const embeds = embedScreens(dir);
    const { chromium, AxeBuilder } = await loadPlaywright(dir, { withAxe: true });
    const browser = await launch(chromium);
    const results = [];
    try {
      for (const { id, route } of args.screens) {
        const url = args.base + (route.startsWith('/') ? route : `/${route}`);
        const widths = ['mobile', 'desktop', ...(embeds.has(baseId(id)) ? ['embed'] : [])];
        for (const w of widths) {
          const shot = path.join(outDir, `${id}-${w}.png`);
          const r = await observe(browser, { url, width: WIDTHS[w], headers: args.headers, click: args.clicks[id] ?? args.clicks[baseId(id)], withAxe: w === 'mobile', AxeBuilder, shot, waitUntil: args.wait[id] ?? 'networkidle' });
          results.push({ id, width: w, url, screenshot: path.relative(dir, shot), ...r });
        }
      }
    } finally {
      await browser.close();
    }
    const problems = evaluate(results, args.allow);
    fs.writeFileSync(path.join(outDir, 'verify-ui.json'), JSON.stringify({ base: args.base, checked_at: new Date().toISOString(), ok: problems.length === 0, problems, results }, null, 2));
    console.log(`verify-ui: ${results.length} view(s) of ${args.screens.length} screen(s) → .baseleap/reports/${args.step}/`);
    if (problems.length) { console.log(problems.map((p) => `  ${p}`).join('\n')); process.exitCode = 1; }
    else console.log('verify-ui: OK — no console errors, failed requests or axe violations');
  } finally {
    stopServer();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`verify-ui: ${e.message}`); process.exit(1); });
}
