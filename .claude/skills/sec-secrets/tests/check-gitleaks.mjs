#!/usr/bin/env node
// Tests the Baseleap Gitleaks config. Fake secrets are assembled at run time into a temp dir,
// so this repo never contains secret-shaped strings that scanners (or GitHub push protection) would flag.
// Usage: node check-gitleaks.mjs [gitleaks.toml]   (default: ../templates/gitleaks.toml)
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = path.resolve(process.argv[2] ?? path.join(here, '../templates/gitleaks.toml'));
const bin = process.env.GITLEAKS ?? 'gitleaks';
const rnd = (n) => crypto.randomBytes(n).toString('base64url').slice(0, n);
const hex = (n) => crypto.randomBytes(n).toString('hex').slice(0, n);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

const fakeJwt = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ role: 'service_role', iss: 'supabase', n: rnd(8) }), rnd(43)].join('.');
const cases = {
  'src/lib/server/a.ts': { text: `export const k = '${'sb_' + 'secret_' + rnd(32)}';\n`, expect: 'supabase-secret-key' },
  'src/lib/server/b.ts': { text: `const service_role_key = '${fakeJwt}';\n`, expect: 'supabase-service-role-assignment' },
  'src/lib/server/c.ts': { text: `const ghl = '${'pit' + '-' + [hex(8), hex(4), hex(4), hex(4), hex(12)].join('-')}';\n`, expect: 'ghl-private-integration-token' },
  'scripts/d.sh': { text: `DB=${'postgres' + 'ql://app_user:' + rnd(18) + '@db.example.internal:5432/app'}\n`, expect: 'postgres-connection-string-with-password' },
  '.env.example': { text: `SUPABASE_SECRET_KEY=${'sb_' + 'secret_'}your-key-here-placeholder\nSUPABASE_SERVICE_ROLE_KEY=\nGHL_TOKEN=\n`, expect: null },
  'src/lib/shared/ok.ts': { text: `export const pattern = 'sb_' + 'secret_';\n`, expect: null },
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-fixture-'));
for (const [f, c] of Object.entries(cases)) { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c.text); }
const report = path.join(dir, '..', `gl-report-${process.pid}.json`);
const r = spawnSync(bin, ['dir', dir, '--config', config, '--redact', '--no-banner', '--report-format', 'json', '--report-path', report], { encoding: 'utf8' });
if (![0, 1].includes(r.status)) { console.error(`gitleaks failed (${r.status}):\n${r.stderr}`); process.exit(1); }
const findings = JSON.parse(fs.readFileSync(report, 'utf8'));
fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(report, { force: true });

let ok = true;
for (const [f, c] of Object.entries(cases)) {
  const hits = findings.filter((x) => x.File.endsWith(f)).map((x) => x.RuleID);
  const pass = c.expect ? hits.includes(c.expect) : hits.length === 0;
  if (!pass) ok = false;
  console.log(`${pass ? 'ok      ' : 'FAIL    '} ${f.padEnd(24)} expected ${c.expect ?? 'nothing'} · got ${hits.join(', ') || 'nothing'}`);
}
if (findings.some((x) => x.Secret && x.Secret !== 'REDACTED')) { console.log('FAIL     secrets not redacted in report'); ok = false; }
process.exit(ok ? 0 : 1);
