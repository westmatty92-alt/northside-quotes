// src/proxy.ts: runs before every page (not /api, not static files). Backend lane (SECURITY_MODEL invariants 13 and 22).
//
//   1. A fresh nonce for every request and the Content-Security-Policy that carries it (invariant 13, S0 SEC-15). The policy
//      goes on the response, and with the nonce on the request too, so Next.js renders its scripts with it.
//   2. The @supabase/ssr session cookies are refreshed (src/lib/server/session.ts) when the request has any.
//   3. A signed-out visit to /requests, /pipeline or anything below them is redirected to /sign-in?next=<path> (FR-26,
//      AC-004.3, AC-004.14). A signed-in visit to /sign-in goes on to `next` only if it passes the allow-list of invariant 22,
//      otherwise to /requests.
//
// This is a convenience for pages, not a security boundary: every /api route authorises itself from the bearer token
// (requireStaff), and the pages hold no data. /api is not matched at all.
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from '@/lib/server/auth/csp';
import { isStaffPagePath, safeNextPath, signInAddress } from '@/lib/server/auth/next-path';
import { refreshSession } from '@/lib/server/session';

/** Does the request carry any Supabase auth cookie? (Visitors to the public form carry none, and cost no Supabase call.) */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = newNonce();
  const csp = contentSecurityPolicy({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === 'development',
  });
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

  const { pathname, searchParams } = request.nextUrl;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (userId === null && isStaffPagePath(path)) {
    return finish(redirectTo(request, signInAddress(path)), response, csp);
  }
  if (userId !== null && path === '/sign-in') {
    return finish(redirectTo(request, safeNextPath(searchParams.get('next'))), response, csp);
  }

  response.headers.set('Content-Security-Policy', csp);
  return response;
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
  // Every page, but not /api (JSON, bearer-authorised in the handler), Next.js's static files, images or the favicon.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
