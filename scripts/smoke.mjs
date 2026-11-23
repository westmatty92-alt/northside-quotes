#!/usr/bin/env node
// scripts/smoke.mjs (owned by bl-devops). Read-only smoke check of a deployed site.
//
//   node scripts/smoke.mjs <base-url> [expected-commit-sha] [--wait <seconds>]
//   node scripts/smoke.mjs --self-test
//
// Exit 0 only when GET /api/health answers 200 with {"status":"ok"} (and, when a commit is given, a `version` that starts
// with its first 7 characters) AND every other path in infra/environments.json "smokePaths" answers 200.
// --wait keeps retrying /api/health for that many seconds while a deployment settles (release.yml uses 120).
//
// Read-only by construction: GET requests only, no sign-in, no body, no test data, no third-party call. Redirects are not
// followed (a redirect to a login page is a failure, not a pass). If VERCEL_AUTOMATION_BYPASS_SECRET is set (staging only)
// it is sent as x-vercel-protection-bypass to the base URL and nowhere else; it is never printed.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkHealth({ base, expectedSha, headers, waitSeconds }) {
  const deadline = Date.now() + waitSeconds * 1000;
  let last = 'no response';
  for (;;) {
    try {
      const res = await fetch(new URL('/api/health', base), { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      const body = await res.json().catch(() => ({}));
      const versionOk = !expectedSha || String(body.version ?? '').startsWith(expectedSha.slice(0, 7));
      if (res.status === 200 && body.status === 'ok' && versionOk) return { ok: true, detail: `200 ok, version ${String(body.version ?? '?').slice(0, 7)}` };
      last = res.status === 200 && body.status === 'ok'
        ? `200 ok but version ${String(body.version ?? '?').slice(0, 7)}, expected ${expectedSha.slice(0, 7)}`
        : `${res.status} ${JSON.stringify(body).slice(0, 120)}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    if (Date.now() + 5_000 >= deadline) return { ok: false, detail: last };
    await sleep(5_000);
  }
}

export async function runSmoke({ base, expectedSha, paths, headers = {}, waitSeconds = 0 }) {
  const results = [{ path: '/api/health', ...(await checkHealth({ base, expectedSha, headers, waitSeconds })) }];
  for (const p of paths.filter((x) => x !== '/api/health')) {
    try {
      const res = await fetch(new URL(p, base), { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      results.push({ path: p, ok: res.status === 200, detail: String(res.status) });
    } catch (e) {
      results.push({ path: p, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

function smokePaths() {
  const file = fileURLToPath(new URL('../infra/environments.json', import.meta.url));
  if (!fs.existsSync(file)) return ['/api/health'];
  return JSON.parse(fs.readFileSync(file, 'utf8')).smokePaths ?? ['/api/health'];
}

async function selfTest() {
  const sha = 'abc1234def5678';
  const seen = { methods: new Set(), bypass: false };
  let healthStatus = 200;
  let healthVersion = sha;
  const server = http.createServer((req, res) => {
    seen.methods.add(req.method);
    if (req.headers['x-vercel-protection-bypass'] === 'fixture') seen.bypass = true;
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/api/health') return send(healthStatus, { status: healthStatus === 200 ? 'ok' : 'error', version: healthVersion });
    if (req.url === '/') return send(200, {});
    if (req.url === '/redirects') { res.writeHead(302, { location: '/sign-in' }); return res.end(); }
    return send(404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  const expect = (label, ok) => results.push({ label, ok });
  try {
    expect('health 200 and every path 200 passes', (await runSmoke({ base, paths: ['/api/health', '/'] })).ok);
    expect('the expected commit is accepted when health reports it', (await runSmoke({ base, expectedSha: sha, paths: ['/'] })).ok);
    expect('a different commit fails', !(await runSmoke({ base, expectedSha: 'fffffff0000000', paths: ['/'] })).ok);
    expect('a path that answers 404 fails', !(await runSmoke({ base, paths: ['/', '/missing'] })).ok);
    expect('a path that redirects fails (not followed)', !(await runSmoke({ base, paths: ['/redirects'] })).ok);
    healthStatus = 500;
    expect('health 500 fails even when every other path is 200', !(await runSmoke({ base, paths: ['/api/health', '/'] })).ok);
    healthStatus = 200;
    expect('the bypass header is sent when given', (await runSmoke({ base, paths: ['/'], headers: { 'x-vercel-protection-bypass': 'fixture' } })).ok && seen.bypass);
    expect('only GET requests were made (read-only)', [...seen.methods].every((m) => m === 'GET'));
  } finally {
    server.close();
  }
  expect('an unreachable address fails', !(await runSmoke({ base: 'http://127.0.0.1:9', paths: ['/'] })).ok);
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `self-test FAILED: ${failed} of ${results.length}` : `self-test passed: ${results.length} of ${results.length}`);
  return failed ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(await selfTest());
  const waitIdx = args.indexOf('--wait');
  const waitSeconds = waitIdx >= 0 ? Number(args[waitIdx + 1]) : 0;
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0) { console.error('--wait needs a number of seconds'); process.exit(2); }
  const positional = args.filter((a, i) => !a.startsWith('--') && !(waitIdx >= 0 && i === waitIdx + 1));
  const [base, expectedSha] = positional;
  if (!base || !/^https?:\/\//.test(base)) { console.error('usage: node scripts/smoke.mjs <https://base-url> [expected-commit-sha] [--wait <seconds>]'); process.exit(2); }
  if (expectedSha && !/^[0-9a-f]{7,40}$/.test(expectedSha)) { console.error('expected-commit-sha must be 7 to 40 lowercase hex characters'); process.exit(2); }
  const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
  const { ok, results } = await runSmoke({ base, expectedSha, paths: smokePaths(), headers, waitSeconds });
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.path} — ${r.detail}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`smoke: ${e instanceof Error ? e.message : e}`); process.exit(1); });
}
