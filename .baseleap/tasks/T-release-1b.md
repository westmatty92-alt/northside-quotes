# Retry release 1: confirm the GitHub safety settings, check CI on staging, open and merge a new PR

**For Matthew.** About 20 minutes plus CI time. **Unblocks:** DEP1 drill 1 (first production release). **Why:** release 1's PR merged with red checks, and the release run started without your approval because the `production` environment had no required reviewer and admin bypass on. Nothing was deployed or migrated. The CI failures are fixed on `staging` (`291a344`), and a new pre-flight job in `release.yml` now refuses to run unless the production safety settings are right.

## Steps
1. **GitHub → repo `northside-quotes` → Settings → Environments → `production`:**
   - **Required reviewers:** `westmatty92-alt` ticked. **Allow administrators to bypass:** unticked. **Deployment branches and tags:** *Selected branches* → `main` only. **Save protection rules.** You should see the reviewer listed and no bypass.
2. **Settings → Environments → `staging` → Environment secrets:** add `QA_OWNER_PASSWORD` and `QA_HELPER_PASSWORD` (the staging test logins, same values as in `.env.local`), and confirm `SUPABASE_STAGING_DB_URL` is listed. Copy values tab to tab; never paste them in chat.
3. **Settings → Secrets and variables → Actions → Variables (Repository):** `PRODUCTION_URL` = `https://northside-quotes.vercel.app`. You should see it listed at repository level (not inside an environment).
4. **Settings → Rules → Rulesets → New branch ruleset** for `main`: require a pull request; require status checks `verify`, `api-tests`, `security`, `workflows`; block force pushes; restrict deletions; bypass list empty. **Create.**
5. **Check CI on staging:** https://github.com/westmatty92-alt/northside-quotes/actions?query=branch%3Astaging → the newest **ci** run (commit `291a344`). All four jobs should be green. If one is red, stop and tell me its name (and, for `security`, open the run's `security-scan` artifact or the log lines naming rule/file/line).
6. **Open the PR:** https://github.com/westmatty92-alt/northside-quotes/compare/main...staging?expand=1
   - Title: `Release 1 (retry): staging to main, CI fixes and release pre-flight`
   - Body: paste the block below.
7. When the four checks are green on the PR, **Merge pull request → Confirm merge**. The **Release** workflow starts: its `preflight` job checks step 1 and step 3; then the `release` job waits for you.
8. Tell Claude "release 1 merged". I'll send you the exact run link to approve (`T-approve-release.md`).

### PR body
```
Retry of release 1 (the first production release of Northside quote requests).

Release 1's PR merged with three red CI checks and its release run started without approval
(production environment had no required reviewer, admin bypass on). Nothing was deployed or migrated.

This PR carries:
- CI config fixes: api-tests now receives SUPABASE_STAGING_DB_URL and the QA logins; env-check declares
  NEXT_PUBLIC_API_MOCKING and ignores comments; security scan allowlists two placeholder strings and skips build output.
- release.yml pre-flight: fails unless production has westmatty92-alt as required reviewer, admin bypass off,
  deployments limited to main, and PRODUCTION_URL set.

Release content is unchanged from the reviewed build (04dd79a): QA1 156/156, QA2 probes + fuzz clean,
code review and security review APPROVED. On merge the release applies 10 migrations (20261120000100 to
20261125001000) to the empty production database, deploys, and runs the smoke check.
```

## Done check
The PR shows four green checks before merge; the Release run's `preflight` job is green and the `release` job shows "Waiting for review".

## If something looks different
- **`preflight` fails with 403/404 reading the environment:** GitHub didn't let the workflow token read protection rules. Create a fine-grained token (this repo only, *Actions: Read*), add it as repository secret `RELEASE_PREFLIGHT_TOKEN`, and re-run the failed job.
- **`preflight` fails on `can_admins_bypass`:** the bypass box is still ticked, or GitHub didn't report the field; tell me which.
- **`security` red on staging:** don't open the PR; send me the failing rule/file/line.
