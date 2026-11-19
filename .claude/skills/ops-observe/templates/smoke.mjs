#!/usr/bin/env node
// scripts/smoke.mjs: TEMPLATE (owned by bl-devops). Read-only smoke check after a deploy.
// Usage: node scripts/smoke.mjs <base-url> [expected-commit-sha]
// Reads smokePaths from infra/environments.json. Sends the Vercel bypass header if VERCEL_AUTOMATION_BYPASS_SECRET is set (staging).
import fs from 'node:fs';

const [base, expectedSha] = process.argv.slice(2);
if (!base) { console.error('usage: smoke.mjs <base-url> [expected-sha]'); process.exit(2); }
const manifest = fs.existsSync('infra/environments.json') ? JSON.parse(fs.readFileSync('infra/environments.json', 'utf8')) : {};
const paths = manifest.smokePaths ?? ['/', '/api/health'];
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function health() {
  const deadline = Date.now() + 120_000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(new URL('/api/health', base), { headers, signal: AbortSignal.timeout(10_000) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.status === 'ok' && (!expectedSha || String(body.version ?? '').startsWith(expectedSha.slice(0, 7)))) return { ok: true, detail: `ok, version ${body.version}` };
      last = `${res.status} ${JSON.stringify(body).slice(0, 120)}`;
    } catch (e) { last = e.message; }
    await sleep(5_000);
  }
  return { ok: false, detail: last };
}

const results = [];
const h = await health();
results.push({ path: '/api/health', ...h });
for (const p of paths.filter((x) => x !== '/api/health')) {
  try {
    const res = await fetch(new URL(p, base), { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    results.push({ path: p, ok: res.status === 200, detail: String(res.status) });
  } catch (e) { results.push({ path: p, ok: false, detail: e.message }); }
}
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.path} — ${r.detail}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
