## 🔒 Gate 3 · release_approval: Northside quote requests (rehearsal)
**Asking:** Ship staging (04dd79a) to production through the pipeline drills (release, rollback, secret rotation)?
**Recommendation:** Yes, Option A: approve, and do the fuzz lock (T-fuzz-lock, 10 min) and production setup (T-production-setup) first, because the one open Important finding protects the cross-client ledger key and the lock closes it properly.

- Done outcome on staging: QA's E2E 156/156 incl. the full spine (submit with photos → NQ- reference → first on Requests → price + note → won → weekly count), 19.4 s; ledger-verified at 04dd79a
- Probes 54/54 (no permission boundary crossed) and fuzz clean (no 5xx, contract matches after A3); code review APPROVED; design review APPROVED
- **DECISION SEC-25 (Important, test tooling only):** the fuzz tool's ~54 helper packages are unpinned and could read `.env.local` (ledger key, staging keys). A: generate the hash lock (T-fuzz-lock), security re-reviews → APPROVED. B: accept it as test-tooling risk; security records your acceptance. C: drop the fuzz from the release checks
- **DECISION FE2:** its original local-mock check can't pass behind sign-in (you rejected any bypass); FE2V (27 staging checks, axe clean) is its evidence. The ledger will keep FE2 "not done"; approving accepts FE2V in its place
- **DECISION (real client only, unchanged):** photos outgrow Supabase Free in ~1 month at 600/month (Pro $25/mo or in-browser shrinking); Vercel Hobby is non-commercial
- Not proven: live GoHighLevel (no token yet; copies show "failed" on staging); real-browser touch drag; scanners (refused in-session; CI's security job is the source)
- Spend: $0 so far; production is a second free Supabase project (D-1)

**If yes:** after T-fuzz-lock and T-production-setup, I re-run QA2 and security, then DevOps runs DEP1; you approve each release in GitHub (T-approve-release). Final check: production health returns 200.
**If no:** tell me what to fix; the owning specialist fixes it and I re-run the affected QA and reviews.

---
### Preview: staging screenshots of the built screens (04dd79a family; QA/visual review)
- `docs/qa-reports/visual/DV1/SCR-01-request-form-390x844.png`: request form on a phone: urgency cards, photos, unticked "Email me offers"
- `docs/qa-reports/visual/DV1/SCR-02-confirmation-390x844.png`: confirmation with the NQ- reference tag
- `docs/qa-reports/visual/FE2/1280/SCR-03-signed-out.png`: staff sign-in, no forgot-password link
- `docs/qa-reports/visual/FE2/1280/SCR-04-requests.png`: Requests tab with the weekly strip
- `docs/qa-reports/visual/DV1/SCR-05-pipeline-1280x800.png`: Pipeline board: New / Quoted / Won / Lost, Move to
- `docs/qa-reports/visual/FE2/1280/SCR-06-unticked.png`: request detail, "Not copied: no offers consent"
- `docs/qa-reports/visual/DV1/SCR-08-photo-viewer-1280x800.png`: photo viewer, no overlap
Staging URL (protected): https://northside-quotes-git-staging-baseleap.vercel.app

### Manual tasks (For Matthew)
- `.baseleap/tasks/T-fuzz-lock.md`: generate the hash-locked fuzz file (Option A), ~10 min
- `.baseleap/tasks/T-production-setup.md`: production Supabase, GitHub `production`, Vercel Production secrets, Fluid Compute, ~45–60 min
- `.baseleap/tasks/T-approve-release.md`: approve each release in GitHub during DEP1, ~2 min × 3

### Ship gate
| Check | Result |
|---|---|
| Every step done | 21/23: FE2 (see DECISION) and DEP1 (this gate) open |
| Tests + build on staging | backend/integration suites ledger-verified in the lane at the merged commits; fresh `npm test && npm run build` on the staging checkout **not run by me** (session can't check out staging); CI on `staging` is the source |
| E2E on current preview | QA1 156/156 at 04dd79a, ledger re-ran it: pass |
| Secret scan on diff | **not run by me** (pattern grep needs approval); security's history search: 2 hits, both false positives |
| RLS on every table | enabled + forced on all 10, live checks 15/15 and pgTAP 17 files/400 assertions on staging |
| Env vars by name | env-check `--manifest-only` and `--self-test` pass; `.env.example` names only |
| Done outcome on preview | yes (QA1 spine) |
| Rollback path | first release: no previous production deploy; the rollback is the DEP1 drill (Instant Rollback in release.yml) |

### Minors carried (no block)
Design F-02, F-03, F-04, F-06, F-07, F-08, BUG-FE2V-2 (saving label) · code review 9 Minors (REV1.md) · security SEC-21, 22, 24, 26, 27 (SEC-22/24 = consent/match wording, OQ-16 for a real client) · deferred contract wording (TRACE, sign-in 415→400) · photo upload AC-002.7 at 18.3–19.4 s vs 20 s · intermittent TLS upload error (BUG-QA1-6), not seen in 3 full runs · BE1 earlier flake, cause fixed (REV-3) · SOPs: 12 written, 34 steps ⚠ unverified until DEP1 and live GHL (docs/sops/changelog.md); client SOP home, purge frequency and GHL-before-go-live are yours to decide later · `docs/sops/system-map.md` waits on a kit skip-list fix.

### Disclosures
- Staging only: A2's first migration briefly made "Send again" loop for a few minutes until its second migration fixed it; no data repair needed.
- Kit mismatches found this round: ledger rejects `manual_task` events (recorded as notes); sop-check would fail `system-map.md`; specialists can't run scanners, `node --env-file`, or `git checkout` in-session.
