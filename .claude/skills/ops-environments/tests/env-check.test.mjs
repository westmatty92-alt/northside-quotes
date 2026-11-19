// node --test .claude/skills/ops-environments/tests/  — unit tests for the env drift checker (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, readEnvExample, checkLocal, checkVercel } from '../templates/env-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, '../templates/environments.json'), 'utf8'));

function repo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'envchk-'));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.join(d, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); }
  return d;
}
const example = manifest.variables.map((v) => `${v.name}=`).join('\n');
const goodRows = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', target: ['production', 'preview'], gitBranch: null, type: 'plain' },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', target: ['production', 'preview'], gitBranch: null, type: 'plain' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', target: ['production', 'preview'], gitBranch: null, type: 'sensitive' },
  { key: 'NEXT_PUBLIC_API_MOCKING', target: ['preview'], gitBranch: 'lane/frontend', type: 'plain' },
  { key: 'STRIPE_SECRET_KEY', target: ['production', 'preview'], gitBranch: null, type: 'sensitive' },
  { key: 'STRIPE_WEBHOOK_SECRET', target: ['production', 'preview'], gitBranch: null, type: 'sensitive' },
  { key: 'GHL_PRIVATE_INTEGRATION_TOKEN', target: ['production', 'preview'], gitBranch: null, type: 'sensitive' },
  { key: 'CRON_SECRET', target: ['production'], gitBranch: null, type: 'sensitive' },
];

test('clean project passes local checks', () => {
  const d = repo({ 'src/lib/server/env.ts': 'export const k = process.env.STRIPE_SECRET_KEY; const n = process.env.NODE_ENV;', '.env.example': example });
  assert.deepEqual(checkLocal(manifest, scanSource(d), readEnvExample(d)), []);
});

test('undeclared variable, missing example entry and real value in example are caught', () => {
  const d = repo({ 'src/lib/server/x.ts': "const a = process.env['RESEND_API_KEY'];", '.env.example': example.replace('STRIPE_SECRET_KEY=', 'STRIPE_SECRET_KEY=sk_test_abc123').split('\n').filter((l) => !l.startsWith('CRON_SECRET=')).join('\n') });
  const errs = checkLocal(manifest, scanSource(d), readEnvExample(d)).join('\n');
  assert.match(errs, /undeclared: RESEND_API_KEY/);
  assert.match(errs, /example-value: .*STRIPE_SECRET_KEY/);
  assert.match(errs, /example-missing: CRON_SECRET/);
});

test('a secret-looking public variable is caught', () => {
  const m = { ...manifest, variables: [...manifest.variables, { name: 'NEXT_PUBLIC_STRIPE_SECRET_KEY', public: true, production: 'required', preview: 'required' }] };
  assert.match(checkLocal(m, new Set(), new Map(m.variables.map((v) => [v.name, '']))).join('\n'), /public-secret: NEXT_PUBLIC_STRIPE_SECRET_KEY/);
});

test('Vercel state matching the manifest passes', () => {
  assert.deepEqual(checkVercel(manifest, goodRows), []);
});

test('Vercel drift is reported: missing in production, mocking leaked to all previews, plain-text secret, undeclared extra', () => {
  const rows = goodRows
    .filter((r) => r.key !== 'STRIPE_WEBHOOK_SECRET')
    .concat([{ key: 'STRIPE_WEBHOOK_SECRET', target: ['preview'], gitBranch: null, type: 'sensitive' }])
    .map((r) => (r.key === 'GHL_PRIVATE_INTEGRATION_TOKEN' ? { ...r, type: 'plain' } : r))
    .concat([{ key: 'NEXT_PUBLIC_API_MOCKING', target: ['preview'], gitBranch: null, type: 'plain' }, { key: 'OLD_FEATURE_FLAG', target: ['production'], gitBranch: null, type: 'plain' }]);
  const errs = checkVercel(manifest, rows).join('\n');
  assert.match(errs, /missing: STRIPE_WEBHOOK_SECRET not set for production/);
  assert.match(errs, /must-be-absent: NEXT_PUBLIC_API_MOCKING is set for all preview/);
  assert.match(errs, /plain-secret: GHL_PRIVATE_INTEGRATION_TOKEN/);
  assert.match(errs, /undeclared-in-vercel: OLD_FEATURE_FLAG/);
});

test('service-role key must not be set specifically for the frontend lane', () => {
  const rows = goodRows.concat([{ key: 'SUPABASE_SERVICE_ROLE_KEY', target: ['preview'], gitBranch: 'lane/frontend', type: 'sensitive' }]);
  assert.match(checkVercel(manifest, rows).join('\n'), /must-be-absent: SUPABASE_SERVICE_ROLE_KEY is set for preview branch lane\/frontend/);
});
