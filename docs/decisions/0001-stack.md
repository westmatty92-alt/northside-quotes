# 0001 — Stack: house stack confirmed, no deviations

**Status:** proposed
**Date:** 2026-11-19
**Driven by:** PRD Technical considerations, FR-5, FR-9, FR-22 · intake (build mode hybrid, $0 spend, ca-central-1, no Stripe / n8n / Zapier / Make) · ledger rulings of 2026-11-19
**Implemented in:** `supabase/migrations/*` · `docs/openapi.yaml` · `docs/architecture.md` (Modules, Lane ownership)

## Context
Northside quote requests is a small hybrid build: a public quote form with photos, a two-person staff inbox with a list and a board, and a one-way copy of each request to a GoHighLevel test sub-account. Everything must run at $0, keep personal data and photos in Canada, and be buildable by parallel frontend, backend and integration lanes. The house stack already covers every requirement; the question is only whether any PRD requirement forces a deviation.

## Decision
Use the house stack unchanged: one Next.js (App Router, TypeScript strict) app on Vercel, with route handlers under `/api`, Supabase Postgres + Auth + Storage in **ca-central-1** with RLS on every table, Tailwind + shadcn/ui themed from `DESIGN.md`, TanStack Query and an Orval-generated client from `docs/openapi.yaml`. Vercel functions run in `yul1` (Montréal). No Stripe, no n8n, no email or SMS provider, no CAPTCHA vendor, no monitoring SaaS. GoHighLevel is reached server-side over its v2 REST API with a private-integration token (decision 0004).

## Alternatives considered
### Separate worker or queue service for the GHL copy
- **Pros:** precise retry timing, no dependence on Vercel cron.
- **Cons:** a second deployable, a recurring bill or a self-hosted box, more devops.
- **Why not:** the PRD only needs a retry at least every 24 hours; Vercel cron plus `after()` covers it at $0 (decision 0004).

### Supabase Edge Functions for the public submission
- **Pros:** runs next to the database.
- **Cons:** a second runtime and deploy path for the lanes to learn; the spam checks and form token would be split from the Next.js app.
- **Why not:** one deployable is simpler and the request volume (about 200 a month) is tiny.

### Client-only app talking straight to Supabase
- **Pros:** no route handlers.
- **Cons:** spam checks, form-token checks, photo content checks and the GHL token cannot live in the browser.
- **Why not:** FR-6, FR-8 and FR-14 need server code (decision 0002).

## Consequences
- **Easier:** every lane already knows this stack; generated types and mocks work on day one.
- **Harder:** Vercel Hobby limits cron to once per day per job (handled in 0004) and the function request body to 4.5 MB (handled in 0002).
- **Cost:** $0 for the rehearsal. Two cost risks for a real client, both raised as DECISION lines in the A1 report rather than chosen here: Supabase Free has 1 GB of file storage (600 photos a month of 2 to 5 MB each fills it in about a month) and pauses after 1 week of inactivity; Vercel Hobby is for non-commercial use, so a real client needs the Pro plan.
- **Risks:** the Vercel team plan is unverified (account_setup). The design works on Hobby and on Pro; Pro would only allow faster retries.

## Sources
- Vercel functions limits (4.5 MB body, 300 s on Hobby), page dated 2026-08-24: https://vercel.com/docs/functions/limitations
- Vercel cron usage and pricing (Hobby: once per day, per-hour precision, 100 cron jobs per project), page dated 2026-07-15: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Supabase pricing (Free: 500 MB database, 1 GB file storage, 5 GB egress, paused after 1 week of inactivity, 2 active projects; Pro from $25 a month with 100 GB storage), read 2026-11-19: https://supabase.com/pricing
- Next.js `after()` (stable since 15.1, runs after the response within the route's max duration, uses Vercel `waitUntil`), page dated 2026-09-16: https://nextjs.org/docs/app/api-reference/functions/after
