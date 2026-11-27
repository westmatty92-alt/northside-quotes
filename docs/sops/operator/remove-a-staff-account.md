# Remove a staff account

**Purpose:** Take a person's access away completely, and check that they can no longer sign in.
**Who:** Baseleap (Matthew or a dev) · **When:** A staff member leaves, or an account was made by mistake · **Kind:** 2 operator
**Evidence:** see [evidence](../evidence.md#remove-a-staff-account)

## Before you start
- Draft: this procedure has never been run. The steps follow the database design. Each step marked unverified below stays that way until a run on staging proves it.
- You can sign in to the Supabase dashboard and open the right project.
- Know that removing a person does not remove their past work. Requests, prices, notes and status history stay. Their name on "Last updated by" is replaced by "a removed account".
- Keep at least one working staff account. There is no way to add one from inside the app.

## Steps
1. Note the person's email and the project (staging or production).
2. ⚠ unverified: Open the Supabase dashboard, then the project, then **Authentication → Users**. Find the person and delete the user. The exact button name is not in any run. It would be verified by doing this on a staging test account.
3. ⚠ unverified: Open **SQL Editor** and run `select count(*) from public.staff;`. The number must be one lower than before. The design says deleting the auth user also deletes the staff row. It would be verified by this step on a staging test account.
4. ⚠ unverified: Ask the person to try to sign in with their old password, or try it yourself in a private browser window. It must fail with "Email or password is incorrect". If they were signed in on a device, ask them to reload a request page. It must send them to the sign-in page. The design says a staff row is needed on every call. It would be verified by a staging run that keeps a second browser signed in.
5. Open any request the person last changed. Under the status it says "Last updated by a removed account", followed by the time. This is expected.
6. In the password manager, note the date and who was removed.

## What you should see
- The user is gone from **Authentication → Users**.
- The staff count is one lower.
- The person cannot sign in, and the requests they changed still exist.

## If it goes wrong
- **The staff count did not change:** The user was deleted but the staff row remains, or the wrong project is open. Check the project name at the top of the dashboard. Do not try to fix it in the app. Tell Matthew.
- **The person can still open the app:** Treat it as urgent. Tell Matthew at once. Do not change anything else until he decides.
- **You removed the wrong person:** Create the account again with [add-a-staff-account.md](add-a-staff-account.md). It will be a new account with a new password. Their old "Last updated by" name stays empty.

## Changelog
- 2026-11-25 — First version, a draft. No run on staging yet. Steps follow `docs/SECURITY_MODEL.md` and the migrations — step DOC1
