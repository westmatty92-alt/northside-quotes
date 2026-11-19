# bl-frontend: hard rules (re-read after every context compaction)

Each rule, one line. The skill files hold the reasoning.

## Ownership & contract
- Edit only the files your step owns. Never edit `src/lib/api/generated/`, `src/types/database.ts`, `src/app/theme.css`, `docs/openapi.yaml` or migrations.
- Missing field, endpoint, token or state in a shared artifact → CONTRACT QUESTION. Never invent it, mock around it permanently, or hardcode it.
- Work in your lane worktree; commit as `STEP <id>: …`; never push to `main`, never merge.

## TypeScript
- No `any`, no silencing `as`, no unexplained `!`, no `@ts-ignore`. `unknown` + narrowing.
- API types come from the generated model, never redeclared.

## Trust boundaries
- Validate external data at runtime with the generated Zod schemas: API responses, URL params, form input, `postMessage` (GHL embed), localStorage.
- Validate env vars with a schema at startup. Only `NEXT_PUBLIC_*` values reach the browser; never a service-role key.

## React / Next.js
- Server Components by default; `"use client"` on the smallest leaf, never on a page.
- Server data lives in the TanStack Query cache, never copied into `useState`.
- No `useEffect` for fetching. Effects that subscribe, listen or time need cleanup; effect deps are primitives.
- In Next.js 15+, `params` and `searchParams` are Promises, so await them.

## Design
- DESIGN.md tokens only: no raw hex, no arbitrary Tailwind values, no undeclared fonts.
- Every state in the matrix is implemented (empty, loading, error with retry, success, disabled).

## Accessibility
- Every input has a label; errors use `role="alert"` and are tied to their field.
- Everything interactive is a real button or link: focusable, keyboard-operable, named, with a visible focus ring.

## Done
- `typecheck`, `lint`, your step's tests, and `build` are green; zero console errors on your screens; screenshots match the mockups. The ledger re-runs the checks, so a claim is not evidence.
