#!/usr/bin/env node
// check-mock — proves the frontend can develop against the contract on day one.
//
//   node scripts/check-mock.mjs [repoDir] [--port 4010]
//
// Starts Prism on docs/openapi.yaml, calls the first GET operation that needs no path
// parameter (with a dummy bearer token, so secured operations answer), expects a 2xx JSON
// body, then stops Prism. Exit 0 = the mock serves the contract.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './lib/yaml-lite.mjs';

/** First GET with no path parameters, preferring non-health routes. Returns the path or null. */
export function pickGet(api) {
  const paths = Object.entries(api?.paths ?? {}).filter(([p, item]) => item?.get && !p.includes('{'));
  const real = paths.filter(([p]) => !/(^|\/)health\/?$/.test(p));
  return (real[0] ?? paths[0])?.[0] ?? null;
}

/** Base path from servers[0].url when it's a relative path (e.g. /api). */
export function basePath(api) {
  const u = api?.servers?.[0]?.url;
  return typeof u === 'string' && u.startsWith('/') ? u.replace(/\/$/, '') : '';
}

function startPrism(dir, port) {
  return spawn('npx', ['--yes', '@stoplight/prism-cli@5', 'mock', 'docs/openapi.yaml', '--port', String(port), '--host', '127.0.0.1'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
}

export async function checkMock(dir, { port = 4010, start = startPrism, fetchFn = fetch, timeoutMs = 90_000 } = {}) {
  const file = path.join(dir, 'docs/openapi.yaml');
  if (!fs.existsSync(file)) return { ok: false, message: 'docs/openapi.yaml missing' };
  const api = parseYaml(fs.readFileSync(file, 'utf8'));
  const route = pickGet(api);
  if (!route) return { ok: false, message: 'no GET operation without path parameters to call' };
  // Prism mounts paths as written (it ignores relative server URLs), so call the path itself.
  const url = `http://127.0.0.1:${port}${route}`;
  const child = start(dir, port);
  let log = '';
  child.stdout?.on('data', (d) => { log += d; });
  child.stderr?.on('data', (d) => { log += d; });
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } } };
  try {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      if (child.exitCode != null) return { ok: false, message: `Prism exited (${child.exitCode}): ${log.trim().slice(-400)}` };
      try {
        const r = await fetchFn(url, { headers: { Authorization: 'Bearer mock-check', Accept: 'application/json' } });
        const body = await r.text();
        if (r.status >= 200 && r.status < 300) {
          try { JSON.parse(body); } catch { return { ok: false, message: `GET ${route} → ${r.status} but the body isn't JSON` }; }
          return { ok: true, message: `GET ${route} → ${r.status} from the mock` };
        }
        last = `GET ${route} → ${r.status}: ${body.slice(0, 200)}`;
        if (r.status !== 404 && r.status < 500) return { ok: false, message: last };
      } catch (e) { last = e.message; }
      await new Promise((res) => setTimeout(res, 1000));
    }
    return { ok: false, message: `mock didn't answer in ${timeoutMs / 1000}s (${last}) ${log.trim().slice(-300)}` };
  } finally { stop(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--port');
  const port = pi >= 0 ? Number(args[pi + 1]) : 4010;
  const dir = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') ?? '.');
  const r = await checkMock(dir, { port });
  console.log(`check-mock: ${r.ok ? 'OK' : 'FAIL'} — ${r.message}`);
  process.exit(r.ok ? 0 : 1);
}
