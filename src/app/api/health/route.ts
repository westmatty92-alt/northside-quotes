// GET /api/health (contract tag System, operation getHealth, schema Health): `{ status: "ok", version }`, no dependency checks
// (docs/architecture.md "Observability"). Any other method is a 405 problem (the contract lists it).
import type { Health } from '@/lib/api/generated/model';
import { json, methodNotAllowed, withApi } from '@/lib/server/http';

export const GET = withApi('GET /api/health', async (_req, ctx) => {
  const body: Health = { status: 'ok', version: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local' };
  return json(ctx, body);
});

const notAllowed = methodNotAllowed('/api/health', ['GET']);
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
