# Move requests on the Pipeline board

**Purpose:** Change a request's status by dragging its card to another column, or with the **Move to** button.
**Who:** The owner or the office helper · **When:** Whenever a request moves from New to Quoted, Won or Lost, or back · **Kind:** 5 client staff
**Evidence:** see [evidence](../evidence.md#move-requests-on-the-board)

## Before you start
- You are signed in. If not, follow "Work a quote request in the inbox", steps 1 to 4 ([work-a-request-in-the-inbox.md](work-a-request-in-the-inbox.md)).
- The board is its own tab, called **Pipeline**. There is no Board switch on the **Requests** tab. Use the top bar on a computer, or the bar at the bottom on a phone.
- The four columns are fixed: **New**, **Quoted**, **Won**, **Lost**. You cannot add, rename or remove a column.

## Steps
1. Click the **Pipeline** tab.
2. Wait for the four columns. Each card shows the reference, the name, the urgency and the time it was sent. On a phone the columns are stacked. Use **Jump to a column** to reach **Lost** without scrolling.
3. Move a card in one of two ways.
   - **Move to:** click **Move to** on the card. A menu opens with the other three statuses. Click the one you want.
   - **Drag (screens 1280 pixels wide or more):** with a mouse, press on the card and hold. Do not press on its buttons. With a finger or a pen, press and hold the grip, the six dots at the top right of the card. Move the card over another column. The column shows "Release to move to …". Let go.
4. To cancel a drag, press **Escape** or let go outside the columns. Nothing is saved.
5. Look at the card. It shows **Saving** for a moment, then stays in its new column.
6. Look at **THIS WEEK** above the columns. **Won** and **Lost** change within 2 seconds.
7. To open a request, click its reference. Click **Back to Pipeline** to return.
8. A column shows 50 cards at a time. Click **Show more** under a column to see the next ones. Search and filters are on the **Requests** tab, not here. ⚠ unverified: **Show more** on the board — would be verified by a staging run with 51 requests in one column. QA has not run that test.

## What you should see
- After step 5: a message such as "NQ-… moved to Won" and the card in the new column.
- ⚠ unverified: The **Requests** tab lists the same request with its new status, in the same place by time. Moving a card never moves it to the top. This is from the design, and QA has no test for it. It would be verified by a check of the Requests tab after a move.
- Moving to **Quoted** changes the status only. It does not save a price. Open the request to add one.

## If it goes wrong
- **"Couldn't save. Try again.":** The card goes back to its old column. The message says "… is still in …. Nothing was changed and the weekly count is the same." Try the move again with **Move to**. If it fails twice, phone Baseleap.
- **"This request was changed by someone else. Reload to see the latest.":** Your move was not saved. The card stays as the other person left it. Click **Reload**, then move it again if you still need to.
- **You are sent to the sign-in page:** Your session ended. The card went back and nothing was saved. Sign in and move it again.
- **"Couldn't load requests. Try again.":** No columns are shown, so an empty column is never a false "no requests". Click **Try again**. The **Requests** tab is one tap away.
- **A drag does nothing on a phone or small tablet:** Dragging needs a screen 1280 pixels wide or more. Use **Move to** instead.
- **A card was dropped in its own column:** Nothing is saved. This is normal.

## Changelog
- 2026-11-25 — First version, written from the Pipeline tab on the staging preview (commit 04dd79a), QA's board tests and the visual evidence. The plan said "switch to Board"; the built app has a separate **Pipeline** tab — step DOC1
