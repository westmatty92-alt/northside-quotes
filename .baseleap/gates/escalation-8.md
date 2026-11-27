## 🛑 escalation: the ledger can't record QA1's verify (kit), plus one amendment to approve
**Asking:** (1) a kit fix so `stack-ledger verify` survives a 15-minute check; (2) approve the FE2V amendment (open scope_decision); then resolve this escalation.
**Recommendation:** Both yes.

1. **Ledger verify dies after long checks.** `stack-ledger verify QA1` ran the full Playwright suite twice and both times ended with `stack-ledger: fetch failed`, recording nothing. Short ledger calls work fine. Unverified cause, two candidates in `scripts/lib/ledger-core.mjs`: `verifyStep` defaults `timeoutMs` to 10 minutes while the suite takes 11–16 (it paces to the 5-per-10-minutes form limit), and/or the ledger's database connection goes stale while the synchronous child run blocks the process. Suggested fix: a per-step or larger timeout, and a fresh connection (or retry) for the write after the run.
2. **FE2V amendment (scope_decision open).** Per your rejection note, FE2's staff-screen visual evidence becomes a QA step on staging signed in with QA's saved session. The ledger can only add steps after Gate 2, so FE2's original local-mock check stays unmet and FE2 will show as not done; FE2V carries its evidence.

Where things are:
- **QA1 re-run on staging 0dff609: 130/130 pass, twice, 0 flaky.** Done spine passes (18.3–18.6 s). BUG-QA1-2..5 resolved (axe clean on staff screens, "Photo unavailable", dialog focus trap, label wording). BUG-QA1-6 (intermittent TLS on direct photo uploads) did not recur in 6 uploads; still monitoring. AC-002.7: 19.4 s vs the 20 s limit (marginal)
- FE2's fixes and the "View photo" wording are merged; designer aligned the spec (D1 re-verified)
- Waiting: QA2, DV1 (visual review), REV1, SEC1, DOC1, then Gate 3. All need QA1 verified first

**If yes:** I re-run QA1's ledger verify, run FE2V and QA2 + DV1, then code review, security and SOPs, and open Gate 3.
