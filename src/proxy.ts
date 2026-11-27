// src/proxy.ts: runs before every page and every /api path (not static files). Backend lane (SECURITY_MODEL invariants 13 and 22).
//
//   1. A fresh nonce for every request and the Content-Security-Policy that carries it (invariant 13, S0 SEC-15). The policy
//      goes on the response, and with the nonce on the request too, so Next.js renders its scripts with it.
//   2. The @supabase/ssr session cookies are refreshed (src/lib/server/session.ts) when the request has any.
//   3. A signed-out visit to /requests, /pipeline or anything below them is redirected to /sign-in?next=<path> (FR-26,
//      AC-004.3, AC-004.14). A signed-in visit to /sign-in goes on to `next` only if it passes the allow-list of invariant 22,
//      otherwise to /requests.
//
//   4. A path the app does not serve is answered here with 404, on every method (QA2 BUG-QA2-1, AC-004.10, FR-27): an
//      unknown /api path gets the contract's problem+json, an unknown page gets a small 404 page. The hosting platform's own
//      not-found handling answered 200 with HTML for POST, PUT, DELETE and a GET with an Authorization header, so the answer
//      is given before its router is asked. The list of paths is src/lib/server/auth/known-paths.ts (kept equal to src/app by
//      a test). A known /api path is passed straight on, untouched: no nonce, no policy, no cookie work.
//
// This is a convenience for pages, not a security boundary: every /api route authorises itself from the bearer token
// (requireStaff), and the pages hold no data.
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from '@/lib/server/auth/csp';
import { isApiPath, isFrameworkPath, isKnownApiPath, isKnownPagePath } from '@/lib/server/auth/known-paths';
import { isStaffPagePath, safeNextPath, signInAddress } from '@/lib/server/auth/next-path';
import { unknownApiPath } from '@/lib/server/http';
import { refreshSession } from '@/lib/server/session';

/** Does the request carry any Supabase auth cookie? (Visitors to the public form carry none, and cost no Supabase call.) */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'));
}

export async function proxy(request: NextRequest): Promise<Response> {
  const { pathname, searchParams } = request.nextUrl;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (isApiPath(path)) {
    return isKnownApiPath(path) ? NextResponse.next() : unknownApiPath(request, undefined);
  }

  const nonce = newNonce();
  const csp = contentSecurityPolicy({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === 'development',
  });
  if (!isKnownPagePath(path) && !isFrameworkPath(path)) return unknownPage(csp); // before any session work: nobody signs in to a 404

  const forwardedHeaders = { 'x-nonce': nonce, 'content-security-policy': csp };

  let response = NextResponse.next({ request: { headers: withHeaders(request.headers, forwardedHeaders) } });
  let userId: string | null = null;
  if (hasAuthCookie(request)) {
    try {
      ({ response, userId } = await refreshSession(request, forwardedHeaders));
    } catch {
      userId = null; // Supabase not configured or unreachable: treat as signed out (fail closed); nothing is logged from here
    }
  }

  if (userId === null && isStaffPagePath(path)) {
    return finish(redirectTo(request, signInAddress(path)), response, csp);
  }
  if (userId !== null && path === '/sign-in') {
    return finish(redirectTo(request, safeNextPath(searchParams.get('next'))), response, csp);
  }

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

const NOT_FOUND_PAGE =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="robots" content="noindex"><title>404: This page could not be found</title></head>' +
  '<body style="font-family:system-ui,sans-serif;margin:3rem 1.5rem"><h1>404</h1><p>This page could not be found.</p>' +
  '<p><a href="/">Back to the home page</a></p></body></html>';

/** The 404 for a page the app does not have, on any method. No script, so the policy's nonce is not needed in the body. */
function unknownPage(csp: string): NextResponse {
  return new NextResponse(NOT_FOUND_PAGE, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate', 'Content-Security-Policy': csp },
  });
}

function withHeaders(base: Headers, extra: Record<string, string>): Headers {
  const headers = new Headers(base);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function redirectTo(request: NextRequest, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url));
}

/** A redirect that keeps the refreshed session cookies and their no-cache headers, and carries the policy too. */
function finish(redirect: NextResponse, refreshed: NextResponse, csp: string): NextResponse {
  for (const cookie of refreshed.cookies.getAll()) redirect.cookies.set(cookie);
  for (const name of ['cache-control', 'pragma', 'expires']) {
    const value = refreshed.headers.get(name);
    if (value !== null) redirect.headers.set(name, value);
  }
  redirect.headers.set('Content-Security-Policy', csp);
  return redirect;
}

export const config = {
  // Every page and every /api path (an unknown one is answered with 404 here), but not Next.js's static files, images or the
  // favicon. A known /api path is passed straight on.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
