# Intake — Northside Plumbing (TEST) quote requests

Client: Northside Plumbing (TEST), Console id 5998ee79-50f0-4552-b64f-5addcd6277cb, status prospect (created by Matthew).

Status 2026-11-19: Matthew answered all seven forcing questions, but the ledger run has not started. `init --client` was refused: `POST build_plans` returned 401 with an RLS violation. The answers below get recorded as `decision` events (by: matthew) as soon as `init` succeeds.

## Forcing questions: answered by Matthew (relayed), 2026-11-19
1. Done: QA's Playwright E2E passes on the staging preview for this flow: homeowner submits with photos → gets a reference number → owner signs in and sees it at the top of the inbox → adds price + note → marks won → weekly count updates. After Gate 3: production health URL returns 200. Every phase runs for real.
2. Client: Console client 5998ee79-50f0-4552-b64f-5addcd6277cb (`init --client`, not `--new`).
3. Must not change: kit files (`scripts/`, `.claude/`); Baseleap Console DB except ledger writes; any real GHL account (only the GHL test sub-account).
4. Runs on: house stack. Next.js on Vercel, Supabase ca-central-1 with RLS on every table, photos in a private Supabase Storage bucket in ca-central-1.
5. Money and accounts: $0 spend limit; anything paid opens spend_approval. GitHub `westmatty92-alt`, Vercel team `baseleap` (plan unverified; devops to confirm preview protection), new free Supabase project in the sandbox org (final call at account_setup), one GHL private-integration token for the test sub-account (Matthew sets the value; we handle the name only). No email/SMS provider, no CAPTCHA vendor.
6. Iteration budget: 3 attempts per step, then escalate.
7. Build mode: hybrid. Our app is the system of record for quote requests; GHL test sub-account gets a one-way contact copy tagged `quote-request`, and that copy never blocks or loses a request. Full team of 11 roles, including bl-integration and the bl-docs SOP steps.

## Matthew's visibility requests (put into briefs and packets)
- Gate 2 packet includes the designer's mockup screenshots (bl-designer D1 must output rendered screenshots; packet links/embeds them).
- Every verify-phase report includes the staging preview URL (QA, reviewer, security, docs briefs say so).

## For the PM (product questions kept out of intake on purpose)
- Spam protection with no CAPTCHA puzzle: honeypot + time trap + rate limit, vs an invisible challenge (e.g. Turnstile, which needs an outside account; $0 limit applies).
- Photo limits: up to 3, size and type caps, and where the homeowner sees an upload failure.
- Urgency options and what they mean.
- Reference number format shown on the confirmation.
- Weekly count: which week (Mon–Sun, Hamilton time?) and what counts as "won this week" (status change date vs request date).
- Owner and helper have the same rights: how accounts are created (invite only, no public sign-up).
- "No real emails or SMS": confirm v1 sends no notification at all, or only to a test sink.
- GHL push: what happens to the request if GHL is down (request must still save; retry later).
- Cut anything that doesn't fit a day or two of agent work.
