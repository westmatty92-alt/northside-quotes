---
name: int-webhooks
description: Inbound webhooks for bl-integration — verify the signature on the raw body, reject stale timestamps, store the provider event id once (unique), acknowledge fast, process from the jobs table, and handle duplicates and out-of-order delivery. Covers Standard Webhooks, Stripe, GHL (X-GHL-Signature), QuickBooks and providers with no signature.
---

# Integration · Webhooks in

Route: `src/app/api/webhooks/<provider>/route.ts` from `templates/webhook-route.ts`. The contract marks it `security: []`, and the signature *is* the auth.

## The five steps, in this order
1. **Read the raw body first:** `const raw = await req.text()`. Any JSON parse or re-serialise before verifying breaks every signature scheme.
2. **Verify** with the provider's scheme and a constant-time compare:
   - **Standard Webhooks** (Svix-style and many others): headers `webhook-id`, `webhook-timestamp`, `webhook-signature`. HMAC-SHA256 over `${id}.${timestamp}.${raw}` with the base64 secret after `whsec_`; the header may carry several space-separated `v1,<sig>` values (secret rotation), and any match passes.
   - **Stripe:** `Stripe-Signature` (`t=…,v1=…`). Use `stripe.webhooks.constructEvent(raw, sig, secret)`. Test and live secrets differ, and a rolled secret overlaps for up to 24 h.
   - **GHL:** `X-GHL-Signature` (Ed25519, public key from GHL's current guide). The legacy `X-WH-Signature` was deprecated on 2026-09-01; never accept it.
   - **QuickBooks:** `intuit-signature`, an HMAC-SHA256 of the body with the app's verifier token (base64).
   - **No signature offered** (check the provider profile): put an unguessable per-tenant secret in the URL path, accept only the event id from the payload, and **re-fetch the object from the API** before trusting any field. Write this down in the runbook.
3. **Reject replays:** a timestamp older or newer than 5 minutes → 401. No processing.
4. **Store once:** insert into `integration_events (provider, provider_event_id, tenant_id, type, received_at, payload_ref)` with a unique (provider, provider_event_id). On conflict, it's a repeat: return 200 and do nothing.
5. **Acknowledge fast:** enqueue a row in `jobs` and return 2xx within about a second. Processing happens in the worker (`int-sync` §3), never inside the request. Providers retry slow endpoints, and Vercel functions have hard limits.

## Processing rules (in the worker)
- **Out of order:** compare the provider's `updated_at` or version with what we hold, and ignore older ones.
- **Thin events:** when a payload only names the object (QuickBooks, Stripe thin events), fetch it through the wrapper.
- **Correlation id** = the provider event id, carried into the job, outbound calls and logs (I14).
- **Failures:** retry with backoff, then dead-letter after N attempts (`jobs.status = 'dead'`) so it shows in the Console's failed-jobs view with a replay button. Never drop silently.
- **Replay endpoint:** admin only (owner role, `SECURITY_MODEL.md`). It re-enqueues a stored event and is idempotent by design.

## Never
Log raw payloads that contain personal data or secrets. Trust IP allowlists alone. Accept an unsigned payload on a provider that offers signing.

---
Sources (ideas adapted, text ours): Standard Webhooks spec + receiving-webhooks skill (Apache-2.0), Stripe webhook docs (notes/stripe.md), GHL webhook guide (notes/ghl.md), Supabase scheduled-job signing (notes/supabase-vault-cron.md), VoltAgent webhook-engineer (MIT).
