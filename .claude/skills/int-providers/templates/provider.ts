// src/lib/server/integrations/<provider>/client.ts — TEMPLATE (bl-integration, int-providers)
import 'server-only';
import { z } from 'zod';
import { getProviderToken } from '../auth';           // int-auth: per-tenant token from Vault
import { breaker } from '../breaker';                  // int-providers §2: provider_health-backed
import { log } from '@/lib/server/log';

const PROVIDER = '<provider>';
const BASE_URL = '<https://api.provider.com/v1>';     // from docs/integrations/<provider>.md
const TIMEOUT_MS = 10_000;

export class ProviderUnavailable extends Error {}
export class ProviderRateLimited extends Error { constructor(public retryAfterMs: number) { super('rate limited'); } }
export class ProviderAuthRevoked extends Error {}
export class ProviderRejected extends Error { constructor(public status: number, public detail: unknown) { super(`rejected ${status}`); } }

type Ctx = { tenantId: string; correlationId: string };

async function call<T>(ctx: Ctx, path: string, init: RequestInit & { idempotencyKey?: string }, schema: z.ZodType<T>): Promise<T> {
  await breaker.assertClosed(PROVIDER, ctx.tenantId);                // fails fast with ProviderUnavailable when open
  const token = await getProviderToken(PROVIDER, ctx.tenantId);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { ...init.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json',
          ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}) },
      });
    } catch {
      await breaker.failure(PROVIDER, ctx.tenantId);
      if (attempt === 3) throw new ProviderUnavailable(`${PROVIDER} network/timeout`);
      await backoff(attempt); continue;
    }
    log.info('provider.call', { provider: PROVIDER, path, status: res.status, ms: Date.now() - started, correlation_id: ctx.correlationId });
    if (res.ok) { await breaker.success(PROVIDER, ctx.tenantId); return schema.parse(await res.json()); }
    if (res.status === 401) throw new ProviderAuthRevoked(PROVIDER);
    if (res.status === 429 || res.status >= 500) {
      await breaker.failure(PROVIDER, ctx.tenantId);
      const ra = Number(res.headers.get('retry-after')) * 1000 || 0;
      if (attempt === 3) throw res.status === 429 ? new ProviderRateLimited(ra || 60_000) : new ProviderUnavailable(`${PROVIDER} ${res.status}`);
      await backoff(attempt, ra); continue;
    }
    throw new ProviderRejected(res.status, await res.json().catch(() => null));   // other 4xx: never retried
  }
  throw new ProviderUnavailable(PROVIDER);
}

const backoff = (attempt: number, min = 0) => new Promise((r) => setTimeout(r, Math.max(min, Math.random() * 500 * 2 ** attempt)));

// Exactly the operations in docs/integration-contract.md, mapped to our types:
const RemoteThing = z.object({ id: z.string() /* … */ });
export async function getThing(ctx: Ctx, id: string) {
  return call(ctx, `/things/${encodeURIComponent(id)}`, { method: 'GET' }, RemoteThing);
}
