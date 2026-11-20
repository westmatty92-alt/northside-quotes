## 🔒 Gate 1 · scope_approval (2nd ask): Northside quote requests v1.1 (rehearsal)
**Asking:** Is this the right thing to build, now with the pipeline board?
**Recommendation:** Yes, with OQ-13A and OQ-14A.

- What changed since your rejection: a pipeline board (US-016, Must) with fixed New / Quoted / Won / Lost columns. Drag a card, or use its "Move to" menu, to change status. A failed save puts the card back. The list view stays as the default
- Stage tags (US-017, Should): every stage change swaps the GHL tag (`quote-new` / `quote-quoted` / `quote-won` / `quote-lost`). Saves first, retries later, never blocks the move. Sits in the GHL cut order
- **DECISION:** build mode `hybrid`. Our app holds every request and all pipelines. GHL test sub-account = website hosting + email marketing only, fed by a one-way contact copy (`quote-request` + stage tag), never authoritative
- Scope: 17 stories (9 Must / 5 Should / 3 Could), 15 non-goals (columns can't be edited or added; no card ordering or swimlanes). Your 10 "A" defaults are written in as decided
- **DECISION:** still no in-app "reply"; the owner replies through tap-to-call
- Team: `full_stack` + integration + docs, all 11 roles. Risk: the board is the biggest Must, so the architect may split it into two build steps
- Spend: none at this gate; accounts at `account_setup` ($0 limit)

**If yes:** the designer starts (screens go in the Gate 2 packet), then the architect and the SOP plan.
**If no:** tell me what to change; the PM revises and I re-ask.

---
### Two new choices (approve = "13A 14A")
- **OQ-13 tags:** A one stage tag at a time, previous removed (recommended) · B keep earlier stage tags · C other names
- **OQ-14 default view:** A List every time (recommended) · B remember each user's last choice · C Board every time

### PM additions beyond your ruling (strike any)
Board shows every request (filter and search stay on the list) · adoption metric "share of moves made on the board" · a "stage tag up to date / waiting / failed" label on the request detail.

Parked for the architect: can the GHL integration add and remove tags, and create a missing tag? (OQ-15; if not, US-017 is cut and nothing else changes.) Also which GHL fields carry the reference number and problem text (OQ-11).

Evidence: P0 re-verified (`check-pm-docs` exit 0), commit bc6a9df. Files: docs/PRD.md (v1.1), docs/user-stories.md, docs/metrics-spec.md, .baseleap/reports/P0.md (Pass 2).
