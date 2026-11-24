// Test photos. Real JPEG, PNG and WebP images are drawn with a canvas in the browser under test, then padded
// with trailing zero bytes to the size a test needs (decoders ignore bytes after the image; the server checks
// the first bytes and the total size, FR-6).
import type { Page } from '@playwright/test';

export const MB = 1024 * 1024;
export const MAX_PHOTO_BYTES = 5 * MB; // 5,242,880

export type Photo = { name: string; mimeType: string; buffer: Buffer };

const cache = new Map<string, Buffer>();

async function draw(page: Page, mime: 'image/jpeg' | 'image/png' | 'image/webp', hue: number): Promise<Buffer> {
  const key = `${mime}:${hue}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dataUrl = await page.evaluate(
    ([m, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 48;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = `hsl(${h}, 60%, 55%)`;
      ctx.fillRect(0, 0, 64, 48);
      ctx.fillStyle = '#fff';
      ctx.fillRect(8, 8, 24, 16);
      return canvas.toDataURL(m, 0.8);
    },
    [mime, hue] as const,
  );
  const buffer = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
  if (buffer.length < 20) throw new Error(`could not draw a ${mime} test image`);
  cache.set(key, buffer);
  return buffer;
}

/** Pad to exactly `bytes` (never shrinks). */
export function padTo(image: Buffer, bytes: number): Buffer {
  if (image.length > bytes) throw new Error('test image is larger than the requested size');
  return Buffer.concat([image, Buffer.alloc(bytes - image.length)]);
}

export async function jpeg(page: Page, name: string, bytes = 2 * MB, hue = 200): Promise<Photo> {
  return { name, mimeType: 'image/jpeg', buffer: padTo(await draw(page, 'image/jpeg', hue), bytes) };
}
export async function png(page: Page, name: string, bytes = 200 * 1024, hue = 20): Promise<Photo> {
  return { name, mimeType: 'image/png', buffer: padTo(await draw(page, 'image/png', hue), bytes) };
}
export async function webp(page: Page, name: string, bytes = 200 * 1024, hue = 120): Promise<Photo> {
  return { name, mimeType: 'image/webp', buffer: padTo(await draw(page, 'image/webp', hue), bytes) };
}

/** A text file wearing a .jpg name and an image MIME type (AC-002.4). */
export function fakeJpeg(name = 'leak.jpg'): Photo {
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from('This is plain text, not a picture.\n'.repeat(40)) };
}

export function pdf(name = 'quote.pdf'): Photo {
  return { name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') };
}
