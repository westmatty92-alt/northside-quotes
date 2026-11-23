// @vitest-environment node
// The helper that stops db.test.ts from ever skipping: loads the staging env from .env.local when the process lacks
// it, and reports what is missing by NAME only. Fake values and a temp file only: no real env file, no network.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  envFileCandidates,
  GUARD_ENV,
  loadStagingEnv,
  mainCheckoutRoot,
  missingStagingEnv,
  REQUIRED_STAGING_ENV,
  stagingEnvProblem,
} from './staging-env';

const FAKE_URL = 'https://fakeref123.supabase.co';
const FAKE_KEY = 'fake-service-role-value-do-not-print';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'int1-env-'));
  for (const name of [...REQUIRED_STAGING_ENV, ...GUARD_ENV]) vi.stubEnv(name, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.INT1_EXTRA_KEY;
  rmSync(dir, { recursive: true, force: true });
});

function envFile(lines: string[]): string {
  const file = join(dir, '.env.local');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

describe('staging-env helper', () => {
  it('names what is missing, and treats an empty value as missing', () => {
    expect(missingStagingEnv({})).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    expect(missingStagingEnv({ NEXT_PUBLIC_SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: '' })).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
    expect(missingStagingEnv({ NEXT_PUBLIC_SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY })).toEqual([]);
  });

  it('a missing variable is a problem (so the suite fails), and the message holds names only, never values', () => {
    const none = stagingEnvProblem({});
    expect(none).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(none).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(none).toContain('fail rather than skip');

    const half = stagingEnvProblem({ NEXT_PUBLIC_SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(half).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(half).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(half).not.toContain(FAKE_URL);

    const guarded = stagingEnvProblem({ NEXT_PUBLIC_SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, SUPABASE_PROD_PROJECT_REF: 'fakeref123' });
    expect(guarded).toBeDefined();
    for (const message of [none, half, guarded]) {
      expect(message).not.toContain(FAKE_KEY);
      expect(message).not.toContain('fakeref123');
    }
  });

  it('refuses a production URL and a URL that is not the staging project; accepts a configured staging URL', () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY };
    expect(stagingEnvProblem(base)).toBeUndefined();
    expect(stagingEnvProblem({ ...base, SUPABASE_STAGING_REF: 'fakeref123' })).toBeUndefined();
    expect(stagingEnvProblem({ ...base, SUPABASE_STAGING_REF: 'someotherref' })).toContain('SUPABASE_STAGING_REF');
    expect(stagingEnvProblem({ ...base, SUPABASE_PROD_PROJECT_REF: 'fakeref123' })).toContain('SUPABASE_PROD_PROJECT_REF');
    expect(stagingEnvProblem({ ...base, SUPABASE_PROD_PROJECT_REF: 'differentprod' })).toBeUndefined();
  });

  it('loads the missing names from an env file, keeps only the allow-listed keys, and never prints a value', () => {
    const file = envFile([`NEXT_PUBLIC_SUPABASE_URL=${FAKE_URL}`, `SUPABASE_SERVICE_ROLE_KEY=${FAKE_KEY}`, 'INT1_EXTRA_KEY=should-not-survive']);
    expect(loadStagingEnv([file])).toEqual([]);
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe(FAKE_URL);
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe(FAKE_KEY);
    expect(process.env.INT1_EXTRA_KEY).toBeUndefined(); // the file cannot leak other settings into the worker
    expect(stagingEnvProblem()).toBeUndefined();
  });

  it('never overwrites a value the process already has, and fills only what is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://already-set.supabase.co');
    const file = envFile([`NEXT_PUBLIC_SUPABASE_URL=${FAKE_URL}`, `SUPABASE_SERVICE_ROLE_KEY=${FAKE_KEY}`]);
    expect(loadStagingEnv([file])).toEqual([]);
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://already-set.supabase.co');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe(FAKE_KEY);
  });

  it('an empty value in the process is filled from the file', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', FAKE_URL);
    const file = envFile([`SUPABASE_SERVICE_ROLE_KEY=${FAKE_KEY}`]);
    expect(loadStagingEnv([file])).toEqual([]);
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe(FAKE_KEY);
  });

  it('still missing after the files: the names come back, so the suite fails instead of skipping', () => {
    expect(loadStagingEnv([join(dir, 'does-not-exist')])).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    const partial = envFile([`NEXT_PUBLIC_SUPABASE_URL=${FAKE_URL}`, 'INT1_EXTRA_KEY=x']);
    expect(loadStagingEnv([partial])).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
    expect(process.env.INT1_EXTRA_KEY).toBeUndefined();
    expect(stagingEnvProblem()).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('a later file fills what an earlier one lacks (this checkout, then the main checkout)', () => {
    const first = join(dir, 'first.env');
    const second = join(dir, 'second.env');
    writeFileSync(first, `NEXT_PUBLIC_SUPABASE_URL=${FAKE_URL}\n`);
    writeFileSync(second, `SUPABASE_SERVICE_ROLE_KEY=${FAKE_KEY}\n`);
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
