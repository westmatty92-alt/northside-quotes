// Preflight for a QA run: is the staging preview healthy enough to start? Prints status codes, the health
// version and Vercel request ids only. No secret, no body beyond the health JSON. Run: node tests/e2e/support/preflight.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../.env.local'));
} catch {
  // variables may already be in the environment
}

const base = new URL(process.env.STAGING_URL ?? 'invalid:');
if (base.protocol !== 'https:' || !/-git-staging-[a-z0-9-]+\.vercel\.app$/.test(base.host)) {
  console.error(`Refusing: ${base.host} is not a staging preview host.`);
  process.exit(2);
}
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
  : {};

console.log(`target ${base.origin}`);
let exit = 0;
for (const p of ['/api/health', '/', '/sign-in']) {
  const res = await fetch(new URL(p, base), { headers, redirect: 'manual' });
  const text = await res.text();
  const extra = p === '/api/health' ? ` body=${text.slice(0, 300)}` : '';
  console.log(`GET ${p} -> ${res.status} cache-control=${res.headers.get('cache-control') ?? '-'} x-vercel-id=${res.headers.get('x-vercel-id') ?? '-'}${extra}`);
  if (res.status !== 200) exit = 1;
}
process.exit(exit);
