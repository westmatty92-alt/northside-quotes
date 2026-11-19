---
name: be-auth
description: Authentication, authorisation and hardening for bl-backend — Supabase Auth sessions, the permission matrix from SECURITY_MODEL.md enforced in a guard on every route plus RLS underneath, object-level checks against BOLA/IDOR, webhook signatures, rate limits, and secret hygiene. Use for every endpoint; it's the checklist bl-security will review against.
---

# Back-End · Auth & Hardening

`docs/SECURITY_MODEL.md` is the law: its trust boundaries, permission matrix and invariants are what you implement and what `bl-security` checks. Two layers, always — your code checks, and RLS backs it up.

## 1. Authentication (`src/lib/server/auth.ts`)

- `requireSession(req)` gets the Supabase session from cookies (`@supabase/ssr`) — or, on GHL embed routes, from the handoff `SECURITY_MODEL.md` defines (verify its signature; never trust an unsigned location/contact id in the URL).
- Missing or expired → 401. Never fall back to "anonymous with defaults".
- `next/server` middleware may redirect pages, but **API authorisation happens in the handler** (via the guard) — middleware alone is not a security boundary.

**Pattern proven in dry run BE1:** `requireMember(req)` takes the contract's bearer token when an `Authorization` header is present, validated with `auth.getUser(token)` (never just decoded) and used to build a user-scoped client, so RLS applies. Otherwise it reads the session cookie through `@supabase/ssr`, without setting cookies; `src/proxy.ts` refreshes them. It then loads the caller's **active** member row through that same client. No row means 401, so a removed member is locked out at once. Role checks come next, per the permission matrix. Tests call handlers in-process with the bearer token, so no cookies or server are needed.

## 2. Authorisation — every route, every object

- `requireRole(session, ...roles)` enforces the **permission matrix** (role × resource × operation) → 403.
- **Object level (BOLA/IDOR):** any id from the path, query or body is checked against the caller — "does this booking belong to this user's tenant?" Through the user-scoped client RLS answers this; with the service-role client you check explicitly. Not yours → **404**, never 403 (don't confirm it exists).
- **Function level:** admin/staff operations check the role even if the UI hides the button.
- **Mass assignment:** only fields the contract allows are written — the strict Zod schema drops the rest; never spread a request body into an insert.

## 3. Inputs and abuse

- Every input validated (generated Zod); sizes bounded (strings, arrays, uploads).
- Rate limits on sign-in, public forms, and anything that sends email/SMS or costs money (per `SECURITY_MODEL.md`) → 429 + `Retry-After`.
- Webhooks (`/api/webhooks/*`): verify the provider signature on the **raw body** before parsing (Stripe `constructEvent`; GHL as documented), reject old timestamps, process idempotently by event id.
- CORS: same-origin by default; embed routes follow the architect's `frame-ancestors` decision — never `*`.

## 4. Secrets and data exposure

- Secrets only from server env vars, read in `src/lib/server/env.ts` with a schema; never `NEXT_PUBLIC_*`, never logged, never in error responses or test fixtures.
- The service-role key is imported only in the files `SECURITY_MODEL.md` lists.
- Responses contain only contract fields; errors never leak SQL, stack traces or internal ids.
- Personal data only as `docs/metrics-spec.md` and the PRD allow; not in logs.

## 5. Prove it (in `be-testing`)

For every protected operation, integration tests for: no session → 401 · wrong role → 403 · another tenant's id → 404 · extra/forbidden field ignored or 422 · webhook with a bad signature → 400/401 and nothing written.

---
Sources (ideas adapted, text written for Baseleap): charlieviettq/awesome-agent-skill `api-security-testing` (MIT — horizontal/vertical authorisation, IDOR, input abuse, data exposure matrix), trilwu/secskills (MIT — server-side auth and crypto review), secondsky/claude-skills `api-authentication` (MIT), VoltAgent `backend-developer` (MIT — OWASP, rate limiting, audit logging), getsentry/skills `security-model` (Apache-2.0).
