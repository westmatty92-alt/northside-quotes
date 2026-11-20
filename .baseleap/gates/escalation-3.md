## 🛑 escalation: write-scope hook refuses A2's pattern-style file entries (kit bug)
**Asking:** Fix one line in the kit, install it here, then resolve this escalation.
**Recommendation:** Kit fix (option 1). It unblocks A2 and every later lane step, which also list their files as patterns.

- What happened: bl-architect on A2 (status building) was refused writing `supabase/scripts/db.mjs` and `next.config.ts`: "[specialist-scope] … not owned by your active ledger step". It did not work around it
- Root cause, confirmed by me: `.claude/hooks/specialist-scope.mjs` line 61 is `if (scope.files.includes(rel))`, an exact string match. Plain names (`package.json`) pass; entries like `src/**`, `next.config.*`, `supabase/scripts/**`, `public/**` never match. Line 53 already uses `matchesAny()` for standing paths, which is why the designer was never affected
- Option 1 (recommended): change line 61 to `if (matchesAny(rel, scope.files)) process.exit(0);` (`matchesAny` is already imported on line 12)
- Option 2: I amend the plan to list A2's 22 exact paths (opens a scope_decision, and every build step would need exact paths too)
- Not recorded as an A2 failure (tooling, not the step's work). A2's partial work is in the tree, uncommitted: package.json + lockfile, tsconfig, orval config, components.json, .nvmrc, .gitignore, .env.example, and the SEC-23 consent-trigger fix with 3 new tests
- Nothing has touched staging yet; the migrations' first real run is still A2

**If yes:** I re-dispatch A2 (scaffold, migrations + pgTAP on staging), verify it, submit the build plan and open Gate 2 with the rebranded screens.
**If no:** tell me to take option 2 and I'll amend the plan.
