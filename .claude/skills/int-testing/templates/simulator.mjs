#!/usr/bin/env node
// tests/mocks/<provider>/simulator.mjs — TEMPLATE (bl-integration, int-testing, I12). No dependencies.
//   node tests/mocks/<provider>/simulator.mjs --port 4510 [--mode ok|slow|429|500|revoked|drift]
//   Mode can be changed per request with header x-sim-mode. Webhook sender: --send-webhook <url> [--times 3] [--secret whsec_…]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));
// route → fixture name (fill from the provider profile)
const ROUTES = { 'GET /things': 'things-list', 'GET /things/:id': 'thing' };

function match(method, url) {
  for (const [key, name] of Object.entries(ROUTES)) {
    const [m, pattern] = key.split(' ');
    const re = new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}$`);
    if (m === method && re.test(url.split('?')[0])) return name;
  }
  return null;
}

if (args['send-webhook']) {
  const secret = String(args.secret ?? 'whsec_' + Buffer.from('test-secret').toString('base64'));
  const body = JSON.stringify(fixture('webhook-event'));
  const id = `evt_${crypto.randomUUID()}`;
  for (let i = 0; i < Number(args.times ?? 1); i++) {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
    const res = await fetch(args['send-webhook'], { method: 'POST', headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` }, body });
    console.log(`delivery ${i + 1}: ${res.status}`);
  }
  process.exit(0);
}

http.createServer(async (req, res) => {
  const mode = req.headers['x-sim-mode'] ?? args.mode ?? 'ok';
  const name = match(req.method, req.url);
  const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
  if (!name) return send(404, { error: 'not found' });
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 15_000));
  if (mode === '429') return send(429, { error: 'rate limited' }, { 'retry-after': '2' });
  if (mode === '500') return send(500, { error: 'server error' });
  if (mode === 'revoked') return send(401, { error: 'invalid_token' });
  let body = fixture(name);
  if (mode === 'drift') body = JSON.parse(JSON.stringify(body).replace('"id"', '"identifier"'));
  send(200, body);
}).listen(Number(args.port ?? 4510), '127.0.0.1', () => console.log(`simulator on :${args.port ?? 4510} mode=${args.mode ?? 'ok'}`));
