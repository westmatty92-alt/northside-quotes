// @vitest-environment node
// src/lib/server/auth/known-paths.ts must list exactly the pages and routes under src/app: the proxy answers 404 for any path
// that is not on the list (BUG-QA2-1), so a page or route added without a line there would be a 404 in production. Offline:
// reads the source tree.
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES, PAGE_ROUTES, isApiPath, isFrameworkPath, isKnownApiPath, isKnownPagePath } from '@/lib/server/auth/known-paths';

const APP = join(process.cwd(), 'src/app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The address a page or route file serves, with `[id]` as `:id` and route groups `(x)` left out. */
function servedPath(file: string): string {
  const parts = relative(APP, file).split(sep);
  parts.pop();
  const segments = parts.filter((p) => !/^\(.*\)$/.test(p)).map((p) => p.replace(/^\[(.+)]$/, ':$1'));
  return `/${segments.join('/')}`;
}

const files = walk(APP).map((f) => f.split(sep).join('/'));
const servedPages = files.filter((f) => /\/page\.(tsx?|jsx?)$/.test(f)).map((f) => servedPath(f.split('/').join(sep)));
const servedRoutes = files.filter((f) => /\/route\.(tsx?|jsx?)$/.test(f)).map((f) => servedPath(f.split('/').join(sep)));

describe('the proxy\'s lists equal what src/app serves', () => {
  it('finds the pages and routes (the scan is not empty)', () => {
    expect(servedPages.length).toBeGreaterThan(5);
    expect(servedRoutes.length).toBeGreaterThan(10);
  });

  it('PAGE_ROUTES lists every page and nothing else', () => {
    expect([...PAGE_ROUTES].sort()).toEqual([...servedPages].sort());
  });

  it('API_ROUTES lists every route handler and nothing else', () => {
    expect([...API_ROUTES].sort()).toEqual([...servedRoutes].sort());
  });

  it('there is no catch-all page or route (the lists would not see it)', () => {
    expect(files.filter((f) => /\/\[\.\.\.[^\]]+]\//.test(f) || /\/\[\[\.\.\.[^\]]+]]\//.test(f))).toEqual([]);
  });

  it('no metadata route (sitemap, robots, manifest, icons) and no parallel-route default serves a path the lists do not know', () => {
    const odd = files.filter((f) => /\/(sitemap|robots|manifest|icon|apple-icon|opengraph-image|twitter-image)\.[a-z]+$/.test(f) || /\/default\.(tsx?|jsx?)$/.test(f));
    expect(odd).toEqual([]);
  });
});

describe('the matching', () => {
  const ID = '3d6f0a52-8b1e-4c7a-9f20-6e5d4c3b2a19';

  it.each(['/api/health', '/api/staff/me', '/api/auth/sign-in', `/api/quote-requests/${ID}`, `/api/quote-requests/${ID}/photos`])('%s is a known route', (path) => {
    expect(isApiPath(path)).toBe(true);
    expect(isKnownApiPath(path)).toBe(true);
  });

  it.each([
    '/api',
    '/api/',
    '/api/health/extra',
    '/api/auth',
    '/api/auth/sign-in/extra',
    '/api/password',
    '/api/quote-requests/',
    `/api/quote-requests/${ID}/photos/extra`,
    `/api/quote-requests/${ID}/nothing`,
    '/api/quote-requests//photos',
    '/api/Health',
  ])('%s is not a known route', (path) => {
    expect(isKnownApiPath(path)).toBe(false);
  });

  it('only /api and what is below it is an API path', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/apix')).toBe(false);
    expect(isApiPath('/API/health')).toBe(false);
    expect(isApiPath('/requests/api')).toBe(false);
  });

  it.each(['/', '/sign-in', '/request-sent', '/requests', '/pipeline', `/requests/${ID}`, `/pipeline/${ID}`, '/requests/not-an-id'])('%s is a known page', (path) => {
    expect(isKnownPagePath(path)).toBe(true);
  });

  it.each(['/forgot-password', '/reset-password', '/inbox', '/sign-up', '/requests/a/b', '/sign-in/x', '/Requests', '/requests//'])('%s is not a known page', (path) => {
    expect(isKnownPagePath(path)).toBe(false);
  });

  it('the framework\'s own addresses are recognised', () => {
    expect(isFrameworkPath('/_next/data/x.json')).toBe(true);
    expect(isFrameworkPath('/__nextjs_original-stack-frames')).toBe(true);
    expect(isFrameworkPath('/_nextish')).toBe(false);
    expect(isFrameworkPath('/reset-password')).toBe(false);
  });
});
