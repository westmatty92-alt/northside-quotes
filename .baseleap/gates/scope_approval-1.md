## 🔒 Gate 1 · scope_approval: Northside quote requests v1 (rehearsal)
**Asking:** Is this the right thing to build?
**Recommendation:** Yes, with the PM's 10 "A" defaults below confirmed.

- Scope: 15 stories (8 Must / 4 Should / 3 Could). Spine: homeowner submits with photos → reference number → owner signs in, sees it first in the inbox → price + note → won → weekly count updates. 13 non-goals
- **DECISION:** build mode `hybrid`. Our app (Supabase ca-central-1) is the system of record; GHL test sub-account gets a one-way contact copy tagged `quote-request` that never blocks or loses a request
- **DECISION:** no in-app "reply". No email/SMS is allowed, so the owner replies by phone or text through tap-to-call links (the brief said "replies")
- Team: `full_stack` + integration + docs, all 11 roles. Reason: server-side rules (spam limits, photo checks, reference numbers) and a server-held GHL token with retries need a backend; the rehearsal exercises every role
- Success metric: median hours to first quote, ≤ 24 h target after a 14-day baseline (real client only)
- Cut order if the run overruns: GHL stories first (US-013 → US-009)
- Spend: none at this gate. Accounts come at `account_setup` ($0 limit stands)

**If yes:** the designer starts, then the architect and the SOP plan. Next stop is Gate 2 (blueprint + screens).
**If no:** tell me what to change; the PM revises and I re-ask.

---
### Defaults the PRD already uses (approve = "all A", or reply e.g. "2B")
1. Spam: honeypot + 3-second minimum + 5 submissions / 10 min per network address (no vendor)
2. Photos: optional, up to 3, 5 MB each, JPEG/PNG/WebP
3. Urgency: Emergency / Soon / Flexible
4. Reference: `NQ-` + 6 random characters (e.g. NQ-7K3M9P)
5. Weekly count: Mon–Sun Hamilton time; won/lost counted by status-change date
6. Accounts: created by Baseleap; no password-reset email
7. Notifications: none
8. GHL down: save first, then automatic retry at least every 24 h, up to 5 retries (architect confirms what free hosting can schedule)
9. Metric target: ≤ 24 h after a 14-day baseline
10. Retention: 24 months, then manual purge (wording only matters for a real client)

Parked, not for this gate: architect confirms which GHL fields can carry the reference number and problem text without extra GHL setup; GHL data location is checked before any real client goes live.

Evidence: P0 verified (`check-pm-docs` exit 0). Files: docs/PRD.md, docs/user-stories.md, docs/metrics-spec.md, .baseleap/reports/P0.md.
