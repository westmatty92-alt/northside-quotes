// Environment and the staging-only guard. Names only: no value is ever printed or written.
import path from 'node:path';

/** The preview the brief expects. A different host is still allowed when it is a staging preview, but is reported. */
export const EXPECTED_STAGING_HOST = 'northside-quotes-git-staging-baseleap.vercel.app';

/** A Vercel preview of the `staging` branch looks like <project>-git-staging-<team>.vercel.app. */
const STAGING_PREVIEW_HOST = /^[a-z0-9][a-z0-9-]*-git-staging-[a-z0-9-]+\.vercel\.app$/;

let loaded = false;

/** Load .env.local without overriding variables that are already set (the ledger passes it with --env-file). */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    process.loadEnvFile(path.resolve(__dirname, '../../../.env.local'));
  } catch {
    // No .env.local (for example in CI): the variables must already be in the environment.
  }
}

export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (set it in .env.local or the environment; its value is never printed).`);
  return value;
}

/** Throws unless STAGING_URL is the staging preview. Never a local server, never production. */
export function stagingUrl(): URL {
  const raw = requireEnv('STAGING_URL');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('STAGING_URL is not a valid URL.');
  }
  const production = (process.env.PRODUCTION_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  if (url.protocol !== 'https:') throw new Error(`Refusing to run: STAGING_URL must be https (got ${url.protocol}). Tests never run locally.`);
  if (production.includes(url.host)) throw new Error(`Refusing to run against production (${url.host}).`);
  if (!STAGING_PREVIEW_HOST.test(url.host)) {
    throw new Error(`Refusing to run: ${url.host} is not a staging preview host (expected <project>-git-staging-<team>.vercel.app).`);
  }
  return url;
}

export function stagingHost(): string {
  return stagingUrl().host;
}

export function bypassSecret(): string | undefined {
  loadEnv();
  return process.env.VERCEL_AUTOMATION_BYPASS_SECRET || undefined;
}

/** Headers for the Vercel deployment-protection bypass. Only ever attached to requests for the preview host. */
export function bypassHeaders(): Record<string, string> {
  const secret = bypassSecret();
  return secret ? { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' } : {};
}

export type Role = 'owner' | 'helper';

export function credentials(role: Role): { email: string; password: string } {
  const key = role.toUpperCase();
  return { email: requireEnv(`QA_${key}_EMAIL`), password: requireEnv(`QA_${key}_PASSWORD`) };
}

/** Signed-in storage states live in a git-ignored folder (playwright/.cache is ignored by .gitignore). */
export const AUTH_DIR = path.resolve(__dirname, '../../../playwright/.cache/auth');
export function statePath(role: Role): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

/** One id per run, used in every tagged test record. */
export function runId(): string {
  loadEnv();
  if (!process.env.QA_E2E_RUN_ID) {
    process.env.QA_E2E_RUN_ID = Date.now().toString(36).slice(-5);
  }
  return process.env.QA_E2E_RUN_ID;
}
