# Approve the production release in GitHub (during DEP1)

**For Matthew.** About 2 minutes per release, three times (release, rollback drill, secret-rotation drill). **Unblocks:** each production change in DEP1. Nothing goes live without this click.

**Why:** the release workflow waits behind the GitHub `production` environment, which requires your approval. This is the mechanical human gate before anything live changes.

## Steps (when I tell you a release is waiting)
1. Open `https://github.com/westmatty92-alt/northside-quotes/actions`. You should see a **Release** run marked *Waiting*.
2. Click the run. You should see a yellow box: "This workflow is waiting for review… production".
3. Click **Review deployments**, tick **production**, add a short comment (e.g. "drill 1: release"), click **Approve and deploy**.
4. Watch the run: the jobs *migrate*, *deploy*, *smoke* should turn green within a few minutes.
5. Tell Claude: "approved" (or paste the run's red step name if one fails).

## Done check
`https://northside-quotes.vercel.app/api/health` shows `"status":"ok"`, and DevOps logs the run in `docs/ops/pipeline-drills.md`.

## If something looks different
- **No "Review deployments" button:** you're not signed in as `westmatty92-alt`, or the environment's required reviewer isn't set (task T-production-setup, step 3).
- **The smoke step fails:** the workflow rolls back by itself; don't re-run. Tell me the run link.
- **For the secret-rotation drill:** I'll ask you first to generate a new value and replace it in Vercel (same rules as T-production-setup step 5); approve only after that.
