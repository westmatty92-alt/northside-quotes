// tests/integrations/staging-env.ts: makes the staging-database tests independent of how vitest was launched.
//
// Why this exists (INT1 pass 2): db.test.ts used to skip itself when NEXT_PUBLIC_SUPABASE_URL or
// SUPABASE_SERVICE_ROLE_KEY was missing from `process.env`. A skip is not evidence, so now the variables are
//   1. taken from the process when present,
//   2. otherwise loaded from `.env.local` (this checkout first, then the main checkout found with
//      `git rev-parse --git-common-dir`, which is where a worktree's env file lives) with `process.loadEnvFile()`,
//   3. and when they are still missing the suite FAILS, naming the missing variables. Nothing here skips.
//
// Values are never printed, logged or returned: only variable names appear in messages. Only the allow-listed
// names are kept from an env file; every other key the file adds to `process.env` is removed again, so a
// loaded file cannot leak (for example) GHL settings into other test files in the same worker.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';

/** What db.test.ts reads (through getAdminClient): the staging project URL and its service-role key. */
export const REQUIRED_STAGING_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

/** Optional guards (the same names supabase/scripts/db.mjs reads): require the staging ref, refuse production. */
export const GUARD_ENV = ['SUPABASE_STAGING_REF', 'SUPABASE_PROD_PROJECT_REF'] as const;

const KEPT_FROM_FILE: readonly string[] = [...REQUIRED_STAGING_ENV, ...GUARD_ENV];

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

/** Where `.env.local` may live: this checkout, then the main checkout when this is a worktree. */
export function envFileCandidates(cwd: string = process.cwd()): string[] {
  const roots = [cwd, mainCheckoutRoot(cwd)].filter((root): root is string => Boolean(root));
  return [...new Set(roots.map((root) => resolve(root, '.env.local')))];
}

/** What the last loadStagingEnv() saw, as names and states only (never values), for the failure message. */
let lastReport: string[] = [];

/** For each required name: absent, empty or set in this env file. States only. */
function describeFile(file: string): string {
  if (!existsSync(file)) return 'no such file';
  try {
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    const states = REQUIRED_STAGING_ENV.map((name) => `${name} ${parsed[name] === undefined ? 'absent' : parsed[name] === '' ? 'EMPTY' : 'set'}`);
    // every name the file defines (names and set/EMPTY only), so a misnamed variable is visible
    const defined = Object.keys(parsed)
      .sort()
      .map((name) => `${name}${parsed[name] === '' ? '=EMPTY' : ''}`);
    return `found, ${states.join(', ')}; the file defines: ${defined.length > 0 ? defined.join(' ') : 'nothing'}`;
  } catch {
    return 'found but unreadable';
  }
}

/**
 * Fills in the missing required variables from the first env file that has them. Existing values are never
 * overwritten (loadEnvFile keeps them). Empty values count as missing, so they are cleared before loading.
 * Returns the names still missing afterwards.
 */
export function loadStagingEnv(files: readonly string[] = envFileCandidates()): string[] {
  lastReport = [];
  if (missingStagingEnv().length === 0) return [];
  for (const name of REQUIRED_STAGING_ENV) if (process.env[name] === '') delete process.env[name];
  files.forEach((file, index) => {
    lastReport.push(`env file ${index + 1} of ${files.length} (${basename(dirname(file))}/.env.local): ${describeFile(file)}`);
    if (missingStagingEnv().length === 0 || !existsSync(file)) return;
    const before = new Set(Object.keys(process.env));
    try {
      process.loadEnvFile(file);
    } catch {
      return; // an unreadable or malformed file is the same as no file: the names stay missing and the suite fails
    }
    for (const key of Object.keys(process.env)) {
      if (!before.has(key) && !KEPT_FROM_FILE.includes(key)) delete process.env[key];
    }
  });
  return missingStagingEnv();
}

/**
 * Why the staging database must not be used, or undefined when it is fine. The messages carry names only.
 * Guards: the URL must name the staging ref when SUPABASE_STAGING_REF is set, and must never name the production
 * ref when SUPABASE_PROD_PROJECT_REF is set (these tests create and delete rows).
 */
export function stagingEnvProblem(env: Env = process.env): string | undefined {
  const missing = missingStagingEnv(env);
  if (missing.length > 0) {
    const seen = env === process.env && lastReport.length > 0 ?` Seen: ${lastReport.join('; ')}.` : '';
    return `The staging database tests need ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} missing or empty in the process and in .env.local (this checkout and the main checkout). They fail rather than skip: set them (names only in .env.example) and run again.${seen}`;
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const prodRef = env.SUPABASE_PROD_PROJECT_REF;
  if (prodRef && url.includes(prodRef)) {
    return 'NEXT_PUBLIC_SUPABASE_URL names the production project (SUPABASE_PROD_PROJECT_REF). These tests create and delete rows and run against staging only.';
  }
  const stagingRef = env.SUPABASE_STAGING_REF;
  if (stagingRef && !url.includes(stagingRef)) {
    return 'NEXT_PUBLIC_SUPABASE_URL does not name the staging project (SUPABASE_STAGING_REF). These tests run against staging only.';
  }
  return undefined;
}
