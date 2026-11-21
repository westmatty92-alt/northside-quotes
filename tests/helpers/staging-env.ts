// tests/helpers/staging-env.ts: makes the staging-backed API tests independent of how vitest was launched, and makes them
// FAIL (never skip) when the staging variables are missing. Modelled on INT1's tests/integrations/staging-env.ts.
//
// A lane worktree has no .env.local, so when a required variable is absent from the process it is loaded, with
// `process.loadEnvFile()`, from the first `.env.local` that has it: this checkout, then the main checkout, which is found
// with `git rev-parse --git-common-dir` (the directory that holds the shared .git). If git cannot say, the known path of
// the rehearsal's main checkout is the last candidate.
//
// Values are never printed, logged or returned: messages carry variable NAMES only. Only the allow-listed names are kept
// from an env file; every other key a loaded file adds to `process.env` is removed again.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** What the staging-backed tests read: the project URL, its publishable key, its service-role key, and the direct database URL (cleanup only). */
export const REQUIRED_STAGING_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STAGING_DB_URL',
] as const;

/** Optional guards (the same names supabase/scripts/db.mjs reads): require the staging ref, refuse production. */
export const GUARD_ENV = ['SUPABASE_STAGING_REF', 'SUPABASE_PROD_PROJECT_REF', 'SUPABASE_PRODUCTION_REF', 'SUPABASE_PRODUCTION_DB_URL'] as const;

const KEPT_FROM_FILE: readonly string[] = [...REQUIRED_STAGING_ENV, ...GUARD_ENV];

/** The rehearsal's main checkout, used only when git cannot find it. */
const KNOWN_MAIN_CHECKOUT = '/home/admin/baseleap/rehearsal/northside-quotes';

type Env = Record<string, string | undefined>;

/** The required names that are absent or empty. Names only. */
export function missingStagingEnv(env: Env = process.env): string[] {
  return REQUIRED_STAGING_ENV.filter((name) => !env[name]);
}

/** The root of the main checkout (the directory holding the shared .git), or undefined when git cannot say. */
export function mainCheckoutRoot(cwd: string = process.cwd()): string | undefined {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return common ? dirname(resolve(cwd, common)) : undefined;
  } catch {
    return undefined;
  }
}

/** Where `.env.local` may live: this checkout, the main checkout (from git, else the known path). */
export function envFileCandidates(cwd: string = process.cwd()): string[] {
  const roots = [cwd, mainCheckoutRoot(cwd) ?? KNOWN_MAIN_CHECKOUT];
  return [...new Set(roots.map((root) => resolve(root, '.env.local')))];
}

/**
 * Fills in the missing required variables from the first env file that has them. Existing values are never overwritten
 * (loadEnvFile keeps them); an empty value counts as missing. Returns the names still missing afterwards.
 */
export function loadStagingEnv(files: readonly string[] = envFileCandidates()): string[] {
  if (missingStagingEnv().length === 0) return [];
  for (const name of REQUIRED_STAGING_ENV) if (process.env[name] === '') delete process.env[name];
  for (const file of files) {
    if (missingStagingEnv().length === 0) break;
    if (!existsSync(file)) continue;
    const before = new Set(Object.keys(process.env));
    try {
      process.loadEnvFile(file);
    } catch {
      continue; // unreadable or malformed: the same as no file
    }
    for (const key of Object.keys(process.env)) {
      if (!before.has(key) && !KEPT_FROM_FILE.includes(key)) delete process.env[key];
    }
  }
  return missingStagingEnv();
}

/**
 * Why the staging database must not be used, or undefined when it is fine. Messages carry names only.
 * The URLs must never name the production project: these tests create and delete rows.
 */
export function stagingEnvProblem(env: Env = process.env): string | undefined {
  const missing = missingStagingEnv(env);
  if (missing.length > 0) {
    return `The staging-backed API tests need ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} missing or empty in the process and in .env.local (this checkout and the main checkout). They fail rather than skip: set them (names only in .env.example) and run again.`;
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const dbUrl = env.SUPABASE_STAGING_DB_URL ?? '';
  for (const prodRef of [env.SUPABASE_PROD_PROJECT_REF, env.SUPABASE_PRODUCTION_REF]) {
    if (prodRef && (url.includes(prodRef) || dbUrl.includes(prodRef))) {
      return 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_STAGING_DB_URL names the production project. These tests create and delete rows and run against staging only.';
    }
  }
  if (env.SUPABASE_PRODUCTION_DB_URL && dbUrl === env.SUPABASE_PRODUCTION_DB_URL) {
    return 'SUPABASE_STAGING_DB_URL equals SUPABASE_PRODUCTION_DB_URL. These tests run against staging only.';
  }
  const stagingRef = env.SUPABASE_STAGING_REF;
  if (stagingRef && !url.includes(stagingRef)) {
    return 'NEXT_PUBLIC_SUPABASE_URL does not name the staging project (SUPABASE_STAGING_REF). These tests run against staging only.';
  }
  return undefined;
}
