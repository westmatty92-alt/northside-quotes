import 'server-only';

// src/lib/server/services/network.ts: the network address and its hash (docs/SECURITY_MODEL.md "Network address").
//
// The address is `x-real-ip` as set by Vercel (fallback: the first `x-forwarded-for` entry). An IPv4 address is used
// whole. An IPv6 address is cut to its /64 prefix (the first four hextets, after expanding `::`, lower-cased, leading
// zeros dropped: `2001:db8:0:0`) because one client controls a whole /64 (S0 SEC-3). An IPv4-mapped IPv6 address
// (`::ffff:1.2.3.4`) counts as that IPv4 address. The HMAC-SHA256 input is `ip|v1|<address or /64 prefix>`, or
// `ip|v1|unknown` when no address is known. Only the hash is stored; the address is never logged or written anywhere.
import { isIP } from 'node:net';
import { hmacHex } from '../env';

/** The 8 hextets of a valid IPv6 address string (zone id already removed). */
function expandIpv6(address: string): number[] {
  let text = address.toLowerCase();
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail?.[1] !== undefined) {
    const [a = 0, b = 0, c = 0, d = 0] = tail[1].split('.').map(Number);
    text = text.slice(0, text.length - tail[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head = '', rest] = text.split('::');
  const first = head === '' ? [] : head.split(':');
  const last = rest === undefined || rest === '' ? [] : rest.split(':');
  const fill = rest === undefined ? 0 : 8 - first.length - last.length;
  return [...first, ...Array<string>(Math.max(fill, 0)).fill('0'), ...last].map((h) => parseInt(h, 16));
}

/**
 * The key one client is counted under: an IPv4 address, an IPv6 /64 prefix, or null when `raw` is missing or not an
 * address. (Callers use `ip|v1|unknown` for null where the model says so.)
 */
export function addressKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const version = isIP(text);
  if (version === 4) return text;
  if (version !== 6) return null;
  const hextets = expandIpv6(text);
  if (hextets.length !== 8 || hextets.some((h) => Number.isNaN(h))) return null;
  const mapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
  if (mapped) {
    const hi = hextets[6] ?? 0;
    const lo = hextets[7] ?? 0;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return hextets.slice(0, 4).map((h) => h.toString(16)).join(':');
}

/** The raw address from the request headers, or null. */
export function clientAddress(headers: Headers): string | null {
  const real = headers.get('x-real-ip');
  if (real !== null && real.trim() !== '') return real;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0];
  return forwarded !== undefined && forwarded.trim() !== '' ? forwarded : null;
}

/** The text that is hashed for an address (exported so the unit test can pin it). */
export function addressHashInput(raw: string | null | undefined): string {
  return `ip|v1|${addressKey(raw) ?? 'unknown'}`;
}

/** HMAC-SHA256 hex of the address (64 characters). Throws EnvConfigError without a valid APP_SIGNING_SECRET. */
export function addressHash(raw: string | null | undefined): string {
  return hmacHex(addressHashInput(raw));
}
