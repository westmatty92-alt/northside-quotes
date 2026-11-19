---
name: int-providers
description: Provider wrappers for bl-integration — one typed client per outside system (GHL, Stripe, QuickBooks, Loyverse, Monday/HubSpot, email/SMS, or any new provider) with timeouts, safe retries, rate-limit budgets, a database-backed circuit breaker, idempotency keys and typed errors. Use whenever code calls an outside API.
---

# Integration · Provider wrappers

The rest of the app never calls a provider SDK or URL directly. It calls `src/lib/server/integrations/<provider>/client.ts`, which you write from `templates/provider.ts`.

## 1. Shape
- Typed functions for exactly the operations in `docs/integration-contract.md`. Each takes `tenantId` (tokens are per tenant) and a `correlationId` (I14).
- Inputs validated before sending; responses parsed with Zod schemas at the boundary. Provider shapes never leak past the wrapper: map them to our types.
- Errors become typed classes the services understand: `ProviderUnavailable` (5xx, timeout, breaker open), `ProviderRateLimited` (429), `ProviderAuthRevoked` (401/invalid_grant → reconnect flow), `ProviderRejected` (4xx validation; never retried), `ProviderNotFound`.

## 2. Calls that survive bad days
- **Timeout** on every call: 10 s by default, less on user-facing paths. Use `AbortSignal.timeout()`.
- **Retry** only network errors, 429 and 5xx: up to 3 attempts, exponential backoff with full jitter, and `Retry-After` honoured when present. QuickBooks' rule is to wait 60 s on 429. Never retry other 4xx.
- **Rate budget** per provider and tenant, from the provider profile (e.g. QuickBooks 500/min and 10/s per company; Loyverse to confirm). Bursts go through the jobs table, not loops in a request.
- **Circuit breaker (I13):** after N consecutive failures (default 5), `provider_health` for (provider, tenant) becomes `open` until `retry_after`. While open, calls fail fast with `ProviderUnavailable`, work is queued, and the UI shows the outage banner. One trial call after the cool-off closes or re-opens it. State lives in the database because serverless instances share no memory.
- **Idempotency** on every create or charge: Stripe `Idempotency-Key` (same key and same params within 24 h; reuse with different params is an error), and upsert by external id where the provider has no key. Store our id in the provider's metadata (Stripe `metadata.baseleap_id`) so webhooks map back.

## 3. Pagination and bulk
Use the provider's cursor or offset per the profile. Cap page size, never "fetch all" in a request, and use bulk or batch endpoints when they exist (QuickBooks batch: 30 payloads).

## 4. Secrets
Tokens are loaded from Supabase Vault per tenant (`int-auth`). Env var **names** only in code. Never log headers, tokens or full payloads with personal data: log ids, status, latency and the correlation id.

## 5. House providers (profiles in `docs/integrations/` and `research/integration/notes/`)
GHL v2 (Private Integration Token or OAuth; verify webhooks with `X-GHL-Signature`/Ed25519) · Stripe (webhooks are the source of truth for "paid") · QuickBooks Online (OAuth only, 60-min access tokens, store the newest refresh token) · Loyverse (personal token = full-account secret; prefer OAuth scopes) · Monday/HubSpot (read the client's uploaded action and trigger docs). **Any other provider:** run `int-new-provider` first.

---

## Baseleap standing rules (Matthew, Nov 15)

Every connection must be visible in the code, so this agent and the Maintenance agent can see, check and fix it.
1. **Nothing is created in a dashboard.** Scheduled jobs, database webhooks and Vault secret *names* are defined in migrations. A dashboard-only object found in a takeover is a finding.
2. **One key per project per provider** (each app, each client, the agent machine), each with its own spend limit where the provider offers one. Production keys live only in Production; Preview gets a separate low-cap key or none.
3. **Service-role keys stay off the host** unless a server route truly needs one. Then it lives in Production only and is imported from the one allowed file (`check-code-guards service-role`).
4. **Provider webhooks land on one endpoint per provider** in the project: signature checked, stored once in the inbox, health shown on the Console Connections tab. No provider workflow (GHL or otherwise) posts to an ad-hoc URL.
5. **No n8n, Zapier or Make in new builds.** Use the jobs table, Supabase Cron and the app's own routes. An existing flow found in a takeover is registered and scheduled for migration, not removed without Matthew.

Sources (ideas adapted, text ours): be-integrations (Baseleap), research/integration notes (Stripe, QuickBooks, GHL, Loyverse), Jeffallan api-designer (MIT), VoltAgent payment-integration (MIT); circuit-breaker idea read in borghei (Commons Clause, not copied).
