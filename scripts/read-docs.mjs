#!/usr/bin/env node
// Reads a JavaScript-rendered documentation page (e.g. a Redoc/Swagger API reference) in headless
// Chromium and saves its visible text, so bl-integration can cite official docs that a plain page
// fetch returns empty. Docs only: http(s) URLs, no cookies, no sign-in, nothing submitted.
//
//   node scripts/read-docs.mjs <url> [--out .baseleap/docs/<name>.txt] [--wait 4000]
//
// Prints the text (or writes it to --out) with a header naming the URL and the time it was read.
import fs from 'node:fs';
import path from 'node:path';
import { loadPlaywright, launch } from './lib/playwright.mjs';

export function parseArgs(argv) {
  const opts = { url: null, out: null, wait: 4000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--wait') opts.wait = Number(argv[++i]);
    else if (!opts.url) opts.url = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!opts.url || !/^https?:\/\//i.test(opts.url)) throw new Error('usage: read-docs.mjs <http(s) url> [--out file] [--wait ms]');
  if (!Number.isFinite(opts.wait) || opts.wait < 0 || opts.wait > 60000) throw new Error('--wait must be 0–60000 ms');
  if (opts.out && !path.normalize(opts.out).startsWith(path.join('.baseleap', 'docs'))) throw new Error('--out must be under .baseleap/docs/');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const { chromium } = await loadPlaywright(root);
  const browser = await launch(chromium);
  try {
    const page = await (await browser.newContext({ javaScriptEnabled: true })).newPage();
    const res = await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 60000 });
    if (opts.wait) await page.waitForTimeout(opts.wait);
    const text = (await page.evaluate(() => document.body?.innerText ?? '')).replace(/\n{3,}/g, '\n\n').trim();
    const header = `SOURCE: ${opts.url}\nHTTP: ${res?.status() ?? 'n/a'}\nREAD: ${new Date().toISOString()}\nCHARS: ${text.length}\n\n`;
    if (opts.out) {
      fs.mkdirSync(path.dirname(opts.out), { recursive: true });
      fs.writeFileSync(opts.out, header + text + '\n');
      process.stdout.write(`${header}wrote ${opts.out}\n`);
    } else process.stdout.write(header + text + '\n');
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
