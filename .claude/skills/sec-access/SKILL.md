---
name: sec-access
description: Access-control audit for bl-security — verify the permission matrix in SECURITY_MODEL.md is enforced in code and in the database — every route authenticates and authorises, every object id is tenant-checked (BOLA/IDOR), RLS is enabled and forced with correct policies on every table in the executable SQL, the service-role key stays in its allow-list, sessions/JWTs and the GHL embed handoff are verified, and CORS/CSP/frame-ancestors are tight. Use on every security-review step.
---

# Security · Authentication, Authorisation & Tenant Isolation

Broken access control is the most common way a client's data reaches the wrong person. Check it in two places, because either alone can fail: the code, and the database.

## 1. Build the route map

For every route and server action in the diff (and any route whose service changed): method + path · who may call it (security model) · where auth is checked (`requireSession`/`requireRole` line) · which client queries data (user-scoped or service-role) · how each object id from the request is scoped. A row with an empty cell is a finding.

## 2. In the code

- **Authentication** on every route except those the security model marks public (health, webhooks — which must verify signatures instead).
- **Authorisation** per the matrix: role checks match the matrix exactly; admin/staff operations check the role server-side.
- **Object level (BOLA/IDOR):** every id from path/query/body is scoped to the caller — through RLS (user-scoped client) or an explicit tenant filter (service-role client). Not-yours must return **404**, not 403 or data.
- **Mass assignment:** writes use strict schemas; ownership fields (`operator_id`, `role`, `status`, prices) are set server-side, never from the body.
- **Service role:** imported only in the files the security model lists; every query through it filters by tenant explicitly.

## 3. In the database (the executable SQL in `supabase/migrations/`)

- Every table: `enable row level security` **and** `force row level security`; no table without policies (or an explicit "service-only" note in the security model). **Check each new table for both lines by name**; a new table without `force`, or with write policies that don't tie the row to an in-org parent (a child row whose `job_id`/`parent_id` isn't checked against the caller's org), is **Critical** (cross-tenant write), not Important. (Drill, Nov 18 2026: `job_photos` without `force` and with org-only write policies was rated Important and the missing `force` wasn't named.)
- Policies cover each operation (`select`, `insert`, `update`, `delete`) with `using` **and** `with check` where rows are written — `with check` missing on update lets a user move a row into another tenant.
- Policies compare against `auth.uid()` / the tenant mapping, not against something the client controls (a column the user can update, a JWT claim the user can set via `user_metadata`).
- `security definer` functions set `search_path` and check the caller themselves; grants to `anon`/`authenticated` are deliberate.
- Storage buckets: private unless the PRD says public; bucket policies scoped by tenant path.
- The architect's RLS tests (`supabase/tests/rls/*`) exist for each new table and pass.

## 4. Sessions, tokens and the embed

- Supabase session read server-side from cookies; no tokens in `localStorage` for server auth; cookies `HttpOnly`, `Secure`, `SameSite` as the security model says.
- JWT checks: signature, expiry and audience verified by the library, not decoded by hand.
- **GHL embed handoff:** location/contact ids arrive signed and the signature is verified server-side before any data is shown; `frame-ancestors` allows only the GHL domains in the decision record; no `X-Frame-Options: ALLOWALL`.
- CORS same-origin by default; CSP present and not `unsafe-eval`.
- Rate limits exist on the operations the security model lists.

## 5. Prove the important ones

For each Critical you suspect, show it concretely: the request a tenant-B user would send and why it succeeds (from the code path), or a query showing a table without RLS on the staging branch (read-only). QA's permission probes (`docs/qa-reports/latest-run.md`) are supporting evidence — not a substitute for reading the code.

---
Sources (ideas adapted, text written for Baseleap): charlieviettq/awesome-agent-skill `api-security-testing` (MIT — BOLA/IDOR, missing permission middleware, session/CORS misconfiguration), secondsky/claude-skills `api-authentication` (MIT; the blueprint's `access-control-rbac` doesn't exist in that repo), getsentry/skills `security-model` (Apache-2.0 — trust boundaries and invariants), Supabase RLS documentation (force RLS, `with check`, `security definer` search_path).
