# Work a quote request in the inbox

**Purpose:** Sign in, open a new quote request, save your price and note, set its status, read the weekly count and sign out.
**Who:** The owner or the office helper · **When:** Whenever a new request comes in, and at the start of each working day · **Kind:** 5 client staff
**Evidence:** see [evidence](../evidence.md#work-a-request-in-the-inbox)

## Before you start
- You need your own email address and password. Baseleap made your account and gave you the password by phone. There is no sign-up page.
- Use the sign-in page: `https://northside-quotes.vercel.app/sign-in`. Baseleap tells you when the live app is ready.
- A phone, tablet or computer all work. On a phone, the **Requests** and **Pipeline** tabs are in the bar at the bottom of the screen.

## Steps
1. Open the sign-in page. The title says **Staff sign-in**.
2. Type your email address in **Email**.
3. Type your password in **Password**. Click **Show** if you want to see what you typed.
4. Click **Sign in**. The **Requests** page opens.
5. Look at the list. The newest request is first. Each row shows the reference (it starts with NQ-), the name, the urgency, the status and the time it was sent.
6. To find one request, use the buttons under **Show requests** (All, New, Quoted, Won, Lost). Or type a reference, name or phone number in **Search by reference, name or phone** and click **Search**.
7. Click the reference or the name of the request you want. The request page opens.
8. Read **The request**: phone, email, address of the job, urgency and the problem. Look at **Photos**. Click **View photo 1** to see it full size. Click **Close** when you are done.
9. Under **Your quote**, type the amount in **Price quoted, in Canadian dollars**. Use 0.01 to 99,999.99, with at most 2 decimals. The price is optional.
10. Type your note in **Note**. It can be up to 1,000 characters. The note is optional too. You can save the price alone or the note alone.
11. Click **Save price and note**.
12. Under **Status**, click the status that is true now: **New**, **Quoted**, **Won** or **Lost**. It saves at once. Saving a price does not change the status, so always pick the status yourself. Any status can go to any other.
13. Look at **THIS WEEK** at the top of the page. It shows **Requests this week**, **Won** and **Lost**, from Monday to Sunday, Hamilton time. The numbers change by themselves within 2 seconds of a status change.
14. Click **Back to Requests**.
15. When you are done, click **Sign out** in the top bar.

## What you should see
- After step 4: the title **Requests**, the **THIS WEEK** numbers, then the list.
- After step 11: **Saved.** and a line such as "Price $450.00 CAD and your note are stored on NQ-…". Reload the page. Your price and note are still there.
- After step 12: the chosen status is marked, and the **THIS WEEK** numbers change if you chose **Won** or **Lost**.
- After step 15: the sign-in page.

## If it goes wrong
- **"Email or password is incorrect":** Check both and try again. Your email stays filled in. The password box is emptied.
- **"Too many sign-in attempts. Try again in a few minutes.":** Sign-in is paused, even with the right password. Wait 15 minutes, then try once. If it still fails, phone Baseleap.
- **"Sign-in is unavailable. Try again in a few minutes.":** Your password was not checked. Wait a few minutes and try again. If it keeps happening, phone Baseleap.
- **"Couldn't sign in. Try again.":** Check your internet connection and try again.
- **You forgot your password:** There is no "forgot password" link and no reset email. Phone Baseleap. They set a new password and tell you by phone.
- **"Your session ended. Your last change was not saved. Sign in again, then check the request.":** You were signed out, which happens after 7 days. Sign in, open the request and check it before you type again.
- **"Enter an amount from 0.01 to 99,999.99 with at most 2 decimals":** Fix the price. Nothing was saved yet.
- **"Notes can be up to 1,000 characters":** Shorten the note. Nothing was saved yet.
- **"Couldn't save. Try again." with "Your price and note are still here":** Click **Try saving again**. If it fails again, wait a minute and try once more. If it still fails, phone Baseleap.
- **"This request was changed by someone else. Reload to see the latest.":** The other person's price stays. Your note is kept below, under **Your note, not saved**. Copy it first. Then click **Reload this request** and save again if you still need to.
- **A status did not change and you see "Couldn't save. Try again.":** The status is still the old one. Click the status again.
- **"Photo unavailable":** The rest of the request is fine. Reload the page to try the photos again.
- **"Couldn't load requests. Try again.":** Click **Try again**. The list is not shown on purpose, so you do not think there are no requests.
- **"Count unavailable":** Click **Try again** under it. The list and the request pages still work.
- ⚠ unverified: **"No quote requests yet":** Nothing has been sent in. Requests come from the **Request a quote** page. The wording is read from the app's code. QA has no passing test for the empty list. It would be verified by a look at an empty staging list.

## Changelog
- 2026-11-25 — First version, written from the screens on the staging preview (commit 04dd79a), the QA run report and the visual evidence — step DOC1
