# STEP DEP1 — First production release and pipeline drills

## Attempt 1 — 2026-11-26 — Drill 1: started

**Status:** partial. Pre-flight done, drill docs written, pull request NOT opened (refused), one blocker found. Stopped as instructed.

**Files changed**
- `docs/ops/pipeline-drills.md` — new: summary, order of events, pre-flight results, D1 release, D2 Instant Rollback, D3 secret rotation (steps, expected results, blank result rows).
- `docs/deployments/release-log.md` — new: header, "no production release has run yet".
- `docs/deployments/release-entry-template.md` — new: the entry template (from the ops-release template, adapted to this project and the drills).
- `docs/deployments/release-1-pr-body.md` — new: title/body text for the release pull request (a record of what was proposed; Matthew can paste it).
- Nothing committed (not asked). These files sit in the main tree, uncommitted. They are not in the staging → main pull request. They should go to `staging` by a docs-only pull request, which also becomes the commit for release B (see below).

## Pre-flight (read-only)

| Check | Result |
|---|---|
| release.yml vs manifest names | Match. Environment `production`; secrets `VERCEL_TOKEN`, `SUPABASE_PRODUCTION_DB_URL`; variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; repo variable `PRODUCTION_URL`. Nothing else is read. |
| Production URL | `https://northside-quotes.vercel.app` in `infra/environments.json`, `docs/runbook.md`, `docs/ops/account-setup.md`, operator sops. Consistent. |
| Migrations | `git diff origin/main origin/staging -- supabase/migrations`: 10 files, `20261120000100` … `20261125001000`. release.yml applies everything in `supabase/migrations/` of the pushed commit, so it applies exactly these 10 to the empty production database. 0100–0700 show as "modified" against main (main holds old drafts, never applied to production); 0800 is guarded (`to_regprocedure`), safe with or without Matthew's RLS auto-enable; only extension is `pgcrypto`. Supabase CLI `^3.2.0`, same `migration up --remote=… --agent no` call as the staging script `supabase/scripts/db.mjs`. |
| First-release path | Handled. Lookup of `northside-quotes.vercel.app` returning 404 sets `first=true`; rollback step is skipped (`first != 'true'`), "First release failed" step explains, summary prints "none (first release)". Caveat: a 404 would also come back for a mistyped team id; the next step (promote) uses the same ids and fails loudly, so the risk is a missing restore point, not a wrong deploy. |
| Build without Sensitive values | `vercel pull` does not return Sensitive values. `src/lib/server/env.ts` reads `APP_SIGNING_SECRET` and `CRON_SECRET` lazily, so `next build` needs none. The DB-match step needs `NEXT_PUBLIC_SUPABASE_URL` in the pull, so that one must NOT be stored as Sensitive (it is public by design). |
| `scripts/smoke.mjs --self-test` | exit 0, 9 of 9 |
| `scripts/env-check.mjs --manifest-only` | exit 0 (one warning: `SITE_URL` required but not named in `src/`) |

### BLOCKER (will fail run 1 at the drift check, before any change)
`infra/environments.json` declares `GHL_LOCATION_ID` as `required` for Production (and `docs/ops/account-setup.md` Part 7 lists it as a Production row). You said it is not set. `release.yml` runs `node scripts/env-check.mjs --vercel`, which reports `missing: GHL_LOCATION_ID not set for production` and exits 1. It is safe (nothing migrated or deployed) but spends Matthew's approval and logs a failed attempt. The GHL token is `optional`, so its absence is fine.

Options, my recommendation first:
- **A (recommended): Matthew adds `GHL_LOCATION_ID` to Vercel Production.** It is not a secret: the test sub-account's Location ID, same value as the Preview row, plain Config. GHL copies still show failed (no token), as designed. No code, commit or check changes.
- B: change the manifest to `optional` for Production. I did not do it: it loosens a declared check, it needs a commit on `staging` (which changes the commit Gate 3 and QA covered), and it needs a decision from you or Matthew.
- C: run D1 as is, accept the failed attempt (logged), fix, run again.

## What I opened

**Nothing.** `gh pr create` is refused for me ("requires approval"; no one can click it in a background run). `git fetch`, `git ls-remote`, `gh api` and `gh pr list` are refused too, so I did not try any other route. I did not touch `main`, `release.yml` dispatch, Vercel or GitHub settings.

