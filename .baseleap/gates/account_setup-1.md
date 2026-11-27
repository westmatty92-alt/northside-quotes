## 🔒 account_setup: Northside quote requests (rehearsal)
**Asking:** Create the throwaway accounts in docs/ops/account-setup.md (parts 1–6 now; part 7, production, before the pipeline drills), then approve.
**Recommendation:** Yes. Everything is $0; stop and tell me if any page shows a price.

- GitHub `westmatty92-alt`: private repo `northside-quotes`, push `main` and `staging` (command block in the packet). $0
- Supabase `Northside staging`, ca-central-1, sandbox org, free: public sign-up off, NO storage bucket by hand (migrations create it). $0
- Vercel team `baseleap`, project `northside-quotes` (yul1): Preview variables, Standard Protection + automation bypass (free on all plans per Vercel docs; team plan itself unverified). $0
- This machine's `.env.local`: set `SUPABASE_STAGING_DB_URL` and `SUPABASE_ACCESS_TOKEN` yourself (A2's database tests need them; not in Vercel)
- **DECISION D-1:** production = a second free Supabase project (ca-central-1). If the dashboard shows a price, don't pay: free a slot / second free org, or I open spend_approval
- **DECISION D-2:** GitHub Free private repo: if environments, rulesets or Actions minutes ask for an upgrade, stop; I open spend_approval (public repo / paid plan / weaker pipeline)
- **DECISION D-3:** Vercel billing shows no trial charge; don't turn on Password Protection, Passport or Trusted IPs (paid)
- GHL: nothing now. `GHL_PRIVATE_INTEGRATION_TOKEN` is requested later with scopes from the integration contract

**If yes:** A2 (scaffold, migrations + RLS tests on staging) can run once the architect's blueprint is verified.
**If no:** tell me which part fails; devops revises the packet.

About 60–90 minutes. Evidence: OPS-SETUP verified by the ledger (5/5 checks, incl. secret-pattern scan), commit ed8fffa. Packet: docs/ops/account-setup.md · report: .baseleap/reports/OPS-SETUP.md. Unverified from memory (devops couldn't fetch): Supabase and GitHub free-tier limits; check them on the live pages.
