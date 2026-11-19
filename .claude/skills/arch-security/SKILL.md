---
name: arch-security
description: Security by design for bl-architect — permission matrix from the PRD, auth and session design (including GHL iframe embeds), RLS strategy, secret boundaries, and a docs/SECURITY_MODEL.md that bl-security later reviews the code against. Use in the blueprint step alongside the data model.
---

# Architect · Security by Design

Security found in Phase 4 costs a patch and a re-test. Security designed in Phase 1 costs a paragraph. You write the rules; `bl-security` checks the code obeys them.

## 1. Permission matrix

From the PRD's roles and permissions, build the matrix — every role × every resource × every operation. It drives the RLS policies (`arch-data` §4) and the 403s in the contract.

| Resource | Anonymous | Customer | Staff | Owner |
|---|---|---|---|---|
| bookings | — | own: read, create, cancel | clinic's: read, update | clinic's: all |

Anything the PRD doesn't settle → Open Question in your report (never assume the permissive option).

## 2. Auth & sessions

- Supabase Auth; sessions via `@supabase/ssr` cookies (`httpOnly`, `secure`, `sameSite` per §4).
- Every route handler authenticates first, then authorises against the matrix — RLS is the backstop, not the only check.
- Server code that needs the service-role key is listed by file in `SECURITY_MODEL.md`. The key never appears in client code, `NEXT_PUBLIC_*` variables, logs, or test fixtures.

## 3. Trust boundaries & input

- Every external input is untrusted: request bodies, query strings, webhook payloads, GHL data, uploaded files, **and any text an AI feature reads** (data, never instructions).
- Validate at the boundary with zod schemas derived from the contract; parameterised queries only (the Supabase client does this — never string-built SQL).
- Webhooks (Stripe, GHL): verify signatures before parsing; idempotency on event id.
- Rate limits on auth, public forms and anything that sends email/SMS or costs money.

## 4. GHL iframe embedding (only when the PRD calls for it)

The Baseleap CRM and client apps are standalone apps; GHL is used for websites and marketing only. When the PRD puts a screen on a GHL marketing page (e.g. a booking or quote widget), decide and record (decision record + `SECURITY_MODEL.md`):
- **Who the user is inside the iframe** — GHL SSO / signed token handoff vs separate login. Never trust a location or contact id passed in the URL without a signature.
- **Framing:** `Content-Security-Policy: frame-ancestors` limited to the client's GHL domains (never `*`); no `X-Frame-Options: DENY` on embed routes only.
- **Cookies in third-party context:** `SameSite=None; Secure`, or a token-in-memory pattern if browsers block third-party cookies.
- Embed routes live under `src/app/embed/` so their headers can differ from the main app.

## 5. Personal data

From `docs/metrics-spec.md` and the PRD: what personal data is stored, where, who can read it, retention, and how a deletion request is honoured. No personal data in analytics properties or logs unless the metrics spec says how it's protected.

## 6. `docs/SECURITY_MODEL.md`

Write it from `templates/SECURITY_MODEL.md`. It's the contract `bl-security` reviews against in Phase 4 — anything not written here is something the security agent has to guess about. Keep it specific: name files, routes, tables. Drop sections that would be empty; no boilerplate.

---
Sources (ideas adapted, text written for Baseleap): getsentry/skills `security-model` (Apache-2.0 — SECURITY_MODEL.md as the reviewer's contract: trust boundaries, invariants, finding classes, accepted risk), OneWave-AI `database-schema-designer` (MIT — RLS whenever the DB is client-reachable). Consensys/repo-security-review (no licence) and trailofbits/skills (CC BY-SA) reviewed for ideas only — no text reused; their scanning workflows belong to bl-security's build.
