---
name: arch-reliability
description: Scalability, reliability and observability planning for bl-architect — size the system to the PRD's real volumes, decide what runs inline vs in the background within Vercel's limits, design for third-party failure, and specify health, logging and error tracking. Use in the blueprint step; results go in docs/architecture.md.
---

# Architect · Scale, Reliability & Observability

Design for the volumes in the PRD, not for imaginary millions. But design every third-party call as if it will fail — because Stripe, GHL and email providers all do, at the worst time.

## 1. Size to real numbers

From the PRD's technical considerations and metrics spec, fill the capacity table in `docs/architecture.md`: rows per year per table, requests per day, peak concurrent users, largest list a screen shows. Then check:
- Every list is paginated (contract) and every list query has an index (`arch-data`).
- Nothing loads "all rows" — no unbounded queries, no N+1 loops over related records.
- At the stated volumes, the Supabase plan in use is enough. If not → decision record + spend flag.

Don't add caching, queues or read replicas without a number from this table that needs them.

## 2. Inline vs background

Vercel functions have a maximum duration (the house project runs with a 300 s cap). Rules:
- **Inline** (in the request): anything the user waits for that finishes in a few seconds.
- **Background**: anything slow, retried, or scheduled — syncing to GHL, sending batches, generating reports, AI jobs over many items. Options in order of preference: Supabase (cron / queue table + scheduled function), Vercel cron for scheduled work, n8n when the work is really a business workflow. Each background job is idempotent and records its status in a table the UI can show.
- Long-running agents or jobs beyond the function cap need a worker outside Vercel — that's a decision record and a spend gate, never an accident.

## 3. Third-party failure

For each integration (Stripe, GHL, email/SMS, AI model):
| Question | Answer goes in architecture.md |
|---|---|
| What does the user see if it's down? | a state the UI shows (designer has the error states) |
| Is the local action kept? | e.g. booking saved, sync retried later |
| Retry policy | exponential backoff, max attempts, then visible "needs attention" |
| Idempotency | key per operation so retries never double-charge or double-send |
| Rate limits | their limits vs our peak; queue if we could hit them |

## 4. Observability

Specify in `docs/architecture.md`:
- `GET /api/health` (scaffolded) — devops and QA rely on it; add dependency checks only if cheap.
- **Structured logs** with `request_id`, route, operator id, outcome — never secrets, tokens or personal data.
- **Error tracking:** Vercel logs by default; Sentry or similar only with a spend gate.
- **Analytics events** exactly as `docs/metrics-spec.md` defines (owned by the PM; you decide where they're stored).
- **Audit trail** for money, permissions and deletions when the PRD needs it: append-only table, never updated.

## 5. Failure recovery

For each Must flow, one line in the architecture doc: what happens on partial failure and how it's repaired (retry, reconcile job, manual "needs attention" list). If the answer is "data could be lost or doubled" — redesign before Gate 2.

---
Sources (ideas adapted, text written for Baseleap): OneWave-AI `database-schema-designer` (MIT — no unbounded queries, index-backed lists), Jeffallan/claude-skills `api-designer` (MIT — rate limiting and pagination as contract rules), getsentry/skills (Apache-2.0 — observability without leaking sensitive data). borghei `system_design_workflows` reviewed for ideas only (Commons Clause). Baseleap platform constraint: Vercel function duration cap (Pro, 300 s).
