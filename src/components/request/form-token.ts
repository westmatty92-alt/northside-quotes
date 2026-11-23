// The form token is `v1.{issued_at_ms}.{nonce_uuid}.{signature}` (docs/SECURITY_MODEL.md "The public formToken
// scheme"). The page never checks the signature (the server does); it only needs the nonce, to remember which
// token has already carried a completed submission.
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nonceOf(token: string): string | null {
  const parts = token.split('.');
  const nonce = parts[2];
  return parts.length === 4 && nonce !== undefined && NONCE.test(nonce) ? nonce : null;
}
