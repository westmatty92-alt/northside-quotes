## 🔒 scope_decision: let the lane's mock screenshots past the auth proxy (local only)?
**Asking:** May the backend add a mock-only, local-only skip of the signed-out redirect in `src/proxy.ts`, so FE2's plan-approved visual check can run?
**Recommendation:** Yes, with the guard below. It never activates on any Vercel deployment.

- Problem: FE2's approved check screenshots the staff screens with mock data on a local `next start`. Since the lanes merged, the backend's proxy (correctly) redirects every signed-out visit to `/sign-in`, so the check can only ever see the sign-in page and fails. FE2's code, tests (184 staff tests), build and guards all pass
- I ruled out a mock bypass earlier because an env-flag auth skip is risky on previews. A guard that can't fire on Vercel removes that risk
- **The guard:** skip only the signed-out redirect, only when `NEXT_PUBLIC_API_MOCKING === 'on'` **and** `process.env.VERCEL` is unset (Vercel sets it on every preview and production build). API routes keep requiring a real session either way; mock data comes from the browser's mock layer, not the server
- **Proof required:** backend tests that the skip is off when `VERCEL` is set (any value), off when mocking is off, and that `/api/*` still returns 401 without a session; security re-checks it in SEC1
- **Alternative:** no change to the proxy; FE2 stays unverified by the ledger and its staff screens are proven only by QA1's re-run and the visual review on staging. The ledger's ship gate would then show FE2 not done at Gate 3

**If yes:** backend adds the guarded skip (BE2 reopened), FE2 re-verifies, the designer aligns two labels in the spec, then QA1 re-runs on staging and the verify phase continues to Gate 3.
**If no:** I continue with QA on staging and bring FE2 to Gate 3 as "proven on staging, ledger check unmet".

Where things are: QA1 ran the full suite on staging e966fbc: done spine passes; 112/130 pass; the 18 failures were 4 frontend bugs, now fixed in the lane with failing-then-passing tests (logo label axe violation, "Photo unavailable", dialog focus trap, label wording). Not yet merged to staging or re-tested.
