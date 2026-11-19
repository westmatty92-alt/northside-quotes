---
name: fe-api
description: API integration for bl-frontend — consume docs/openapi.yaml only through the Orval-generated client, hooks, Zod schemas and MSW mocks; own the single fetcher (base URL, auth, problem+json errors); build against mocks until the backend lands, then switch with no code change; raise contract questions instead of working around gaps. Use for every step that touches data.
---

# Front-End · API Integration

You and the backend never talk — you both build against `docs/openapi.yaml`. If you only use what's generated from it, integration in Phase 3 is a base-URL change.

## 1. The generated layer (never edit it)

`npm run gen:types` (the architect's scaffold script) runs Orval and produces, in `src/lib/api/generated/`:
- **typed fetchers and TanStack Query hooks** per operation (`useListBookings`, `useCreateBooking`)
- **models** (TypeScript types) under `generated/model/`
- **Zod schemas** (`*.zod.ts`) for runtime validation
- **MSW handlers** with realistic data from the contract's examples

If any of it looks wrong, the contract is wrong — raise a contract question. If `git diff` shows generated files changed without a contract change, something edited them by hand — revert it.

## 2. The one file you write: `src/lib/api/fetcher.ts`

Orval's generated code calls this mutator for every request. It:
- prefixes the base URL (`/api` — same origin, works on previews and inside the GHL iframe)
- attaches auth the way `docs/SECURITY_MODEL.md` says (Supabase session; the embed handoff for GHL routes)
- passes the abort `signal` through
- turns non-2xx responses into a typed `ApiError` carrying the `problem+json` body (`type`, `title`, `status`, `detail`, `errors[]`)
- **validates successful responses with the operation's Zod schema** — a response that doesn't match the contract throws a clear error in development and is reported, not silently rendered

## 3. Mocks first, real API later — same code

- Until the backend lane merges, run against the generated **MSW handlers** (`src/mocks/`, enabled by `NEXT_PUBLIC_API_MOCKING=on`). Never stub responses inside components.
- Mock every state: success, empty list, 401, 403, 409, 422, 500 and slow responses — override handlers per test or per story to reach each designed state.
- Switching to the real backend = turning mocking off. If that needs a code change, the code was coupled to the mock — fix that.

## 4. Contract discipline

- Use only operations, fields and status codes in the contract. **A field you need but don't have → CONTRACT QUESTION** (in your report): what, why, which operation, suggested shape. Keep building the parts the question doesn't touch; don't fake the field.
- Never parse error message strings — branch on status and `type`.
- Dates arrive as ISO strings (UTC): format for display in the client's locale (`en-CA`), never compute business rules from them client-side.
- Money arrives as integer cents + currency: format with `Intl.NumberFormat`, never do arithmetic that the server should own.

## 5. Every data-bearing view handles every state

Loading → skeleton; empty → the designed empty state; error → designed error with retry; partial or stale → as the state matrix says. Each is reachable with the MSW overrides and covered by a component test (`fe-verify`).

---
Sources (ideas adapted, text written for Baseleap): orval-labs/orval (MIT — React Query hooks, Zod, MSW mocks and a custom mutator generated from OpenAPI), leejpsd/typescript-react-nextjs-patterns `data-fetching-and-api-types` (MIT — runtime validation of every response, typed errors, pagination), tanstack-skills/tanstack-skills (MIT), Baseleap contract rules from `arch-contract` (problem+json, cursor pagination, cents, UTC).

## Proven in dry run FE1
- **Mocking flag at runtime.** `NEXT_PUBLIC_*` values are frozen into the bundle at build time. Read `NEXT_PUBLIC_API_MOCKING` on the server in the `(app)` layout, validate it (`on`/`off`, otherwise off) and pass it down, so one build runs with mocks on or off. With mocking off, no MSW code loads.
- **`fetcher.ts` throws `ApiProblem` on every non-2xx**, including a 500 without problem+json. The scaffold stub resolved that as data. Keep the raw body so a 409's `current` can be read.
- **Check responses with the generated Zod schemas** in the query's `select`. A body that breaks the contract shows the "can't load" state instead of crashing.

