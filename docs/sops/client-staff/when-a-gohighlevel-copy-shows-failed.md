# Read the GoHighLevel card and retry a failed copy

**Purpose:** Know what the GoHighLevel card on a request means, when to click **Retry copy**, and when to phone Baseleap.
**Who:** The owner or the office helper · **When:** When a request shows **Waiting to retry**, **Copy to GoHighLevel failed** or **Stage tag failed** · **Kind:** 5 client staff
**Evidence:** see [evidence](../evidence.md#when-a-gohighlevel-copy-shows-failed)

## Before you start
- You are signed in and have a request open. See "Work a quote request in the inbox" ([work-a-request-in-the-inbox.md](work-a-request-in-the-inbox.md)).
- The request itself always lives in this app. GoHighLevel only gets a copy of the contact and a tag for the status. A failed copy never loses or blocks a request, a price, a note or a status change.
- The copy is made only when the homeowner ticked the offers box on the form.

## Steps
1. Open the request and scroll to the card called **GoHighLevel**.
2. Read what it says.
   - **Not copied: no offers consent:** The homeowner did not tick the offers box. Nothing is sent to GoHighLevel for this request, now or when its status changes. This is correct. Stop here. You can still edit the request.
   - **Copied to GoHighLevel:** The copy is done, with the time. Stop here.
   - **Waiting to retry:** GoHighLevel did not answer. The next try is automatic. Do nothing and look again later.
   - **Copy to GoHighLevel failed:** Automatic retries have stopped. The request is safe here. Go to step 3.
   - ⚠ unverified: **Copied to GoHighLevel** and **Waiting to retry** as seen on a real screen — only **failed** and **Not copied** were seen on the staging preview. The wording above is read from the app's code. Would be verified by the first live test on the GoHighLevel test account.
3. Click **Retry copy**. The button says **Retrying** and pauses while it works. Click it only once.
4. Wait for the result.
   - The card changes to **Copied to GoHighLevel**. You are done. ⚠ unverified: a retry that ends in **Copied to GoHighLevel** — would be verified by a first live test on the GoHighLevel test account with a ticked request. So far it was tested only against a stand-in for GoHighLevel.
   - **The retry did not work.** GoHighLevel is still not answering. The copy stays marked failed. Try again later, for example the next working day.
   - **The retry could not run.** It was already running or is not needed. Reload the request to see where it stands.
5. Look at the **STAGE TAG** line. It shows only on requests where the homeowner ticked the offers box.
   - **Stage tag up to date:** Nothing to do.
   - **Stage tag waiting to retry:** The next try is automatic.
   - **Stage tag failed:** There is no button for this. The next time you change the status of this request, a new try starts.
6. If **Retry copy** does not work twice, phone Baseleap and give them the reference number.

## What you should see
- On a request with no offers consent: one line, **Not copied: no offers consent**, no button and no stage tag line.
- On a request that was copied: **Copied to GoHighLevel** with the time, then **Stage tag up to date**.

## If it goes wrong
- **Every request with the offers box ticked says "Copy to GoHighLevel failed" and Retry copy never works:** The link to GoHighLevel is not set up yet, or its sign-in key was replaced. Baseleap fixes this on their side. Phone Baseleap once and give one reference number as an example. Until it is fixed, the requests are still fully usable here.
- **There is no Retry copy button:** The button shows only while the copy is marked failed. Read step 2 again.
- **You deleted the contact in GoHighLevel:** The app never recreates a deleted contact. Phone Baseleap. They repair it from their side.
- **A homeowner asks you to stop their emails:** Remove the contact, or its **quote-request** tag, by hand in GoHighLevel. The app never adds it back for an existing request.

## Changelog
- 2026-11-25 — First version. **Retry copy** (a "Could" feature) did ship. The stage tag has no retry button; the screen says the next status change starts a new try. Live GoHighLevel is not connected yet, so step 7 is unverified — step DOC1
