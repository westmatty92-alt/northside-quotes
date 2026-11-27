// src/lib/server/auth/known-paths.ts: every path the app serves, for src/proxy.ts (QA2 BUG-QA2-1, AC-004.10, FR-27).
//
// The proxy answers a path that is not here with a 404 of its own, before the hosting platform's router is asked. That router
// answered 200 with the app's HTML for POST, PUT and DELETE, and for a GET carrying an Authorization header, on a path no
// route serves, including password and reset paths that must not exist.
//
// The lists are written by hand, because the proxy cannot read the file tree once deployed. tests/unit/proxy/known-paths.test.ts
// compares them with src/app on every run, so adding a page or a route without adding it here fails the test instead of
// answering 404 in production. No server-only import and no secrets: pure functions.

/** `:name` is one path segment (an id). A method that a route does not list is still answered by the route itself (405). */
export const API_ROUTES = [
  '/api/auth/sign-in',
  '/api/health',
  '/api/jobs/ghl-sync',
  '/api/jobs/housekeeping',
  '/api/quote-requests',
  '/api/quote-requests/:request_id',
  '/api/quote-requests/:request_id/ghl-copy-retries',
  '/api/quote-requests/:request_id/photos',
  '/api/quote-requests/:request_id/quote',
  '/api/quote-requests/:request_id/status-changes',
  '/api/quote-requests/:request_id/submission',
  '/api/staff/me',
  '/api/weekly-counts/current',
] as const;

/** The pages (route groups such as `(public)` are not part of an address). */
export const PAGE_ROUTES = ['/', '/sign-in', '/request-sent', '/requests', '/requests/:request_id', '/pipeline', '/pipeline/:request_id'] as const;

/** A route pattern as a matcher: `:name` becomes one non-empty segment. */
function matcherFor(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/:[A-Za-z_]+/g, '[^/]+')}$`);
}

const API_MATCHERS = API_ROUTES.map(matcherFor);
const PAGE_MATCHERS = PAGE_ROUTES.map(matcherFor);

/** A path under /api (the prefix itself included). The path is taken as received, case-sensitive, like Next.js routing. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** Does a route handler exist for this /api path? (Any method: the handler answers a method it does not list with 405.) */
export function isKnownApiPath(pathname: string): boolean {
  return API_MATCHERS.some((matcher) => matcher.test(pathname));
}

/** Does a page exist at this path? */
export function isKnownPagePath(pathname: string): boolean {
  return PAGE_MATCHERS.some((matcher) => matcher.test(pathname));
}

/** Next.js's own addresses (assets, the development server's hot reload and error overlay): never answered by the app's 404. */
export function isFrameworkPath(pathname: string): boolean {
  return pathname.startsWith('/_next/') || pathname.startsWith('/__nextjs');
}
