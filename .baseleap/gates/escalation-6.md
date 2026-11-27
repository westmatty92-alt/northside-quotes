## 🛑 escalation: INT2 can't get the backend code it needs (integration has no lane)
**Asking:** One kit decision so INT2 (the two GHL routes) can run; then resolve.
**Recommendation:** Option A: in the kit, give integration steps the backend lane (`LANE_OF.integration = 'wt-backend'` in `scripts/lib/ledger-core.mjs`, plus the matching scope/hook paths).

Why: the ledger puts integration steps in the main tree (no lane), and `lane sync` only merges *into* lanes; nothing ever merges into `main` (by design). INT2's routes need the backend's `env.ts`, `http.ts` and `requireStaff`, which live in `lane/backend` and now `staging`, never `main`. So INT2 can't build in its checkout, and QA1 depends on INT2.
- **A (recommended):** integration shares the backend lane. Its code is server code under `src/lib/server/**` and `src/app/api/**` anyway; INT1's work already reached that lane via `lane sync backend --from main`.
- **B:** allow `lane sync main --from staging` (local `main` only, never pushed; command-guard still blocks pushes to main). Smaller change, but it bends the "nothing merges into main" rule.
- **C:** I amend the plan to give the two routes to bl-backend (opens a scope_decision; the integration engineer's lane rules stay as they are).

Progress (all environment blockers cleared, no failures recorded):
- Wave 1–3 done and verified by the ledger: OPS1, INT1 (99 tests incl. 12 on staging), BE1 (184), BE2 (168), BE3 (258), FE1 (63 + verify-ui), FE2 (139 + verify-ui, 90 files), FE3 (26 + verify-ui), A2 re-verified with build fixes
- Lanes synced from main and merged into `staging` with no conflicts: `staging` = 21354ab, pushed (Vercel preview builds from it)
- Rulings: 401 not 403 for non-staff (contract wins); no mock-mode bypass in the auth proxy (security), so staff pages are proven by QA on the preview, not by mock screenshots after merge
- Known follow-ups for the verify phase: button "Saving" state is 22 px, not 44 px (shared ui file); first-load JS likely over the 170 kB gzip budget (unmeasured); real-browser drag and dialog checks go to QA; CI api-tests should run the GHL DB tests; account-setup Part 7 text is stale

**If yes (A or B):** I run INT2, merge it to staging, then QA1 → QA2 + visual review → code review, security, SOPs, and stop at Gate 3.
**If C:** say so and I open the plan amendment (scope_decision) instead.
