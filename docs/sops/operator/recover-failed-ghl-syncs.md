# Recover failed GoHighLevel copies

**Purpose:** Find why contact copies or stage tags to GoHighLevel failed, fix the cause, and get the copy done.
**Who:** Baseleap (Matthew or a dev) · **When:** Staff report "Copy to GoHighLevel failed" or "Stage tag failed", or after the GoHighLevel token or location is set or replaced · **Kind:** 2 operator
**Evidence:** see [evidence](../evidence.md#recover-failed-ghl-syncs)

## Before you start
- **Live GoHighLevel has never been called.** `GHL_LOCATION_ID` and `GHL_PRIVATE_INTEGRATION_TOKEN` are not set yet. Everything here that depends on how GoHighLevel really answers is marked unverified. The code and the failure paths were tested only against a stand-in.
- Until both settings exist, every request with the offers box ticked shows **Copy to GoHighLevel failed**. That is the expected state, and the request itself is safe. It was seen on the staging preview.
- Only requests where the homeowner ticked the offers box are ever copied. A request showing **Not copied: no offers consent** is correct. Do not "fix" it.
- Use the GoHighLevel test sub-account only, never a client's real account.
- You can open the Supabase dashboard (**SQL Editor**) and the Vercel project for the environment.
- The staff screen has the **Retry copy** button. There is no retry for a failed stage tag. The next status change of that request starts a new try.
- Never paste the token into chat, a file or a ticket. Copy it from GoHighLevel and paste it straight into Vercel.

## Steps
1. Ask Northside for the reference number (starts with NQ-) of one affected request.
2. ⚠ unverified: Open the Supabase dashboard, then the project, then **SQL Editor**. Run this to list the jobs that need attention. Job rows hold no personal data. The query is from the integration notes and was not run in a drill.
   ```sql
   select request_id, kind, state, attempt_count, last_error_class, next_attempt_at
   from ghl_sync_jobs
   where state in ('pending','waiting','failed')
   order by next_attempt_at;
   ```
3. Read `last_error_class` for the job, and follow the matching line.
   - **timeout, server_error or rate_limited:** GoHighLevel is slow, down or busy. Do nothing now. The app tries again after 5 minutes, 1 hour, 3 hours, 6 hours and 12 hours, then marks the copy failed. Check GoHighLevel's status page. When it is back, go to step 6.
   - **config_missing:** `GHL_PRIVATE_INTEGRATION_TOKEN` or `GHL_LOCATION_ID` is not set in that environment. Go to step 4.
   - **auth:** The token was revoked, belongs to the wrong sub-account, or lacks a scope. Go to step 5.
   - **rejected:** GoHighLevel refused the data, or the contact no longer exists. Go to step 7.
4. Set the missing setting through the secrets process. `GHL_LOCATION_ID` is a plain Config row in Vercel. The token is a **Sensitive** row, in Preview and Production. Then make a new deployment (see [rotate-app-secrets.md](rotate-app-secrets.md), step 6). Go to step 6.
5. ⚠ unverified: In GoHighLevel, open the Private Integrations page of the test sub-account. Create or edit the integration so it has exactly the scopes `contacts.readonly` and `contacts.write`, and nothing else. Copy the new token into the Vercel row `GHL_PRIVATE_INTEGRATION_TOKEN`. The exact GoHighLevel menu names are not verified. Make a new deployment. After the copy works, delete the old token in GoHighLevel. GoHighLevel keeps the old one valid for 7 days after a rotation, and tokens are rotated every 90 days.
6. Ask the owner to open the request and click **Retry copy**. Failed copies are re-run by that button, not by the schedule. ⚠ unverified: that the button works against live GoHighLevel — would be verified by the first live test on the test sub-account.
7. For **rejected**: GoHighLevel refused the data. The app has no screen to edit a homeowner's details, so tell Matthew before you change anything. Check that the sub-account setting **Allow Duplicate Contact** is off. Then go to step 6. If the contact was deleted in GoHighLevel, the app never recreates it. ⚠ unverified: the repair is to clear `ghl_contact_id` and `ghl_linked_at` together for the affected request in the **SQL Editor**, then go to step 6. The statement is not in any run. Ask Matthew before you run it.
8. For scheduled retries on production, the schedule runs four times a day (00:00, 06:00, 12:00 and 18:00 UTC). To run one now: ⚠ unverified: Vercel, then the project, then **Cron Jobs**, then run `ghl-sync` once, and check **Logs** for status 200. Staging has no scheduled runs.
9. ⚠ unverified: In the GoHighLevel test sub-account, find the contact for that homeowner. It must be one contact with the tag `quote-request` and one stage tag: `quote-new`, `quote-quoted`, `quote-won` or `quote-lost`. Whether GoHighLevel creates a missing tag by itself is not yet known. If it does not, CRM Automation creates the five tags once by hand.
10. Open the request in the app. It should show **Copied to GoHighLevel** and **Stage tag up to date**.

## What you should see
- In the job list: no row for that request in `failed`, `waiting` or `pending`.
- In the app: **Copied to GoHighLevel** with a time, and **Stage tag up to date**.
- In GoHighLevel: one contact per homeowner, with the tags above.

## If it goes wrong
- **"The retry did not work.":** GoHighLevel is still not answering, or the cause is not fixed. Read `last_error_class` again from step 3.
- **"The retry could not run.":** The job was already running or is not needed. Reload the request.
- **Copies stay "Waiting to retry" for more than a day:** Check that the scheduled run happens. Open Vercel, then **Logs**, and look for the route `ghl-sync`. Scheduled runs happen on production only. The function needs the Fluid Compute setting (see [release-to-production.md](release-to-production.md)).
- **Two contacts for one homeowner:** This should not happen. The app looks in its own database first, then asks GoHighLevel. ⚠ unverified: whether GoHighLevel finds a contact created seconds earlier. Tell Matthew and do not delete either contact yet.
- **Someone asks to stop emails:** Northside removes the contact, or its `quote-request` tag, by hand in GoHighLevel. The app never adds a removed contact back for an existing request.
- **The token was pasted into chat or a file by mistake:** Treat it as a leak. Rotate it now, using [rotate-app-secrets.md](rotate-app-secrets.md).

## Changelog
- 2026-11-25 — First version. Live GoHighLevel has never been called, so the steps that depend on its answers are unverified. The "Retry copy" button shipped, which settles plan question 3 for copies. Stage tags still have no button — step DOC1
