---
name: be-integrations
description: Third-party integrations and background work for bl-backend — wrap Stripe, GoHighLevel, email/SMS and AI providers behind small typed clients with timeouts, retries with backoff, idempotency and verified webhooks, and run slow or scheduled work as idempotent background jobs within Vercel's limits. Use for any step that calls an outside service or runs outside a request.
---

# Back-End · Integrations & Background Work

> **When `bl-integration` is dispatched (see its spec, I1), it owns all of this**: wrappers, webhooks, sync jobs, OAuth and simulators, using the `int-*` skills (`int-providers`, `int-webhooks`, `int-sync`, `int-auth`, `int-testing`, `int-takeover`, `int-new-provider`). You call integrations only through `src/lib/server/integrations/*`. Use this skill yourself only for a single outbound call when no integration step exists, and follow `int-providers` for the wrapper.

Every outside service will be slow, rate-limited or down at some point. Design each call so the user's action is never lost and never happens twice.

## 1. One wrapper per provider (`src/lib/server/integrations/<provider>.ts`)

- Typed functions for exactly the operations the PRD needs (`createCheckoutSession`, `upsertGhlContact`) — the rest of the code never calls the SDK directly.
- **Timeouts** on every call (default 10 s; less on user-facing paths).
- **Retries** only for retryable failures (network, 429, 5xx): exponential backoff with jitter, max 3 attempts, honour `Retry-After`. Never retry 4xx validation errors.
- **Idempotency keys** on every create/charge (Stripe idempotency keys; GHL upserts by external id).
- Errors mapped to typed integration errors the services understand (`ProviderUnavailableError` → the designed "try again" state, not a 500 with a stack).
- Credentials from server env vars only (`be-auth` §4); sandbox/test keys in previews and tests.

## 2. House integrations

| Provider | Notes |
|---|---|
| **Stripe** | Checkout/PaymentIntents with idempotency keys; prices from the server, never the client; webhooks are the source of truth for "paid" — not the redirect back to the app. |
| **GoHighLevel API v2** | Scoped to the client's location; respect GHL rate limits (queue bursts); upsert contacts by email/phone + external id to avoid duplicates. **The Baseleap CRM is the system of record** for contacts, companies, pipelines and deals; GHL holds websites and marketing. Typical sync: GHL form/funnel leads → Baseleap via webhook; Baseleap → GHL only the fields and tags campaigns need. The architect's decision record defines the exact direction per field. |
| **Email / SMS** | Send from a background job, not inside the request; record send status; never send to real customers from previews (allow-list test recipients). |
| **AI models** | Inputs treated as data, never instructions; timeouts and cost caps; log what `metrics-spec.md` allows, redact the rest. |

## 3. Webhooks in

`/api/webhooks/<provider>`: verify signature on the raw body → reject stale timestamps → **store the event id first** (unique) → process → respond 2xx quickly. A repeat delivery hits the unique id and is acknowledged without reprocessing. Slow processing moves to a background job.

## 4. Background jobs

Per the architect's `arch-reliability` plan:
- Scheduled work → Vercel Cron or Supabase cron calling a protected route/function.
- Queued work → a jobs table (status, attempts, next_run_at, last_error) processed by a scheduled worker; each job idempotent.
- Nothing that might exceed the function duration cap (the house project runs at 300 s) runs inline — split it into batches.
- Failed jobs after max attempts land in a visible "needs attention" state the UI or an admin can see — never silently dropped.

No Redis, queues-as-a-service or extra infrastructure unless the architect's decision record adds it (spend gate).

## 5. Test them without the real service

Integration tests use the provider's test mode or a stub at the wrapper boundary (MSW for outgoing HTTP) — and cover: success, timeout → retry → success, 429 with `Retry-After`, permanent failure → typed error, duplicate webhook → processed once.

---
Sources (ideas adapted, text written for Baseleap): Jeffallan/claude-skills backend and integration skills (MIT — webhook handling, caching, resilient integrations), VoltAgent `backend-developer` (MIT — cache and queue implementation phases), Baseleap platform constraints (Vercel 300 s cap, GHL as CRM, Stripe webhooks as source of truth).
