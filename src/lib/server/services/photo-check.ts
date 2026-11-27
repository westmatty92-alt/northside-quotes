import 'server-only';

// src/lib/server/services/photo-check.ts: what makes a stored photo acceptable (docs/SECURITY_MODEL.md invariant 7,
// docs/openapi.yaml submitQuoteRequest). Pure: it looks at the first bytes of the file and its size only.
//   - at most 5,242,880 bytes;
//   - the first bytes are a JPEG (FF D8 FF), PNG (89 50 4E 47 0D 0A 1A 0A) or WebP (RIFF....WEBP) signature;
//   - a PNG or WebP whose header declares more than 12,000 pixels on either side is refused (decompression bomb).
// The declared content type is never trusted: the type returned here is what the bytes say.

export const MAX_PHOTO_BYTES = 5_242_880;
export const MAX_PHOTO_PIXELS = 12_000;
/** How many leading bytes the checks need (a WebP VP8X header ends at byte 30). */
export const PHOTO_HEAD_BYTES = 64;

export type PhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type PhotoRefusal = 'too_large' | 'bad_type';
export type PhotoVerdict = { ok: true; contentType: PhotoContentType } | { ok: false; reason: PhotoRefusal };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (head: Uint8Array, from: number, text: string): boolean =>
  head.length >= from + text.length && [...text].every((ch, i) => head[from + i] === ch.charCodeAt(0));

const be32 = (head: Uint8Array, at: number): number =>
  ((head[at] ?? 0) * 0x1000000) + (((head[at + 1] ?? 0) << 16) | ((head[at + 2] ?? 0) << 8) | (head[at + 3] ?? 0));
const le16 = (head: Uint8Array, at: number): number => (head[at] ?? 0) | ((head[at + 1] ?? 0) << 8);
const le24 = (head: Uint8Array, at: number): number => le16(head, at) | ((head[at + 2] ?? 0) << 16);

/** Width and height a PNG declares in its IHDR, or undefined when the header is not there. */
function pngSize(head: Uint8Array): { width: number; height: number } | undefined {
  if (head.length < 24 || !ascii(head, 12, 'IHDR')) return undefined;
  return { width: be32(head, 16), height: be32(head, 20) };
}

/** Width and height a WebP declares (lossy VP8, lossless VP8L or extended VP8X), or undefined when unreadable. */
function webpSize(head: Uint8Array): { width: number; height: number } | undefined {
  if (head.length < 30) return undefined;
  if (ascii(head, 12, 'VP8 ')) {
    if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return undefined;
    return { width: le16(head, 26) & 0x3fff, height: le16(head, 28) & 0x3fff };
  }
  if (ascii(head, 12, 'VP8L')) {
    if (head[20] !== 0x2f) return undefined;
    const b1 = head[21] ?? 0;
    const b2 = head[22] ?? 0;
    const b3 = head[23] ?? 0;
    const b4 = head[24] ?? 0;
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  if (ascii(head, 12, 'VP8X')) return { width: 1 + le24(head, 24), height: 1 + le24(head, 27) };
  return undefined;
}

/** Judge one stored photo from its first bytes and its size. */
export function inspectPhoto(head: Uint8Array, sizeBytes: number): PhotoVerdict {
  if (sizeBytes > MAX_PHOTO_BYTES) return { ok: false, reason: 'too_large' };
  if (sizeBytes < 1) return { ok: false, reason: 'bad_type' };

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ok: true, contentType: 'image/jpeg' };

  if (PNG_SIGNATURE.every((byte, i) => head[i] === byte)) {
    const size = pngSize(head);
    if (size === undefined) return { ok: false, reason: 'bad_type' };
    return size.width > MAX_PHOTO_PIXELS || size.height > MAX_PHOTO_PIXELS
      ? { ok: false, reason: 'too_large' }
      : { ok: true, contentType: 'image/png' };
  }

  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) {
    const size = webpSize(head);
    if (size === undefined) return { ok: false, reason: 'bad_type' };
    return size.width > MAX_PHOTO_PIXELS || size.height > MAX_PHOTO_PIXELS
      ? { ok: false, reason: 'too_large' }
      : { ok: true, contentType: 'image/webp' };
  }

  return { ok: false, reason: 'bad_type' };
}
