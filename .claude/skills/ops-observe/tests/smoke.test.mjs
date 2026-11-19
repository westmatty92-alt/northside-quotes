// node --test .claude/skills/ops-observe/tests/  — smoke check against a local fake deployment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '../templates/smoke.mjs');

function server(routes) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const r = routes[req.url];
      if (!r) { res.writeHead(404); return res.end(); }
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body ?? {}));
    }).listen(0, '127.0.0.1', () => resolve(s));
  });
}
function run(base, sha, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, base, sha], { cwd });
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
fs.mkdirSync(path.join(cwd, 'infra'));
fs.writeFileSync(path.join(cwd, 'infra/environments.json'), JSON.stringify({ smokePaths: ['/', '/api/health', '/pricing'] }));

test('passes when health reports the expected version and paths return 200', async () => {
  const s = await server({ '/api/health': { status: 200, body: { status: 'ok', version: 'abc1234def' } }, '/': { status: 200 }, '/pricing': { status: 200 } });
  const r = await run(`http://127.0.0.1:${s.address().port}`, 'abc1234def', cwd); s.close();
  assert.equal(r.code, 0, r.out);
});

test('fails when a smoke path is not 200', async () => {
  const s = await server({ '/api/health': { status: 200, body: { status: 'ok', version: 'abc1234' } }, '/': { status: 200 }, '/pricing': { status: 500 } });
  const r = await run(`http://127.0.0.1:${s.address().port}`, 'abc1234', cwd); s.close();
  assert.equal(r.code, 1); assert.match(r.out, /✗ \/pricing — 500/);
});

test('fails (after retries) when the old version is still answering', { timeout: 200_000 }, async () => {
  const s = await server({ '/api/health': { status: 200, body: { status: 'ok', version: 'old0000' } }, '/': { status: 200 }, '/pricing': { status: 200 } });
  const r = await run(`http://127.0.0.1:${s.address().port}`, 'new1111', cwd); s.close();
  assert.equal(r.code, 1); assert.match(r.out, /✗ \/api\/health/);
});
