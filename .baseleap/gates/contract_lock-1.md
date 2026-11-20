## 🔒 Gate 2 · contract_lock: Northside quote requests (rehearsal)
**Asking:** Lock the blueprint (screens, schema + RLS, API contract, integration contract) and the build plan?
**Recommendation:** Yes.

- Screens: 8 screens, 50 renders in the Northside brand (Harbour Teal, Copper, Barlow + Source Sans 3, wordmark); Requests and Pipeline are separate tabs; unticked offers box on the form
- Data: 10 tables, RLS enabled and forced; 8 migrations applied on staging; 16 pgTAP files / 346 assertions pass on staging
- API: 15 operations, lint clean, mock serves the contract; Orval client and types generated from staging
- Integration (hybrid): our app is the record; one-way GHL contact copy + one stage tag, only when the homeowner ticks offers; one contact per homeowner; save first, daily retries; failures never block a request
- Security: threat model APPROVED after 3 rounds (2 Critical, 5 Important fixed); open Minors SEC-21/22/24 go to SEC1
- **DECISION:** staging-only keys + QA test logins on this machine (you approved Nov 20); never production keys
- **DECISION (real client only):** photos fill Supabase Free's 1 GB in ~1 month at 600/month → Supabase Pro $25/mo or in-browser photo shrinking; Vercel Hobby is non-commercial → Pro needed before a real client goes live
- Build: 16 steps in 8 waves (below); first release = drills (release, rollback, secret rotation) after Gate 3

**If yes:** I create the two lanes, push staging, and start wave 1 (devops, backend, GHL core, public pages) in parallel.
**If no:** tell me what to change; the owning specialist revises and I re-ask (changes after this cost a scope_decision).

---
### Screens (open these)
Rebranded renders: `/home/admin/baseleap/rehearsal/northside-quotes/docs/design/screens/` (each `SCR-NN-mobile.png` and `-desktop.png`; state sheets `SCR-NN--<state>-*.png`)
| Screen | What it shows |
|---|---|
| SCR-01 Request a quote | mobile-first form, urgency cards, up to 3 photos, unticked "Email me offers" box (+ errors, send-failed) |
| SCR-02 Request sent | NQ- reference "job tag", what happens next |
| SCR-03 Staff sign-in | wrong password / paused / unavailable messages; no forgot-password link |
| SCR-04 Requests tab | newest first, filter + search, weekly strip (+ empty, loading, errors) |
| SCR-05 Pipeline tab | New / Quoted / Won / Lost, drag or "Move to", failed save reverts (+ moving, empty, loading, errors) |
| SCR-06 Request detail | photos, price + note, status, GHL copy + stage-tag label, "Not copied: no offers consent" (+ saved, sync, errors) |
| SCR-07 Weekly count | strip on both tabs: requests, won, lost, Mon–Sun Hamilton time |
| SCR-08 Photo viewer | full-size photo dialog (+ loading, error) |

### Blueprint
- ERD and modules: `docs/architecture.md` (Data model, Routes and screens, Lane ownership); `docs/SECURITY_MODEL.md`; `docs/openapi.yaml`; `docs/integration-contract.md`; decisions 0001–0004
- GHL answers: no standard field for reference/problem text (v1 sends name, phone, email, address); tags add/remove per official docs, to confirm live; scopes `contacts.readonly` + `contacts.write`
- SOP plan (DOC0): 11 procedures, 3 for Northside staff, 8 for Baseleap
- A2 result: builds; RLS tests pass on staging; mock serves the contract (all 9 ledger checks, incl. `npm run db:test` on staging)

### Build waves and lanes
| Wave | Steps | Verify (ledger runs) |
|---|---|---|
| 1 | OPS1 devops config/CI/release · BE1 platform + submission · INT1 GHL core · FE1 public pages | actionlint, env-check self-test, no access token · typecheck/lint/vitest (no empty passes)/build/service-role guard · same + GHL simulator tests · same + verify-ui on mocks |
| 2 | BE2 staff auth · FE2 staff shell + Requests + detail | |
| 3 | BE3 inbox reads/writes · FE3 Pipeline board | |
| 4 | INT2 GHL routes (after backend merges) | |
| 5 | QA1 test plan + E2E on the staging preview (done spine) | Playwright via bypass header, report names the preview URL |
| 6 | QA2 probes + fuzz · DV1 visual review | |
| 7 | REV1 code review · SEC1 security · DOC1 SOPs | review-check, sop-check |
| 8 | DEP1 drills → production health 200 (after Gate 3) | APPROVED verdicts, drills logged, smoke 200 |
Lanes: backend in `../northside-quotes-wt-backend`, frontend in `../northside-quotes-wt-frontend`, devops/integration in the main tree.

### For transparency
- A2 failed once on file ownership because my brief told it to edit A1's docs (recorded, class spec). A2 returned the edits (net diff empty, verified), I re-based A2's ownership window (recorded as a ruling), and A1 re-applied the wording under its own step. All A2 checks then passed.
- Unverified until live: GHL duplicate-400 and tag auto-creation behaviour (INT tests use a simulator; live calls need `GHL_LOCATION_ID` + token, which you set later).
