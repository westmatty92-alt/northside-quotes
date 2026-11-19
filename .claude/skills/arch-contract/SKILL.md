---
name: arch-contract
description: API contract design for bl-architect — write docs/openapi.yaml (OpenAPI 3.1) as the single source of truth both developers build against in parallel, with house conventions for naming, errors, pagination and auth, story traceability, lint, and a mock server the frontend can use on day one. Use after the data model.
---

# Architect · API Contract

`docs/openapi.yaml` is how frontend and backend agree without ever talking. If it's precise, Phase 2 runs in parallel with no integration surprises. If it's vague, both sides guess differently and QA finds out in Phase 3.

## 1. What goes in the contract

Every operation the screens need — nothing more. Walk `docs/user-flows.md` screen by screen: for each data need, there's an operation (or it's served directly by Supabase — see §5).

Every operation has: `operationId` (camelCase verb+noun, e.g. `listBookings`), `summary`, `tags`, parameters with types and constraints, request body schema, **every** response code it can return with a schema, `security`, and an `example`.

**Traceability:** every operation carries `x-stories: [US-003, US-004]`. Every Must story that needs data appears in at least one operation's `x-stories` — or is listed in `docs/architecture.md` under "Stories served without the API" with the reason.

## 2. House conventions (one decision record if you deviate)

| Topic | Convention |
|---|---|
| Paths | plural nouns, no verbs: `/api/bookings`, `/api/bookings/{id}`; actions that aren't CRUD as sub-resources: `/api/bookings/{id}/cancel` (POST) |
| JSON fields | `snake_case` (matches Postgres and Supabase types) |
| IDs | `string` `format: uuid` |
| Money | integer cents + `currency` (ISO 4217) |
| Time | `string` `format: date-time`, UTC, ISO 8601 |
| Errors | `application/problem+json` (RFC 9457): `type`, `title`, `status`, `detail`, plus `errors[]` with `field` + `message` for 422 validation |
| Status codes | 200/201/204 · 400 malformed · 401 no session · 403 wrong role · 404 not found *or not yours* (don't leak existence) · 409 conflict · 422 validation · 429 rate-limited |
| Pagination | cursor-based on every list: `?cursor=&limit=` (default 20, max 100) → `{ data: [], next_cursor: string \| null }` |
| Auth | `bearerAuth` (Supabase session JWT); GHL-embedded routes as defined in `docs/SECURITY_MODEL.md`. Pre-session routes (sign-in, callback) live under `/auth/*` with `security: []` and a rate-limit note, or as Server Actions documented in architecture.md |
| Versioning | single first-party consumer → no URL version; changes after Gate 2 are **additive only** unless a superseding decision record says otherwise |
| Webhooks in | (Stripe, GHL) documented as operations under `/api/webhooks/*` with signature verification noted |

## 3. Schemas

- All reusable shapes in `src/components/schemas`; requests and responses `$ref` them.
- Constraints on every field: `required`, `minLength`/`maxLength`, `minimum`/`maximum`, `pattern`, `enum` — the same rules as the DB constraints (and the PRD's acceptance criteria).
- `additionalProperties: false` on request bodies.
- Response schemas match what the migrations can actually produce — no field the database doesn't have.

## 4. Verify (the step's checks)

1. `npx @redocly/cli lint docs/openapi.yaml` — zero errors.
2. Mock server boots from the contract: `npx @stoplight/prism-cli mock docs/openapi.yaml` (the frontend develops against this in Phase 2).
3. Traceability check: every Must data story is in `x-stories` or listed with a reason.
4. Generated types compile (see `arch-structure`).

## 5. When Supabase serves data directly

Simple per-user reads/writes protected by RLS may go straight from the client to Supabase (no route handler). Allowed only when: the table's RLS fully expresses the rule, no secret or third-party call is involved, and no business logic runs. List each such table in `docs/architecture.md` ("Direct Supabase access") — the contract then covers everything else. When in doubt, put it in the API.

**Errors every contract needs** (from dry run BE1): a `500` response with a problem `code` of `internal_error` in the enum, so unexpected failures still match the contract. And say what an undefined method returns (405 problem+json); Next returns a bare 405 unless the backend adds a handler for it.

## 6. Integration contract (`platform_extension` and `hybrid` only)

The PRD's `build_mode` decides this. In those two modes, **and in `custom` mode whenever the PRD names an external provider that needs a webhook, sync, OAuth or more than one call** (Stripe payments, QuickBooks, a POS), you also write `docs/integration-contract.md`. The ledger refuses any `integration` step that doesn't depend on it from `templates/integration-contract.md`. It's locked at Gate 2 with the API contract, before any frontend, backend or integration step starts.

- **No sync in v1 is a valid answer.** Write "None in v1 — <reason>" under Field mapping instead of a table, and keep the other sections (outage behaviour still covers any outside service v1 uses, such as the email provider). Record deferred designs separately, clearly marked not built.
- **One system of record per record type.** The copy never wins.
- **Every mapped field has a direction:** `in`, `out`, `both` or `read-only`. A `both` field needs a written conflict rule. "Sync everything both ways" is not a design.
- **Every inbound event has an idempotency key and a signature check.** Every outbound create has an idempotency key.
- **Outage behaviour per situation:** timeout or 5xx, revoked token, missed webhook. Say what users see and what the system does.
- **Credentials:** auth type, least-privilege scopes, stored in Supabase Vault, env var names only.
- **Platform setup is a handoff list for CRM Automation** (custom fields, workflows, tags). You never assume it exists.
- Read the platform's current API docs before writing it (Context7 or web). For Monday/HubSpot, read the action/trigger docs Matthew uploaded for that client.
- Tables the integration needs (`integration_events` with a unique provider event id, `sync_state`, `jobs`) are your migrations, with RLS like every other table.

`bl-integration` builds from this file. When there's only one outbound call, `bl-backend` does.

In `in_platform` mode you aren't dispatched at all (CRM Automation does the build).

## 7. After Gate 2

The contract is locked. A specialist's contract question comes to you as a reopened step (before lock) or an amendment step (after lock). Answer by editing the contract **additively**, updating `x-stories`, regenerating types, and noting the change in your report.

---
Sources (ideas adapted, text written for Baseleap): Jeffallan/claude-skills `api-designer` (MIT — OpenAPI 3.1, RFC 7807/9457 errors, cursor pagination, Redocly lint + Prism mock, MUST/MUST-NOT rules), Intense-Visions/harness-engineering `api-openapi-design` (MIT — naming and validation rules), jeremylongshore/claude-code-plugins-plus-skills `generating-api-contracts` (MIT — field-level constraints, every status code documented, spec-code drift checks).
