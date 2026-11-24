// @vitest-environment node
// src/lib/server/services/photo-check.ts: SECURITY_MODEL invariant 7 (magic bytes, 5,242,880 bytes, 12,000 pixels). No database.
import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS, inspectPhoto } from '@/lib/server/services/photo-check';
import { jpegBytes, pngBytes, textBytes, webpBytes } from '../../helpers/api';

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const filler = (bytes: number[], length = 64) => Uint8Array.from([...bytes, ...Array<number>(Math.max(length - bytes.length, 0)).fill(0)]);

/** A lossy WebP (VP8) header declaring width x height. */
const webpLossy = (width: number, height: number) =>
  filler([...ascii('RIFF'), 0x30, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 '), 0x20, 0, 0, 0, 0x10, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height)]);

/** A lossless WebP (VP8L) header declaring width x height (14 bits each, minus one). */
const webpLossless = (width: number, height: number) => {
  const packed = (width - 1) | ((height - 1) << 14);
  return filler([...ascii('RIFF'), 0x30, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8L'), 0x20, 0, 0, 0, 0x2f, packed & 255, (packed >> 8) & 255, (packed >> 16) & 255, (packed >>> 24) & 255]);
};

describe('inspectPhoto: type by first bytes, never by the declared type', () => {
  it('accepts a JPEG, a PNG and a WebP of every kind and reports what the bytes say', () => {
    expect(inspectPhoto(jpegBytes(), 600)).toEqual({ ok: true, contentType: 'image/jpeg' });
    expect(inspectPhoto(pngBytes(), 600)).toEqual({ ok: true, contentType: 'image/png' });
    expect(inspectPhoto(webpBytes(), 600)).toEqual({ ok: true, contentType: 'image/webp' });
    expect(inspectPhoto(webpLossy(640, 480), 600)).toEqual({ ok: true, contentType: 'image/webp' });
    expect(inspectPhoto(webpLossless(640, 480), 600)).toEqual({ ok: true, contentType: 'image/webp' });
  });

  it('refuses text, GIF, an empty file, a truncated PNG and a RIFF that is not WebP as bad_type', () => {
    expect(inspectPhoto(textBytes(), 700)).toEqual({ ok: false, reason: 'bad_type' });
    expect(inspectPhoto(filler(ascii('GIF89a')), 600)).toEqual({ ok: false, reason: 'bad_type' });
    expect(inspectPhoto(new Uint8Array(), 0)).toEqual({ ok: false, reason: 'bad_type' });
    expect(inspectPhoto(pngBytes().slice(0, 12), 600)).toEqual({ ok: false, reason: 'bad_type' }); // signature only, no IHDR
    expect(inspectPhoto(filler([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]), 600)).toEqual({ ok: false, reason: 'bad_type' });
    expect(inspectPhoto(filler([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('JUNK')]), 600)).toEqual({ ok: false, reason: 'bad_type' });
  });
});

describe('inspectPhoto: size', () => {
  it('accepts 5,242,880 bytes and refuses one byte more as too_large', () => {
    expect(inspectPhoto(jpegBytes(), MAX_PHOTO_BYTES)).toEqual({ ok: true, contentType: 'image/jpeg' });
    expect(inspectPhoto(jpegBytes(), MAX_PHOTO_BYTES + 1)).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('inspectPhoto: at most 12,000 pixels on each side (PNG and WebP), decompression bombs', () => {
  it('PNG: 12,000 is accepted, 12,001 wide or high is too_large', () => {
    expect(inspectPhoto(pngBytes(MAX_PHOTO_PIXELS, MAX_PHOTO_PIXELS), 600).ok).toBe(true);
    expect(inspectPhoto(pngBytes(MAX_PHOTO_PIXELS + 1, 10), 600)).toEqual({ ok: false, reason: 'too_large' });
    expect(inspectPhoto(pngBytes(10, MAX_PHOTO_PIXELS + 1), 600)).toEqual({ ok: false, reason: 'too_large' });
    expect(inspectPhoto(pngBytes(0xffffffff, 0xffffffff), 600)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('WebP VP8X, VP8 and VP8L: 12,000 is accepted, 12,001 wide or high is too_large', () => {
    expect(inspectPhoto(webpBytes(MAX_PHOTO_PIXELS, MAX_PHOTO_PIXELS), 600).ok).toBe(true);
    expect(inspectPhoto(webpBytes(MAX_PHOTO_PIXELS + 1, 10), 600)).toEqual({ ok: false, reason: 'too_large' });
    expect(inspectPhoto(webpBytes(10, MAX_PHOTO_PIXELS + 1), 600)).toEqual({ ok: false, reason: 'too_large' });
    expect(inspectPhoto(webpBytes(1 << 24, 1), 600)).toEqual({ ok: false, reason: 'too_large' });
    // VP8 (lossy) stores 14 bits, so its largest declarable side is 16,383
    expect(inspectPhoto(webpLossy(12_000, 100), 600).ok).toBe(true);
    expect(inspectPhoto(webpLossy(12_001, 100), 600)).toEqual({ ok: false, reason: 'too_large' });
    expect(inspectPhoto(webpLossy(100, 16_000), 600)).toEqual({ ok: false, reason: 'too_large' });
    expect(inspectPhoto(webpLossless(12_000, 100), 600).ok).toBe(true);
    expect(inspectPhoto(webpLossless(12_001, 100), 600)).toEqual({ ok: false, reason: 'too_large' });
    expect(inspectPhoto(webpLossless(100, 12_001), 600)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('JPEG has no pixel check in the contract, so a JPEG is accepted on its signature', () => {
    expect(inspectPhoto(jpegBytes(), 4_000_000).ok).toBe(true);
  });
});
