---
name: be-contract
description: Contract implementation for bl-backend — build each route handler in src/app/api exactly as docs/openapi.yaml defines it, validating every input with the Orval-generated Zod schemas, returning only documented shapes and status codes, and errors as problem+json. Use for every endpoint step.
---

# Back-End · Contract Implementation

The frontend built against `docs/openapi.yaml` without ever talking to you. Your job is to make every operation behave exactly as written — same paths, same shapes, same status codes — so integration in Phase 3 is uneventful.

## 1. One operation = one handler, thin

`src/app/api/<resource>/route.ts` (template: `templates/route.ts`). A handler does five things, in order, and nothing else:
1. **Authenticate** — `requireSession()` (see `be-auth`); 401 if none.
2. **Parse & validate** — path params, query and body with the **generated Zod schema** for that operation (`src/lib/api/generated/*.zod.ts`). Never hand-write a schema that the contract already defines. Reject unknown fields (`additionalProperties: false` → `.strict()`).
3. **Call one service function** from `src/lib/server/services/` (see `be-services`) — the handler holds no business rules.
4. **Shape the response** to the contract's schema — no extra fields, no internal columns (`operator_id`, internal flags) unless the contract lists them.
5. **Map errors** to the contract's status codes as `application/problem+json`.

**Unknown fields:** Orval's generated Zod object schemas let unknown keys through by default, even when the contract says `additionalProperties: false`. Parse request bodies and queries with `schema.strict()` so an unexpected field gets 422 naming it. Dry run BE1 relied on this to refuse the planted `estimated_minutes` field.

## 2. Status codes (as the contract defines — no improvising)

| Situation | Code |
|---|---|
| created | 201 (+ `Location` when the contract says) · read/update 200 · delete/no body 204 |
| malformed JSON / wrong type | 400 |
| no or expired session | 401 |
| signed in but role not allowed | 403 |
| not found **or not yours** (never reveal another tenant's record exists) | 404 |
| state conflict (slot taken, stale update, duplicate) | 409 |
| validation failed | 422 with `errors[]` of `{ field, message }` |
| rate-limited | 429 with `Retry-After` |
| unexpected | 500 with a generic `title` and a `request_id` — never a stack trace or SQL error |

An outcome the contract doesn't list is a **CONTRACT QUESTION**, not a new status code.

## 3. Errors as problem+json

One helper (`src/lib/server/http.ts`, owned by your first step) builds every error: `type` (stable URI-ish string per error kind), `title`, `status`, `detail` (safe for the user to read), `errors[]` for 422, `request_id`. The frontend branches on `status` and `type`, never on the message text.

## 4. Lists

Cursor pagination exactly as the contract: `?cursor=&limit=` (default 20, max 100) → `{ data, next_cursor }`. Cursors are opaque (encode the sort key + id); never offset-based for growing tables.

## 5. Contract conformance is tested, not assumed

Every handler's integration test validates the **response** against the generated Zod schema for that operation and status (`be-testing`). A response that doesn't match the contract is a failing test, even if the frontend "would probably cope".

## 6. Don't change the contract

You don't edit `docs/openapi.yaml`, `orval.config.ts`, generated files or migrations. If the contract can't be implemented as written (missing field, a rule the schema can't express, an impossible status), stop that part and raise a **CONTRACT QUESTION** with the suggested change; build the rest.

---
Sources (ideas adapted, text written for Baseleap): Jeffallan/claude-skills `api-designer` (MIT — status semantics, RFC 9457 errors, validation), VoltAgent/awesome-claude-code-subagents `backend-developer` (MIT — contract alignment and standardised errors before an endpoint is done), Baseleap house conventions from `arch-contract`.