## What Matthew must do next (in order)

1. **Resolve the blocker** (option A above) in Vercel: project `northside-quotes` → Settings → Environment Variables → add `GHL_LOCATION_ID`, Production only, not Sensitive.
2. **Open the pull request:** https://github.com/westmatty92-alt/northside-quotes/compare/main...staging?expand=1 → **Create pull request**.
   - Title: `Release 1: staging to main (Northside quote requests, first production release)`
   - Body: paste the contents of `docs/deployments/release-1-pr-body.md` (Gate 3 summary, the 10 migrations, rollback plan). Delete its "HOLD" paragraph once the blocker is resolved.
   - Check the Commits tab: it should be 04dd79a plus the QA/report commits.
3. **Wait for the required checks** (`verify`, `api-tests`, `security`, `workflows`) to go green, then **Merge pull request**. (I could not verify from here that the ruleset on `main` exists; the runbook says Matthew sets it after the first checks.) Merging starts `release.yml`, which also arrives on `main` for the first time in this merge.
4. **Approve the run:** https://github.com/westmatty92-alt/northside-quotes/actions/workflows/release.yml → the newest `release` run (Waiting) → **Review deployments** → tick `production` → **Approve and deploy**. The run id is not known until the merge: the run URL will be `https://github.com/westmatty92-alt/northside-quotes/actions/runs/<id>`; send me the link or just say "approved".

## What I will check after approval
- Read the run (if `gh run view` is refused, I rely on the run link and the step summary you paste): drift check `✓ environments match the manifest (including Vercel)`, notice "this is the first release", DB project `epwbzhezitsknqtuykgv` matches, 10 migrations applied, deploy, `Promoted dpl_…`, smoke.
- `node scripts/smoke.mjs https://northside-quotes.vercel.app <released commit>`: `/api/health` 200 `ok` with that commit's first 7 characters, `/` and `/sign-in` 200.
- Then fill D1 in `docs/ops/pipeline-drills.md`, write the release-log entry, update the runbook (first release note, platform settings "last verified").

## Plan for D2 and D3 (details in the drill log)
D2 needs a second production deployment with a different commit, so release B comes first: the docs-only pull request to `staging` (drill log + release-log entry for A), then a second `staging → main` PR and approval. Then Matthew does Instant Rollback to A in Vercel; health must show A's commit. D3 rotates `CRON_SECRET` (Production row), then **Re-run all jobs** on release B's run: it must promote B explicitly after the rollback and health must show B's commit. The automatic rollback on a failed smoke check is not drilled in this round (not chosen): unproven until a planted failure is run.

## Other findings
- The Gate 3 packet does not name the migrations (ops-release §1 asks for that). I listed them from the tree in the PR body; the packet itself only says "RLS on every table, 10 tables". Orchestrator: note it.
- The remote `staging` tip is **unverified** from this session (local `origin/staging` is 04dd79a; your note says QA/report commits follow). The PR's Commits tab is the check.
- The runbook says "Platform settings: last verified: not yet". I still cannot verify (no `gh api`, no Vercel token). Matthew's setup statements are taken as given; the GitHub ruleset on `main` and the required check names are unverified. Job names in `ci.yml` (`verify`, `api-tests`, `security`, `workflows`) match what the runbook lists as required.
- Local `main` is 69 commits ahead of `origin/main` and diverges from `staging`; only the remote `staging` matters for the release, nothing from local `main` is shipped.

**Commands run:** `node scripts/env-check.mjs --manifest-only` → exit 0; `node scripts/smoke.mjs --self-test` → exit 0 (9/9); read-only `git diff/grep/log` → ok; `git fetch`, `git ls-remote`, `gh api`, `gh pr list`, `gh pr create` → refused (needs approval), not retried.
**Could not do:** open the PR (refused); read the remote staging tip and GitHub/Vercel settings (refused).
**CONTRACT QUESTION:** none.
**BLOCKED:** `GHL_LOCATION_ID` Production row in Vercel (Matthew), see above.
**Notes for the next step:** commit the four docs files (docs-only PR to `staging`) before release B; update `docs/sops/operator/rotate-app-secrets.md` and `release-to-production.md` after the drills (owner: bl-docs / orchestrator), since their button names are unverified.
