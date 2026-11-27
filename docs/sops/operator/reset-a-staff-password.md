# Reset a forgotten staff password

**Purpose:** Give a staff member a new password when they forgot theirs, without any email.
**Who:** Baseleap (Matthew or a dev) · **When:** The owner or helper phones and cannot sign in because they forgot the password · **Kind:** 2 operator
**Evidence:** see [evidence](../evidence.md#reset-a-staff-password)

## Before you start
- This procedure is new since the plan. The plan listed it as a gap. The runbook now has it.
- The app has no "forgot password" link and sends no email. The person cannot reset it themselves. The dashboard is the only way.
- You can sign in to the Supabase dashboard and open the project that the person signs in to.
- Check first that the person is not just paused. After too many wrong tries, sign-in is refused for up to 15 minutes, even with the right password. A new password does not lift that pause.

## Steps
1. In the password manager, generate a new password: at least 12 characters, different from the other staff account's password. Save it over the old entry, `Northside (TEST) · <environment> · <owner or helper> password`.
2. ⚠ unverified: Open the Supabase dashboard, then the project, then **Authentication → Users**. Open the person's row and set the new password. The runbook says the wording varies by Supabase version. It would be verified by the first real reset, or a reset on a staging test account.
3. If the dashboard offers no direct password field, stop. Do not turn on any email-based option. Send Baseleap a screenshot with the password box blank.
4. Phone the person. Read the new password to them. Do not text or email it.
5. Ask them to sign in at the app's sign-in page.
6. In the password manager, record the date of the reset.

## What you should see
- The person signs in and sees the **Requests** page.

## If it goes wrong
- **The person still sees "Email or password is incorrect":** Check the email spelling, then the password you set. Set it again if unsure.
- **"Too many sign-in attempts. Try again in a few minutes.":** The pause is still on. Wait 15 minutes. The new password is not wrong.
- **The person is still signed in on another device after the reset:** ⚠ unverified: whether a reset ends their existing sessions. The runbook only says new sessions need the new password. It would be verified by a reset on a staging test account with a second browser open.
- **Someone asks you to send a reset email or add an email sender:** Do not. Custom email sending needs a security review first (runbook, "Staff accounts and passwords").

## Changelog
- 2026-11-25 — New procedure. Not in the DOC0 plan. The plan's open question 2 was answered by the runbook: phone hand-over, dashboard reset, no email — step DOC1
