// Waits (up to QA_WAIT_MS, default 10 minutes) until the staging preview's /api/health version starts with the
// expected commit. Prints status codes and the version only. No secret. Run:
//   QA_EXPECTED_SHA=0dff609 node tests/e2e/support/wait-for-build.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../.env.local'));
} catch {
  // variables may already be in the environment
}

const expected = process.env.QA_EXPECTED_SHA ?? '';
const waitMs = Number(process.env.QA_WAIT_MS ?? 600_000);
const base = new URL(process.env.STAGING_URL ?? 'invalid:');
if (!expected) {
  console.error('QA_EXPECTED_SHA is required.');
  process.exit(2);
}
if (base.protocol !== 'https:' || !/-git-staging-[a-z0-9-]+\.vercel\.app$/.test(base.host)) {
  console.error(`Refusing: ${base.host} is not a staging preview host.`);
  process.exit(2);
}
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
  : {};

const started = Date.now();
let tries = 0;
for (;;) {
  tries += 1;
  let version = '-';
  let status = 0;
  try {
    const res = await fetch(new URL('/api/health', base), { headers, redirect: 'manual' });
    status = res.status;
    const body = await res.json().catch(() => ({}));
    version = String(body.version ?? '-');
  } catch (e) {
    version = `fetch failed: ${e instanceof Error ? e.message : 'error'}`;
  }
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`try ${tries} at ${secs}s: /api/health -> ${status} version=${version.slice(0, 12)}`);
  if (version.startsWith(expected)) {
    const root = await fetch(new URL('/', base), { headers, redirect: 'manual' });
    console.log(`GET / -> ${root.status} x-vercel-id=${root.headers.get('x-vercel-id') ?? '-'}`);
    process.exit(root.status === 200 ? 0 : 1);
  }
  if (Date.now() - started > waitMs) {
    console.log(`NOT LANDED: still ${version.slice(0, 12)} after ${secs}s`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 20_000));
}
