// POST /api/auth/sign-in (operation signIn): staff sign-in with email and password. A pre-session route (no bearer token).
// The rules (limits before Auth, fail closed, staff check, success marking, event) are in src/lib/server/auth/sign-in.ts.
// This handler only reads the body and the network address, and turns the result into the contract's 200: the staff
// member as the body and the @supabase/ssr session cookies as Set-Cookie (httpOnly false, Secure, SameSite Lax).
// There is no sign-up, password change or password reset route anywhere in the app (FR-27, invariant 21): any other method
// on this path is a 405.
import { NextResponse } from 'next/server';
import { signIn } from '@/lib/server/auth/sign-in';
import { json, methodNotAllowed, readJsonBody, withApi } from '@/lib/server/http';
import { clientAddress } from '@/lib/server/services/network';

type CookieAttributes = NonNullable<Parameters<NextResponse['cookies']['set']>[2]>;

export const POST = withApi('POST /api/auth/sign-in', async (req, ctx) => {
  const result = await signIn({ body: await readJsonBody(req), clientAddress: clientAddress(req.headers) });
  const base = json(ctx, result.staff, 200, result.headers);
  const response = new NextResponse(base.body, { status: 200, headers: base.headers });
  for (const cookie of result.cookies) response.cookies.set(cookie.name, cookie.value, cookie.options as CookieAttributes);
  return response;
});

const notAllowed = methodNotAllowed('/api/auth/sign-in', ['POST']);
export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
