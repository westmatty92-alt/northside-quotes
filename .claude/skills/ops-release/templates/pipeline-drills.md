# Pipeline drills for {{PROJECT}}

<!-- bl-devops keeps this as docs/ops/pipeline-drills.md. One row per attempt, newest first inside each drill.
     Evidence = run links, versions, what production reported. Names only, never values.
     A drill passes only when its last attempt passed; a failure stays in the log with what was fixed. -->

**Why:** a client's first failed release must restore the site by itself, not leave it broken. These drills prove the pipeline on the client's real accounts **before launch**, while production has no users.
**When:** after account setup and the first green staging run, before the client goes live. Re-run the release and rollback drills after any change to `release.yml`, the Vercel or Supabase setup, or the tools the release installs.
**Who approves:** Matthew, every production step. Agents never approve, deploy or roll back production themselves.

## Summary

| Drill | Status | Last attempt | Evidence |
|---|---|---|---|
| 1. Checks on staging (CI: verify, security, workflows) | ☐ | | |
| 2. Staging tests start by themselves and pass (qa-staging @smoke) | ☐ | | |
| 3. Release: waits for approval → migrations dry run then apply → deploy → live check reports the commit | ☐ | | |
| 4. Rollback: a version that fails the live check is replaced by the previous one automatically | ☐ | | |
| 5. Two-step database change (expand/contract) with no failed requests | ☐ | | |
| 6. Uptime alert: health down opens one issue; restored closes it | ☐ | | |
| 7. Guardrails: agents refused `vercel --prod`, `vercel env pull`, `supabase db push`; no production token held | ☐ | | |

Launch is blocked until 1 to 4 pass. 5 to 7 pass before the first change that touches live data.

## Attempts

| Date | Drill | Version | Result | What happened | Fix (and where it went: project / kit template) |
|---|---|---|---|---|---|
| | | | | | |

## Planted breaks (must be reverted)

| Drill | Change | Reverted in |
|---|---|---|
| | | |
