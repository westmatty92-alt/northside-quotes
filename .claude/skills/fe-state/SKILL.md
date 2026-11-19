---
name: fe-state
description: State management for bl-frontend — decide where each piece of state lives (server cache via generated TanStack Query hooks, URL, form, or small client state), handle mutations with invalidation and optimistic updates, and build forms with react-hook-form plus the generated Zod schemas. Use whenever a screen reads, changes or remembers data.
---

# Front-End · State

Most state bugs are state in the wrong place. Decide the home for each piece of state before writing the component.

## 1. Where state lives

| Kind | Home | Example |
|---|---|---|
| **Server data** | TanStack Query cache via the **generated hooks** (`useListBookings`, `useCreateBooking`) | bookings, slots, the user's profile |
| **Shareable view state** | the URL (`searchParams`) | filters, sort, page cursor, selected tab, open record id |
| **Form input** | `react-hook-form` | the booking form while it's being filled |
| **Local UI state** | `useState` in the component that needs it | a dropdown open, a hover |
| **Cross-component UI state** | React context scoped to the feature, or a small Zustand store when context re-renders hurt | multi-step wizard progress |

Rules:
- **Never copy server data into `useState`.** Read from the query; derive what you need during render.
- If refreshing the page should keep it (filters, the page you're on), it belongs in the URL.
- Global stores are the last resort — and never hold server data.

## 2. Queries

- Use only the generated hooks (from `src/lib/api/generated/`). No hand-written `fetch` in components, no `useEffect` fetching.
- Query keys come from the generated helpers; they include every parameter that changes the result (tenant, filters, cursor).
- `staleTime` per data type, set once in the query client defaults with per-query overrides only when a screen needs fresher data. Retries: default for reads, **no automatic retry for mutations** that cost money or send messages.
- Pagination: cursor-based, matching the contract (`next_cursor`) — infinite queries for feeds, explicit pages for tables.
- On sign-out or account switch, clear the query cache (private data must not leak between sessions — matters in shared GHL browsers).

## 3. Mutations

- After a mutation, invalidate exactly the queries it changes (or update the cache from the response).
- **Optimistic updates only where the design spec says so** and the rollback is designed: snapshot → update → on error restore and show the designed error state.
- Disable the submit control while pending; ignore double-submits (the backend is idempotent, but the UI shouldn't rely on it).
- Map API errors by status: 401 → session-expired flow, 403 → no-permission state, 409 → the designed conflict state ("slot just taken"), 422 → field errors from `problem+json.errors[]` onto the form.

## 4. Forms

- `react-hook-form` with `zodResolver(<generated schema>)` — the same rules as the contract and the database, so the client can't drift.
- Labels visible, errors next to fields and announced (`role="alert"`), validation on blur and submit.
- Server-side errors (422) are applied with `setError` on the matching fields; anything unmapped shows as a form-level error.
- Never trust the client check: the server validates again (backend lane).

---
Sources (ideas adapted, text written for Baseleap): tanstack-skills/tanstack-skills (MIT — query, mutation, router, form patterns), sickn33/agentic-awesome-skills `tanstack-query-expert` (MIT — custom hooks, typed keys, optimistic updates with rollback, clear private caches on account change), leejpsd/typescript-react-nextjs-patterns `state-management`, `forms-and-validation` (MIT — where state lives, react-hook-form + Zod), mindrally/skills (Apache-2.0 — URL state).
