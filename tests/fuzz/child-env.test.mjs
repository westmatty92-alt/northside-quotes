// Regression check for SEC-25: whatever the parent environment holds, the environment handed to Schemathesis has only
// the allow-listed names. Run with: node --test tests/fuzz/child-env.test.mjs (no network, no staging, no secrets:
// every value below is a placeholder).
import assert from 'node:assert/strict';
import test from 'node:test';
import { ALLOWED_PARENT_NAMES, BYPASS_NAME, buildChildEnv, offendingNames } from './child-env.mjs';

const parent = {
  PATH: '/usr/bin',
  HOME: '/home/someone',
  LANG: 'C.UTF-8',
  BASELEAP_LEDGER_SERVICE_KEY: 'placeholder',
  SUPABASE_STAGING_DB_URL: 'placeholder',
  SUPABASE_STAGING_SERVICE_ROLE_KEY: 'placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
  QA_OWNER_PASSWORD: 'placeholder',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'placeholder',
  STAGING_URL: 'https://example.invalid',
};

test('the child environment holds only allow-listed names and NO_COLOR', () => {
  const env = buildChildEnv(parent);
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'NO_COLOR', 'PATH']);
  for (const name of Object.keys(env)) assert.ok([...ALLOWED_PARENT_NAMES, 'NO_COLOR'].includes(name), name);
});

test('no credential name from the parent reaches the child', () => {
  const env = buildChildEnv(parent);
  assert.deepEqual(offendingNames(env), []);
  for (const name of Object.keys(parent)) {
    if (!ALLOWED_PARENT_NAMES.includes(name)) assert.equal(name in env, false, name);
  }
});

test('the guard names every credential-looking or unlisted name, and exempts only the bypass name', () => {
  assert.deepEqual(
    offendingNames({ PATH: 'x', BASELEAP_LEDGER_SERVICE_KEY: 'x', SUPABASE_STAGING_DB_URL: 'x', QA_OWNER_PASSWORD: 'x', STAGING_URL: 'x', [BYPASS_NAME]: 'x' }).sort(),
    ['BASELEAP_LEDGER_SERVICE_KEY', 'QA_OWNER_PASSWORD', 'STAGING_URL', 'SUPABASE_STAGING_DB_URL'],
  );
  assert.deepEqual(offendingNames({ SOME_SECRET_KEY: 'x', service_thing: 'x' }).sort(), ['SOME_SECRET_KEY', 'service_thing']);
});
