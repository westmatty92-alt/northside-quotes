## 🛑 escalation: the team can't merge branches or delete files (blocks FE1, INT2 and Phase 3)
**Asking:** Allow `git merge` (not into main) and file deletion inside the two lanes, in the kit, then resolve.
**Recommendation:** Kit allow list: `git merge --no-ff <branch>` (and `git merge --abort`), `git rm`, and `rm` limited to `../northside-quotes-wt-*/**`. command-guard already refuses pushes to main and force pushes, so main stays protected.

Why each is needed:
1. **Delete (FE1 blocked now).** FE1 moved four files into its owned paths; the old copies (blanked to `export {};`) are untracked in the frontend lane, and the ledger's ownership check fails on them. Nothing on the allow list deletes a file (`rm`, `git rm`, `git clean` all need approval). Files: `src/components/providers/app-providers.tsx`, `src/components/site/{public-page,site-chrome,wordmark}.tsx` in `../northside-quotes-wt-frontend`. A one-time delete by Claude also works, but every lane will hit this again
2. **Merge (INT2 and Phase 3 blocked next).** INT2 needs the backend's `env.ts`, `http.ts`, `requireStaff` in its checkout; FE2/FE3 need A2's scaffold fixes from main; Phase 3 merges `lane/backend` then `lane/frontend` into `staging` for the preview QA runs on. All of that is `git merge`, which isn't allowed. Pushing can't merge diverged branches

Progress (no failures recorded; all environment):
- Backend lane complete: BE1 (184 tests), BE2 (168), BE3 (258), all on staging, all files owned, pushed to `lane/backend` (b58ad2d)
- INT1 99/99 incl. 12 staging DB tests; OPS1 9/9
- FE1 built and passing its own checks (63 component tests, verify-ui clean on 4 screens); waiting only on the delete
- A2 reopened and re-verified with scaffold fixes the lanes raised: every page now renders per request so the CSP nonce works (BE2 found 4 prerendered pages), Tailwind junk removed, 2 deps declared, offline tests exclude DB tests
- Rulings: non-staff gets 401 per the contract (my plan text said 403); no (public) layout
- Queued for devops before your Part 7: CI `api-tests` should also run the GHL DB tests; `docs/ops/account-setup.md` Part 7 still lists 2 dropped secrets and calls the repo private

**If yes:** I delete the FE1 strays, verify FE1, run FE2 → FE3, merge main and lane/backend so INT2 can run, then merge the lanes into staging for QA, and carry on to Gate 3.
**If no:** a one-time delete gets FE1 through, but INT2 and QA stay blocked until merges are allowed.
