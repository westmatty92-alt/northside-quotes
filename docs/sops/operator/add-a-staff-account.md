# Add a staff account

**Purpose:** Give the owner or the office helper a working sign-in: create the account, register it as staff, hand over the first password and check it works.
**Who:** Baseleap (Matthew or a dev). On production, Matthew runs the SQL step · **When:** Before the first sign-in of a new person, and at release time for production · **Kind:** 2 operator
**Evidence:** see [evidence](../evidence.md#add-a-staff-account)

## Before you start
- You can sign in to the Supabase dashboard and open the right project: `Northside staging` or `Northside production`. Use the production project only for production.
- You have the password manager open. Each account gets its own password, at least 12 characters, different from the other account's. The password manager generates it.
- You know the person's email address and their phone number.
- Staging only: you are in the repo on the machine that runs the ledger. Its `.env.local` file has `SUPABASE_STAGING_DB_URL`. Do not put the value anywhere else.
- There is no sign-up page, no reset email and no in-app user management. An account made in the dashboard has no access until step 4 or 5 is done.

## Steps
1. In the password manager, generate a password of at least 12 characters. Save it as `Northside (TEST) · <staging or production> · <owner or helper> password`. Never put it in chat, email, a file or a ticket.
2. ⚠ unverified: Open the Supabase dashboard, then the project, then **Authentication → Users → Add user → Create new user**. The names come from the runbook, not from a run. Supabase changes its wording, so it would be verified by the first person who follows this with the dashboard open.
3. Type the email, paste the password, tick **Auto Confirm User** and create the user. Auto Confirm matters because no confirmation email can be sent. ⚠ unverified: that the dashboard form enforces the 12-character minimum. The 12-character rule is yours either way.
4. Staging: in the repo, run `npm run db:staff-add -- <email>`. You can add a display name after the email. Without one, an email starting with `owner` becomes "Owner" and one starting with `helper` becomes "Office helper". The command is safe to run twice.
5. ⚠ unverified: Production only (Matthew). Open the production project, then **SQL Editor**, and run this with the real email. The command in step 4 never touches production, by design. This SQL has not been run on production yet.
   ```sql
   insert into public.staff (user_id, display_name)
   select id, 'Owner' from auth.users where lower(email) = lower('owner@example.com')
   on conflict (user_id) do nothing;
   ```
   Then run `select count(*) from public.staff;`. The number must equal the number of accounts you made.
6. Phone the person. Read the password to them. Do not text or email it. Ask them to write it down somewhere private, or to keep it only in their own password manager.
7. Ask the person to open the sign-in page for that environment and sign in. Staging: `https://northside-quotes-git-staging-baseleap.vercel.app/sign-in`. Production: `https://northside-quotes.vercel.app/sign-in`. Production is not live until the release has run.
8. In the password manager, write the date you handed the password over.

## What you should see
- Step 4: a line like `db: <email> is staff on the <project name> (added now)`. A second run says `already staff, unchanged`.
- Step 7: the **Requests** page, with **Signed in as Owner** or **Signed in as Office helper** in the top bar. On a phone the name is hidden. Then **Sign out**.

## If it goes wrong
- **Step 4 says "no Supabase Auth user has this email (create it in the dashboard first)":** Do steps 2 and 3 first, and check the email spelling.
- **Step 4 refuses to run, or complains about the address:** It only works on staging. For production, use step 5.
- **The person sees "Email or password is incorrect":** Check the email and the password in the password manager. Check that **Auto Confirm User** was ticked. If not, reset the password (see [reset-a-staff-password.md](reset-a-staff-password.md)).
- **The person signs in but sees an error or an empty page:** The staff row is missing. Run `select count(*) from public.staff;` and repeat step 4 or 5.
- **Sign-in says "Too many sign-in attempts":** Wait 15 minutes. A new password does not lift the pause.
- **Never** add a custom email sender (SMTP) to these projects to send invitations. With one, a recovery email could sign a person in. Stop and ask for a security review first (runbook, "Staff accounts and passwords").

## Changelog
- 2026-11-25 — First version. The staging steps are backed by the staging accounts QA signed in with. The dashboard names and the production SQL are unverified — step DOC1
