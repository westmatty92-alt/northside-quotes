## Release 1 (DEP1, drill 1 of 3): staging to main

**HOLD: do not merge yet.** Merging starts release.yml. The Vercel variable `GHL_LOCATION_ID` is declared required for Production in `infra/environments.json` but is not set there, so the drift check (the first release step) will stop the run before anything changes. Decide that first (see the DEP1 report). Everything else in the pre-flight is clear.

### Gate 3
Gate 3 release_approval approved by Matthew for staging 04dd79a (QA E2E 156/156, probes 54/54, fuzz clean, code review and design review APPROVED, security SEC1 recorded). The PR head is the current tip of staging, which also holds the QA and report commits made after 04dd79a: check the Commits tab.

### Migrations release.yml will apply (the production database is empty; all are new there)
- 20261120000100_extensions_and_helpers.sql
- 20261120000200_staff.sql
- 20261120000300_quote_requests.sql
- 20261120000400_ghl_sync.sql
- 20261120000500_events_and_limits.sql
- 20261120000600_functions.sql
- 20261120000700_storage.sql
- 20261120000800_platform_function_grants.sql (guarded, safe if the platform function is absent)
- 20261125000900_photo_plan_replay.sql
- 20261125001000_photo_plan_replay_fallback.sql

The Files tab shows 0100 to 0700 as modified against main: main only ever held earlier drafts, and nothing was ever applied to production, so release.yml applies the staging versions to an empty database.

### Rollback plan
- First release: there is no earlier production deployment, so nothing to restore. A failed first release is Matthew's call (docs/runbook.md, Incidents); production has no users.
- Later releases: release.yml records the live deployment first and promotes it back by itself if the smoke check fails. Manual: Vercel, Deployments, last good Production deployment, Instant Rollback.
- Database: no down-migrations; forward fix only (expand/contract).

### After you merge
GitHub, Actions, release, the waiting run, Review deployments, tick production, Approve and deploy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
