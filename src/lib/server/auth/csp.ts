// src/lib/server/auth/csp.ts: the Content-Security-Policy of docs/SECURITY_MODEL.md invariant 13, with a fresh nonce.
//
//   default-src 'self'; script-src 'self' 'nonce-<per request>' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
//   img-src 'self' blob: data: <Supabase origin>; connect-src 'self' <Supabase origin>; font-src 'self'; object-src 'none';
//   base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
//   (development adds 'unsafe-eval' to script-src only: React needs it there, not in production).
//
// Pure functions, no secrets: the Supabase URL is a public value. A nonce is 16 random bytes from the platform's CSPRNG,
// base64-encoded, drawn again for every request (Next.js guide: https://nextjs.org/docs/app/guides/content-security-policy).

/** A fresh, unguessable nonce: 16 random bytes, base64 (24 characters). */
export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/** The origin of the Supabase project (images and connections are allowed to it only), or null when it is unset or not a URL. */
export function supabaseOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export type CspOptions = { nonce: string; supabaseUrl?: string | undefined; development?: boolean };

/** The policy as one header value. */
export function contentSecurityPolicy({ nonce, supabaseUrl, development = false }: CspOptions): string {
  const supabase = supabaseOrigin(supabaseUrl);
  const withSupabase = (base: string) => (supabase === null ? base : `${base} ${supabase}`);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    withSupabase("img-src 'self' blob: data:"),
    withSupabase("connect-src 'self'"),
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}
