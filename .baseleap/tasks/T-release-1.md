# Start release 1 (drill 1): one Vercel setting, open and merge the PR, approve the run

**For Matthew.** About 15 minutes plus CI time. **Unblocks:** the first production release (DEP1 drill 1). Agents can't open or merge PRs to `main`, and can't start the release.

**Why the setting:** `infra/environments.json` requires `GHL_LOCATION_ID` in Production, and the release's first check (`env-check --vercel`) stops the run if it's missing. It's the test sub-account's Location ID, not a secret, same value as Preview. The GHL token stays unset (copies show "failed", by design).

## Steps
1. **Vercel → team `baseleap` → project `northside-quotes` → Settings → Environment Variables → Add New.** Key `GHL_LOCATION_ID`, value: the GHL test sub-account's Location ID (GHL → Settings → Business Profile, or the same value as the Preview row). Environments: tick **Production** only. Not Sensitive. **Save.** You should see the row listed under Production.
2. **Open the PR:** https://github.com/westmatty92-alt/northside-quotes/compare/main...staging?expand=1
   - Title: `Release 1: staging to main (Northside quote requests, first production release)`
   - Body: paste `docs/deployments/release-1-pr-body.md` (leave out its HOLD paragraph).
   - **Commits** tab: you should see `04dd79a` (Merge branch 'lane/frontend' into staging) and the later QA/report commits. Click **Create pull request**.
3. Wait for the checks `verify`, `api-tests`, `security`, `workflows` to go green on the PR (about 10–20 min). If one is red, stop and send me its name.
4. Click **Merge pull request → Confirm merge.** That starts the **Release** workflow.
5. Tell Claude "release 1 merged". I'll find the run and send you its exact link; then approve it per `T-approve-release.md` (Review deployments → production → Approve and deploy).

## Done check
After you approve: the run's steps go green (drift check, first-release notice, 10 migrations, deploy, promote, smoke) and https://northside-quotes.vercel.app/api/health shows `"status":"ok"`. DevOps logs it in `docs/ops/pipeline-drills.md`.

## If something looks different
- **"main is protected / review required":** approve your own PR if the ruleset allows, or temporarily allow it; tell me what the message says.
- **The `security` check is red:** don't merge; send me the run link (it may be a real scanner finding; the reviews couldn't run the scanners).
- **The Commits tab shows no difference:** staging and main already match; tell me.
