---
name: int-auth
description: Credentials for bl-integration — OAuth 2.0 connect/callback/refresh (PKCE where offered), API keys and private tokens, per-tenant storage in Supabase Vault, least-privilege scopes, refresh before expiry, rotating refresh tokens, and the reconnect flow when access is revoked. Never print or log a token.
---

# Integration · Auth & credentials

## 1. Pick the narrowest credential the provider offers
OAuth with scopes > a scoped API key > a full-account token. Which of these a provider actually offers comes from its profile, not this list (e.g. Loyverse documents OAuth but its scopes are still to confirm). A full-account token (a Loyverse personal access token, a GHL sub-account PIT) is treated like a password for the whole business: it lives in Vault, is never logged, and is listed in the runbook as "full account".

## 2. OAuth flow (`/api/integrations/<provider>/connect` and `/callback`)
- `connect`: owner role only. Generate `state` (and a PKCE `code_verifier` when supported), store them server-side bound to the tenant and user with a short expiry, then redirect to the provider with the minimum scopes the contract needs.
- `callback`: check `state` (one use, not expired), exchange the code server-side, store tokens in Vault, record `connected_by`, scopes and expiry, then redirect to the Connections screen. A wrong or expired state → 400, nothing stored.
- Redirect URIs are exact and listed per environment (preview, staging, prod) in the runbook.

## 3. Storage
- `vault.create_secret(token, '<provider>:<tenant>:access')` and the same for the refresh token. Our table `integration_connections (tenant_id, provider, access_secret_id, refresh_secret_id, scopes, expires_at, status, connected_by)` holds **ids only**.
- Only server code reads `vault.decrypted_secrets`, through a security-definer function limited to the service role. That view must never be reachable by `authenticated` or `anon`.
- Env var **names** only in code and reports. Values come from Matthew (or the OAuth flow).

## 4. Keep it alive
- Refresh **before** expiry (for example at 80% of the lifetime) under a per-connection lock, so two workers don't both refresh.
- **Always store the newest refresh token** the provider returns (QuickBooks changes it about daily; it has a 100-day idle limit and a 5-year hard cap).
- Refresh fails with `invalid_grant` or 401 → the connection becomes `needs_reconnect`, sync pauses for that tenant (no crash loop), and the owner sees a "Reconnect <provider>" banner. The breaker (I13) keeps calls from piling up.
- Webhook signing secrets rotate with an overlap window (Stripe up to 24 h). Accept both during the overlap.

## 5. Never
Print, log, commit or return a token in an API response. Put tokens in URLs (except the documented webhook-path secret for unsigned providers). Ask for more scopes than the contract needs. Reuse one tenant's credentials for another.

---
Sources (ideas adapted, text ours): QuickBooks OAuth and security requirements (notes/quickbooks.md), Supabase Vault (notes/supabase-vault-cron.md), GHL OAuth docs (research/integration/ghl/oauth, CC0), VoltAgent auth-integration-engineer (MIT), Baseleap secret rules (never select ghl_pit_token).
