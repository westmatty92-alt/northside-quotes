# Release Log: <project>

Newest first. One entry per production release or rollback. Written by bl-devops from the release workflow run.

## <YYYY-MM-DD HH:MM> · <short sha> · <released | rolled back>

| | |
|---|---|
| **Gate 3** | approved by Matthew, <date> (ledger gate <id>) |
| **GitHub production approval** | <date/time>, run <link> |
| **Commit** | `<sha>` (PR #<n> staging → main) |
| **Production** | <production URL> · deployment `<id or url>` |
| **Staging (tested)** | <staging URL> · QA run <link to docs/qa-reports/…> |
| **Migrations applied** | `<timestamp>_<name>.sql`, … (or none) |
| **Smoke** | `/api/health` OK, version `<sha>` · smoke paths: <n>/<n> 200 |
| **Rollback** | `vercel rollback` → previous `<deployment>`; undo `vercel promote <deployment>`. Database: forward fix only (see runbook). |
| **Notes** | <anything Matthew should know: new env vars set, deferred Minor findings, follow-ups> |
