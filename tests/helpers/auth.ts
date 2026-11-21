// tests/helpers/auth.ts: request builders and cookie readers for the staff-auth tests. No secrets live here; the staff
// passwords come from tests/helpers/staging-env.ts and are only ever passed on to the route under test.
import { jsonRequest } from './api';

const SIGN_IN_PATH = '/api/auth/sign-in';

/** POST /api/auth/sign-in as the handler receives it. `address` null means no address header at all. */
export function signInRequest(body: unknown, address: string | null, extraHeaders: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { ...extraHeaders };
  if (address !== null) headers['x-real-ip'] = address;
  return jsonRequest(SIGN_IN_PATH, { headers, body });
}

/** GET /api/staff/me with an optional bearer token and cookie header. */
export function meRequest(options: { token?: string; authorization?: string; cookie?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.authorization !== undefined) headers.authorization = options.authorization;
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  return new Request('http://localhost/api/staff/me', { method: 'GET', headers });
}

export type SetCookie = { name: string; value: string; attributes: string[] };

/** Every Set-Cookie of a response: name, value and the attribute words (lower-cased `secure`, `samesite=lax`, `httponly`...). */
export function setCookies(res: Response): SetCookie[] {
  return res.headers.getSetCookie().map((line) => {
    const [pair = '', ...rest] = line.split(';').map((part) => part.trim());
    const at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), attributes: rest.map((a) => a.toLowerCase()) };
  });
}

/** The `cookie` request header a browser would send back for these Set-Cookie lines. */
export function cookieHeader(res: Response): string {
  return setCookies(res)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** The Supabase session held in the auth cookies of a sign-in response (chunks joined, base64url decoded). */
export function sessionOf(res: Response): { access_token: string; refresh_token: string; user: { id: string } } {
  const chunks = setCookies(res)
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => Number(a.name.split('.')[1] ?? 0) - Number(b.name.split('.')[1] ?? 0));
  if (chunks.length === 0) throw new Error('the response set no sb-*-auth-token cookie');
  const joined = chunks.map((c) => c.value).join('');
  const encoded = joined.startsWith('base64-') ? joined.slice('base64-'.length) : joined;
  const text = joined.startsWith('base64-') ? Buffer.from(encoded, 'base64url').toString('utf8') : decodeURIComponent(joined);
  return JSON.parse(text) as { access_token: string; refresh_token: string; user: { id: string } };
}
