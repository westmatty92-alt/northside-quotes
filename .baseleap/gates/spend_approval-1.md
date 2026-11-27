## 🔒 spend_approval: production database in the main Pro org
**Asking:** Approve the recurring cost of `Northside production` (ref epwbzhezitsknqtuykgv) living in Baseleap's main **Pro** org, or move it to a free org before the first release?
**Recommendation:** Option A (keep it in the Pro org and approve the cost), because production should not pause after a week idle (Free does) and it's already set up; the cost is small and the rehearsal ends with the drills.

- Plan of record (D-1, account packet) was a second **free** project at $0; Part 7 put it in the main Pro org instead
- **Unverified cost:** a Pro plan includes compute credits that usually cover one small instance; each additional project typically adds its own compute charge (roughly US$10/month for the smallest size). Your org's dashboard → Billing shows the real figure. I can't see it
- Other Part 7 items look right from your note: ca-central-1, RLS auto-enable (our migration 0800 already revokes the platform function it installs), Data API on, GitHub `production` names match `release.yml`, Vercel Production-only variables, fresh secrets, Fluid Compute checked
- One name check I can't do from here: the three Vercel Production variables must be named exactly `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key) and `SUPABASE_SERVICE_ROLE_KEY` (secret key). The release workflow's drift check will stop the release if they differ

**Options**
- **A (recommended):** keep it in the Pro org; approve up to the amount Billing shows (expected ≈ US$10/month); pause or delete the project after the rehearsal if you don't want the charge
- **B:** move it to the sandbox (free) org: new free project, redo Part 7 steps 1–3 and 5 (≈ 30 min); $0, but Free pauses after 7 idle days
- **C:** keep it, and delete it right after the drills (cost limited to a few days)

**If A or C:** I dispatch DevOps for DEP1 (release, rollback drill, secret-rotation drill) and tell you each time a GitHub approval is waiting, with the link (task T-approve-release).
**If B:** tell me when the new project is set up; I re-check and then start DEP1.
