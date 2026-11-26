## <YYYY-MM-DD HH:MM> · <short sha> · <released | rolled back | re-run with new settings>

| | |
|---|---|
| **Gate 3** | approved by Matthew, <date> (ledger gate release_approval-1) |
| **Drill** | <D1 release | D2 Instant Rollback | D3 rotation | normal release> |
| **GitHub production approval** | <date/time>, run https://github.com/westmatty92-alt/northside-quotes/actions/runs/<id> |
| **Commit** | `<full sha>` (PR #<n> staging → main) |
| **Production** | https://northside-quotes.vercel.app · deployment `<dpl_id>` · `<deployment address>` |
| **Restore point** | <none (first release) | `<dpl_id>`, commit `<short sha>`> |
| **Staging (tested)** | https://northside-quotes-git-staging-baseleap.vercel.app · QA run <link or report under docs/qa-reports/> |
| **Migrations applied** | `<timestamp>_<name>.sql`, … (or none) |
| **Smoke** | `/api/health` OK, version `<short sha>` · smoke paths: <n>/<n> 200 |
| **Rollback** | automatic: <not needed | done, previous commit answered | not possible, first release>. Manual: Vercel → Deployments → previous Production deployment → Instant Rollback (undo: Promote). Database: forward fix only (runbook) |
| **Notes** | <new or changed settings by name, deferred findings, anything that differed from the sop or runbook, follow-ups> |
