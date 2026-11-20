// GET /api/health (contract tag System, schema Health): `{ status: "ok", version }`, no dependency checks
// (docs/architecture.md "Observability"). Scaffolded by A2; the backend lane owns src/app/api/** from here.
import type { Health } from '@/lib/api/generated/model';

export function GET(): Response {
  const body: Health = { status: 'ok', version: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local' };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
