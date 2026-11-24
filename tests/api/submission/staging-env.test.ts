// @vitest-environment node
// tests/helpers/staging-env.ts: the loader that makes the staging-backed tests FAIL, never skip, when their variables are missing.
// Fake values and a temp file only: no real env file is read for values, no network. Messages must carry variable NAMES only.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUARD_ENV, REQUIRED_STAGING_ENV, envFileCandidates, loadStagingEnv, mainCheckoutRoot, missingStagingEnv, stagingEnvProblem } from '../../helpers/staging-env';

const FAKE = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://fakeref123.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon-value-do-not-print',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-value-do-not-print',
  SUPABASE_STAGING_DB_URL: 'postgresql://postgres.fakeref123:fake-password@aws-0-ca-central-1.pooler.supabase.com:5432/postgres',
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'be1-env-'));
  for (const name of [...REQUIRED_STAGING_ENV, ...GUARD_ENV]) vi.stubEnv(name, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.BE1_EXTRA_KEY;
  rmSync(dir, { recursive: true, force: true });
});

const envFile = (lines: string[], name = '.env.local') => {
  const file = join(dir, name);
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
};
const asLines = (values: Record<string, string>) => Object.entries(values).map(([k, v]) => `${k}=${v}`);

describe('staging-env helper', () => {
  it('requires the four staging names, and treats an empty value as missing', () => {
    expect(REQUIRED_STAGING_ENV).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STAGING_DB_URL']);
    expect(missingStagingEnv({})).toEqual([...REQUIRED_STAGING_ENV]);
    expect(missingStagingEnv({ ...FAKE, SUPABASE_SERVICE_ROLE_KEY: '' })).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
    expect(missingStagingEnv(FAKE)).toEqual([]);
  });

  it('a missing variable is a problem (so the file fails), and the message holds names only, never values', () => {
    const none = stagingEnvProblem({});
    for (const name of REQUIRED_STAGING_ENV) expect(none).toContain(name);
    expect(none).toContain('fail rather than skip');

    const half = stagingEnvProblem({ ...FAKE, SUPABASE_STAGING_DB_URL: undefined });
    expect(half).toContain('SUPABASE_STAGING_DB_URL');
    expect(half).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
    for (const value of Object.values(FAKE)) expect(half).not.toContain(value);
  });

  it('refuses a production URL or database URL, and a URL that is not the staging project; accepts a configured staging project', () => {
    expect(stagingEnvProblem(FAKE)).toBeUndefined();
    expect(stagingEnvProblem({ ...FAKE, SUPABASE_STAGING_REF: 'fakeref123' })).toBeUndefined();
    expect(stagingEnvProblem({ ...FAKE, SUPABASE_STAGING_REF: 'someotherref' })).toContain('SUPABASE_STAGING_REF');
    const prod = stagingEnvProblem({ ...FAKE, SUPABASE_PROD_PROJECT_REF: 'fakeref123' });
    expect(prod).toContain('production');
    expect(prod).not.toContain('fakeref123');
    expect(stagingEnvProblem({ ...FAKE, SUPABASE_PRODUCTION_REF: 'fakeref123' })).toContain('production');
    expect(stagingEnvProblem({ ...FAKE, SUPABASE_PRODUCTION_DB_URL: FAKE.SUPABASE_STAGING_DB_URL })).toContain('SUPABASE_PRODUCTION_DB_URL');
    expect(stagingEnvProblem({ ...FAKE, SUPABASE_PROD_PROJECT_REF: 'differentprod' })).toBeUndefined();
  });

  it('loads the missing names from an env file, keeps only the allow-listed keys, and never overwrites a value the process has', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://already-set.supabase.co');
    const file = envFile([...asLines(FAKE), 'BE1_EXTRA_KEY=should-not-survive']);
    expect(loadStagingEnv([file])).toEqual([]);
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://already-set.supabase.co');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe(FAKE.SUPABASE_SERVICE_ROLE_KEY);
    expect(process.env.BE1_EXTRA_KEY).toBeUndefined(); // a file cannot leak other settings into the worker
    expect(stagingEnvProblem()).toBeUndefined();
  });

  it('still missing after the files: the names come back, so the file fails instead of skipping', () => {
    expect(loadStagingEnv([join(dir, 'does-not-exist')])).toEqual([...REQUIRED_STAGING_ENV]);
    const partial = envFile([`NEXT_PUBLIC_SUPABASE_URL=${FAKE.NEXT_PUBLIC_SUPABASE_URL}`, 'BE1_EXTRA_KEY=x']);
    expect(loadStagingEnv([partial])).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STAGING_DB_URL']);
    expect(process.env.BE1_EXTRA_KEY).toBeUndefined();
    expect(stagingEnvProblem()).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('an empty value in the process is filled from the file, and a later file fills what an earlier one lacks', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const first = envFile(asLines({ NEXT_PUBLIC_SUPABASE_URL: FAKE.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE.NEXT_PUBLIC_SUPABASE_ANON_KEY }), 'first.env');
    const second = envFile(asLines({ SUPABASE_SERVICE_ROLE_KEY: FAKE.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STAGING_DB_URL: FAKE.SUPABASE_STAGING_DB_URL }), 'second.env');
    expect(loadStagingEnv([first, second])).toEqual([]);
  });

  it('finds the main checkout through git and lists its .env.local (existence only, never contents)', () => {
    const root = mainCheckoutRoot();
    expect(root).toBeDefined();
    expect(existsSync(join(root!, '.git'))).toBe(true);
    const candidates = envFileCandidates();
    expect(candidates).toContain(join(root!, '.env.local'));
    expect(candidates.every((c) => c.endsWith('.env.local'))).toBe(true);
  });
});
