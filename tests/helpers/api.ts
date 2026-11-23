// tests/helpers/api.ts: request builders, response checks and image fixtures shared by the API tests. No network, no secrets.
import { expect, vi } from 'vitest';
import { z } from 'zod';
import { ProblemCode } from '@/lib/api/generated/model';

const ORIGIN = 'http://localhost';

/** A JSON POST to `/api/...` as the route handlers receive it. */
export function jsonRequest(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; rawBody?: string } = {}): Request {
  const headers: Record<string, string> = { ...init.headers };
  let body: string | undefined;
  if (init.rawBody !== undefined) body = init.rawBody;
  else if (init.body !== undefined) body = JSON.stringify(init.body);
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${ORIGIN}${path}`, { method: init.method ?? 'POST', headers, body });
}

/** The contract's Problem schema (responses.* in docs/openapi.yaml). */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.enum(Object.values(ProblemCode) as [string, ...string[]]),
  detail: z.string().optional(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});

export type ProblemBody = z.infer<typeof ProblemSchema>;

/** Asserts a problem+json response of the given status and code that matches the contract's Problem schema; returns the body. */
export async function expectProblem(res: Response, status: number, code: string): Promise<ProblemBody> {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  expect(res.headers.get('x-request-id')).toBeTruthy();
  const body = ProblemSchema.parse(await res.json());
  expect(body.status).toBe(status);
  expect(body.code).toBe(code);
  return body;
}

/** Everything written to the console and stdout while `run` runs, as one text (to prove nothing personal is logged). */
export async function captureOutput(run: () => Promise<unknown>): Promise<string> {
  const chunks: string[] = [];
  const keep = (...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')];
  for (const spy of spies) spy.mockImplementation(keep);
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    await run();
  } finally {
    for (const spy of spies) spy.mockRestore();
    write.mockRestore();
  }
  return chunks.join('\n');
}

// ---- image fixtures (only the first bytes matter to the server's check; the bucket checks the declared type) ----

const pad = (bytes: number[], length: number): Uint8Array => Uint8Array.from([...bytes, ...Array<number>(Math.max(length - bytes.length, 0)).fill(0)]);
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le24 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

/** A JPEG signature followed by filler. */
export function jpegBytes(length = 600): Uint8Array {
  return pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF')], length);
}

/** A PNG signature and an IHDR that declares `width` x `height`, followed by filler. */
export function pngBytes(width = 1, height = 1, length = 600): Uint8Array {
  return pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii('IHDR'), ...be32(width), ...be32(height), 8, 6, 0, 0, 0], length);
}

/** A WebP (extended VP8X) that declares `width` x `height`, followed by filler. */
export function webpBytes(width = 1, height = 1, length = 600): Uint8Array {
  return pad([...ascii('RIFF'), 0x30, 0x02, 0, 0, ...ascii('WEBP'), ...ascii('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)], length);
}

/** Not an image at all. */
export function textBytes(): Uint8Array {
  return new TextEncoder().encode('This is a text file, not a picture. '.repeat(20));
}
