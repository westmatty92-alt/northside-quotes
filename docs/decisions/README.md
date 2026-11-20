# Decisions index

Intake and scope decisions for this build (build mode hybrid, $0 spend, ca-central-1, two equal staff users, spam and photo rules, stage tags, and the 2026-11-20 rulings 1B consent, 2A one contact per homeowner, 3A passwords, 4A sign-in limits and the Requests and Pipeline tabs) are ledger decisions copied into `docs/PRD.md` v1.2; they are locked and not repeated here. The records below are the architect's, numbered from 0001 because no intake record files exist in this folder.

| Number | Title | Status | Date |
|---|---|---|---|
| 0001 | [Stack: house stack confirmed, no deviations](0001-stack.md) | proposed | 2026-11-19 |
| 0002 | [Public submission in two calls, photos uploaded straight to private Storage](0002-public-submission-and-photo-upload.md) | proposed | 2026-11-19, revised 2026-11-20 (offers choice, spam event cap) |
| 0003 | [Staff sign-in through our server, 7-day sessions enforced in the database, writes through RPCs](0003-staff-auth-sessions-and-writes.md) | proposed | 2026-11-19, revised 2026-11-20 (sign-in limits per email and address, no password reset path) |
| 0004 | [GHL contact copy and stage tags: job table, inline first try, cron retries that fit Vercel Hobby](0004-ghl-sync-and-retry-schedule.md) | proposed | 2026-11-19, revised 2026-11-20 (consent gate, contact match rule, `rejected`, 400) |

Status moves from `proposed` to `locked` when Matthew approves Gate 2. A locked record changes only through a new record that supersedes it.
