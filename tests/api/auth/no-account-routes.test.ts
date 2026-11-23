// @vitest-environment node
// FR-27, AC-004.6, AC-004.10, SECURITY_MODEL invariant 21: no sign-up, password change or password reset path exists in the
// app: no page, no /api route, no code that calls the Supabase Auth operations that would make one. Offline: it reads the
// source tree and the contract, so it needs no environment.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The URL path each page or route file under src/app serves: route groups `(x)` are not part of it. */
function servedPath(file: string): string {
  const parts = relative(join(ROOT, 'src/app'), file).split(sep);
  parts.pop(); // page.tsx / route.ts
  return `/${parts.filter((p) => !/^\(.*\)$/.test(p)).join('/')}`;
}

const appFiles = walk(join(ROOT, 'src/app')).filter((f) => /\/(page|route|layout)\.(tsx?|jsx?)$/.test(f.split(sep).join('/')));
const served = appFiles.filter((f) => /\/(page|route)\.(tsx?|jsx?)$/.test(f.split(sep).join('/'))).map(servedPath);

/** Words that would name an account-creation, password or recovery path. */
const FORBIDDEN_PATH = /sign-?up|register|create-?account|new-?account|password|passwd|reset|recover|forgot|magic|otp|invite|change-?email|verify|confirm/i;

describe('no page or route can create an account or change or reset a password', () => {
  it('finds the app routes (the scan is not empty)', () => {
    expect(served).toContain('/api/auth/sign-in');
    expect(served).toContain('/api/staff/me');
    expect(served).toContain('/sign-in');
    expect(served.length).toBeGreaterThan(8);
  });

  it('no page or route path names sign-up, registration, a password, a reset, recovery, a magic link or an invitation', () => {
    expect(served.filter((p) => FORBIDDEN_PATH.test(p))).toEqual([]);
  });

  it('/api/auth holds exactly one route, sign-in', () => {
    expect(served.filter((p) => p.startsWith('/api/auth')).sort()).toEqual(['/api/auth/sign-in']);
  });

  it('there is no /inbox route (the tabs are /requests and /pipeline)', () => {
    expect(served.filter((p) => p.startsWith('/inbox'))).toEqual([]);
  });

  it('the contract has no operation for any of it either', () => {
    const paths = [...readFileSync(join(ROOT, 'docs/openapi.yaml'), 'utf8').matchAll(/^ {2}(\/[^\s:]*):\s*$/gm)].map((m) => m[1] ?? '');
    expect(paths.length).toBeGreaterThan(8);
    expect(paths.filter((p) => FORBIDDEN_PATH.test(p))).toEqual([]);
  });
});

describe('no application code calls a Supabase Auth operation that creates an account, sets a password or sends an email', () => {
  const sources = walk(join(ROOT, 'src'))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(`${sep}generated${sep}`) && !f.endsWith('database.ts'))
    .map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

  const FORBIDDEN_CALLS = [
    /\.signUp\s*\(/,
    /\.resetPasswordForEmail\b/,
    /\.updateUser\s*\(/,
    /\.signInWithOtp\s*\(/,
    /\.verifyOtp\s*\(/,
    /\.resend\s*\(/,
    /\.signInWithOAuth\s*\(/,
    /\.signInWithSSO\s*\(/,
    /auth\.admin\.(createUser|updateUserById|inviteUserByEmail|generateLink)/,
  ];

  it('scans the application source', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN_CALLS.map((re) => [re.source, re] as const))('nothing calls %s', (_name, re) => {
    expect(sources.filter((s) => re.test(s.text)).map((s) => s.file)).toEqual([]);
  });

  it('the only Auth sign-in in the server code is the password sign-in of src/lib/server/auth/sign-in.ts', () => {
    const using = sources
      .filter((s) => s.file.startsWith(`src${sep}lib${sep}server${sep}`) || s.file.startsWith(`src${sep}app${sep}api${sep}`))
      .filter((s) => /\.signInWith[A-Za-z]*\s*\(/.test(s.text))
      .map((s) => s.file.split(sep).join('/'));
    expect(using).toEqual(['src/lib/server/auth/sign-in.ts']);
  });
});
