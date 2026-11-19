# User Stories: Northside quote requests

Personas: Homeowner, Owner (the office helper has identical rights and is covered by the Owner stories) (defined in `docs/PRD.md` → Overview)
Tags: `[happy]` main path · `[edge]` boundary or unusual input · `[error]` failure and recovery · `[nfr]` performance, accessibility, security, audit

Conventions used in the criteria:
- "Inbox" is the sign-in-only page where the owner and helper see requests. "Request page" is the public Request a quote page.
- The inbox has two views: "List" (the newest-first list, the view it opens in) and "Board" (columns New, Quoted, Won, Lost; US-016). Unless a story says "Board", "the inbox" means the List view.
- GoHighLevel stage tags are `quote-new`, `quote-quoted`, `quote-won` and `quote-lost`; `quote-request` marks every contact the app created (US-009, US-017).
- All times shown to people are in America/Toronto (Hamilton) time.
- A "week" is Monday 00:00:00 to Sunday 23:59:59 America/Toronto.
- 5 MB means 5,242,880 bytes.
- Reference numbers look like `NQ-7K3M9P`: `NQ-` plus 6 characters from A–Z and 2–9, never I, L or O.

---

### US-001: Homeowner submits a quote request
Priority: Must · Persona: Homeowner · Serves FR: FR-1, FR-2, FR-3, FR-4, FR-5, FR-14, FR-21, FR-22

As a homeowner, I want to describe my plumbing problem on one page and get a reference number, so that I know Northside received my request without having to phone or message them.

**Acceptance criteria**
- **AC-001.1** [happy] Given a homeowner on a phone opens the Request page and enters name "Dana Whitfield", phone "905-555-0142", email "dana@example.com", address "14 Barton St W, Hamilton ON", problem "Kitchen tap drips constantly and the cabinet under it is wet" and urgency "Soon", when she taps Send, then she sees a confirmation showing a reference number like `NQ-7K3M9P` and the request is stored with status New.
- **AC-001.2** [edge] Given the homeowner leaves name, phone, email, address, problem and urgency empty, when she taps Send, then each empty field shows its own message next to it, nothing is stored, and no reference number is shown.
- **AC-001.3** [edge] Given a problem description of 9 characters, 10 characters and 2,001 characters in turn, when she taps Send, then the 9-character and 2,001-character versions are refused with a message that states the allowed length (10 to 2,000) and the 10-character version is accepted.
- **AC-001.4** [edge] Given the phone "12345" or the email "dana@", when she taps Send, then the form refuses it with a message beside that field, and keeps everything else she typed.
- **AC-001.5** [edge] Given the name is `Zoë O'Brien <script>alert(1)</script>`, when the request is sent and later opened in the inbox, then the name appears as plain text and no script runs.
- **AC-001.6** [edge] Given the homeowner double-taps Send within one second, when both taps reach the server, then exactly one request exists and one reference number is shown.
- **AC-001.7** [edge] Given the same phone number sends two separate requests an hour apart, when both are submitted, then two requests exist with two different reference numbers.
- **AC-001.8** [error] Given the database cannot be reached, when she taps Send, then she sees "We couldn't send your request. Please try again.", every field she typed is still on the screen, no reference number is shown, and nothing partial appears in the inbox once the database is back.
- **AC-001.9** [error] Given the GoHighLevel copy cannot be made (service down, or no token configured), when she taps Send, then she still sees the confirmation with a reference number and the request is stored.
- **AC-001.10** [nfr] Given a simulated 4G phone connection, when the Request page is opened, then the form is visible and usable within 3 seconds.
- **AC-001.11** [nfr] Given a keyboard-only user on the Request page, when they tab through it, then every field has a visible label, focus order follows the visual order, and the page passes an automated WCAG 2.1 AA check with 0 serious or critical violations.
- **AC-001.12** [nfr] Given any request is submitted, when it is stored, then no email and no SMS is sent to anyone and no call is made to any email or SMS service.
- **AC-001.13** [nfr] Given the staging project, when its region is inspected, then the database that holds the request is in ca-central-1.

**Notes:** Field limits: name 2–100 characters; phone 10 digits after removing spaces, dashes, brackets and an optional leading +1; email valid format, up to 254 characters; address 5–200 characters; problem 10–2,000 characters; urgency is one of three options (Emergency, Soon, Flexible) with none preselected. The page shows one line of text: "Northside will use these details only to reply to your quote request." (wording decided as OQ-10A; checked again before any real client). Urgency labels: Emergency = "Emergency: active leak or no water, need someone today"; Soon = "Soon: within the next few days"; Flexible = "Flexible: within the next two weeks, no rush".
**Out of scope:** photo handling (US-002), spam checks (US-003), homeowner status lookup (Non-goal NG-3), service-area check (NG-8).

---

### US-002: Homeowner attaches up to 3 photos
Priority: Must · Persona: Homeowner · Serves FR: FR-3, FR-6, FR-7, FR-22

As a homeowner, I want to attach photos of the problem, so that the plumber can see what is wrong before replying.

**Acceptance criteria**
- **AC-002.1** [happy] Given three JPEG photos of 2 MB each, when the homeowner attaches them and taps Send, then thumbnails show before sending, the confirmation appears, and all 3 photos are stored with the request.
- **AC-002.2** [edge] Given 3 photos are already attached, when she tries to add a 4th, then the 4th is not added and a message says "You can add up to 3 photos".
- **AC-002.3** [edge] Given a photo of 5,242,881 bytes, when she adds it, then it is refused next to that photo with "Each photo must be 5 MB or smaller" and her other fields and photos are kept; a photo of exactly 5,242,880 bytes is accepted.
- **AC-002.4** [edge] Given a PDF, or a text file renamed to `leak.jpg`, when she adds it, then it is refused with "Photos must be JPEG, PNG or WebP" and is not stored.
- **AC-002.5** [edge] Given no photos attached, when she taps Send with all other fields valid, then the request is accepted and the inbox shows "No photos" for it.
- **AC-002.6** [error] Given the network drops while photo 2 of 3 is uploading, when the upload fails, then the error appears next to photo 2, no reference number is shown, the form and the other photos stay in place, nothing partial appears in the inbox, and tapping Send again after reconnecting completes the request.
- **AC-002.7** [nfr] Given a simulated 4G connection and 3 photos of 5 MB each, when she taps Send, then the confirmation appears within 20 seconds.
- **AC-002.8** [nfr] Given a stored photo, when someone who is not signed in requests its address directly, then the photo is not returned.
- **AC-002.9** [nfr] Given the staging project, when its storage region is inspected, then the photo bucket is private and in ca-central-1.

**Notes:** Photos are optional. Accepted types are JPEG, PNG and WebP. HEIC is not accepted in v1 (see OQ-2). The file type is checked by content, not by file name.
**Out of scope:** photo editing or rotation, video, more than 3 photos.

---

### US-003: The public form resists spam without a puzzle
Priority: Must · Persona: Owner · Serves FR: FR-8, FR-21

As the owner, I want junk submissions blocked without making homeowners solve a puzzle, so that my inbox holds real requests only and customers are not put off.

**Acceptance criteria**
- **AC-003.1** [happy] Given a homeowner who spends 40 seconds filling the form, when she taps Send, then the request is accepted and she was never shown a puzzle, tick-box challenge or third-party widget.
- **AC-003.2** [edge] Given a submission where the hidden extra field contains any text, when it is sent, then no request is stored, no reference number is issued, and the response does not say which check failed.
- **AC-003.3** [edge] Given a submission that arrives less than 3 seconds after the page was loaded, when it is sent, then it is refused with "We couldn't send your request. Please try again." and the same form sent again after 3 seconds is accepted.
- **AC-003.4** [edge] Given 6 valid submissions from one network address within 10 minutes, when the 6th is sent, then the first 5 are accepted and the 6th is refused with "Too many requests. Please try again in a few minutes."
- **AC-003.5** [error] Given the rate-limit counter cannot be read, when a valid submission arrives, then it is accepted and stored, and the honeypot and 3-second checks still apply.
- **AC-003.6** [nfr] Given the Request page is loaded, when its network requests are listed, then there are 0 requests to any CAPTCHA or bot-detection vendor.

**Notes:** Thresholds (honeypot, 3 seconds, 5 per 10 minutes per network address) are decided defaults (OQ-1A). Every refusal records a `spam_submission_blocked` event.
**Out of scope:** CAPTCHA or any challenge vendor (NG-2), blocking by country, reviewing blocked submissions.

---

### US-004: Owner and helper sign in to the inbox
Priority: Must · Persona: Owner · Serves FR: FR-9, FR-21, FR-22

As the owner, I want only me and my office helper to be able to open the inbox, so that customers' phone numbers, addresses and photos stay private.

**Acceptance criteria**
- **AC-004.1** [happy] Given the owner has an account, when she signs in with her email and password, then she lands on the inbox.
- **AC-004.2** [happy] Given the office helper has an account, when he signs in, then he sees the same requests as the owner and can change price, note and status on them.
- **AC-004.3** [edge] Given nobody is signed in, when someone opens the inbox address, then they are sent to the sign-in page and, after signing in, land on the inbox.
- **AC-004.4** [edge] Given a wrong password, or an email that has no account, when sign-in is attempted, then both show the same message "Email or password is incorrect".
- **AC-004.5** [edge] Given 5 failed sign-in attempts for one email within 15 minutes, when a 6th attempt is made, then it is refused with a message that sign-in is paused for 15 minutes, even with the right password.
- **AC-004.6** [edge] Given a visitor on the sign-in page, when they look for a way to create an account, then there is none, and a direct request to create an account is refused.
- **AC-004.7** [error] Given a signed-in session that has expired, when the owner saves a note, then nothing is saved and she is sent to the sign-in page.
- **AC-004.8** [nfr] Given a request with no sign-in, when it asks for the list of quote requests or any one request, then it receives an authorization error and no request data.
- **AC-004.9** [nfr] Given the owner signs out, when she opens the inbox address, then she is sent to the sign-in page.

**Notes:** Exactly two accounts exist (owner, office helper), created by Baseleap before staging; no in-app account management and no sign-in method that needs an email to be sent (NG-4). A session lasts at most 7 days.
**Out of scope:** password reset by email, customer accounts, more than two users.

---

### US-005: Owner sees every request in the inbox, newest first
Priority: Must · Persona: Owner · Serves FR: FR-7, FR-10, FR-21

As the owner, I want one inbox that lists every quote request with its photos, newest first, so that nothing gets lost between phone, text and Facebook.

**Acceptance criteria**
- **AC-005.1** [happy] Given requests submitted at 09:00, 09:05 and 09:10, when the owner opens the inbox, then they are listed 09:10, 09:05, 09:00, and each row shows reference number, name, urgency, status, and submitted time in Hamilton time.
- **AC-005.2** [happy] Given the inbox is open and a homeowner submits a new request, when the owner reloads the inbox, then the new request is at the top with status New.
- **AC-005.3** [happy] Given a request with 3 photos, when the owner opens it, then she sees the name, phone (as a tap-to-call link), email (as an email link), address, problem, urgency, submitted time and all 3 photos.
- **AC-005.4** [edge] Given no requests exist, when the owner opens the inbox, then she sees "No quote requests yet" and the weekly count shows 0, 0, 0.
- **AC-005.5** [edge] Given 51 requests exist, when the owner opens the inbox, then the 50 newest are listed with a "Show more" control, and using it adds the remaining 1.
- **AC-005.6** [edge] Given a request with no photos, when the owner opens it, then it shows "No photos".
- **AC-005.7** [error] Given photo storage is unreachable, when the owner opens a request that has photos, then each photo slot shows "Photo unavailable" and the rest of the request is still shown.
- **AC-005.8** [nfr] Given 50 requests, when the owner opens the inbox on a desktop broadband connection, then the list is visible within 2 seconds.
- **AC-005.9** [nfr] Given a 375 px wide phone screen, when the owner opens the inbox and a request, then no horizontal scrolling is needed.

**Notes:** The list order is by submitted time only; changing status or price never moves a request. The owner replies to homeowners outside the app, by calling or texting the number shown. The inbox opens in the List view; the Board view is US-016 (OQ-14A, decided).
**Out of scope:** in-app messaging or email to the homeowner (NG-1), deleting or archiving requests (NG-7).

---

### US-006: Owner adds a price and a note
Priority: Must · Persona: Owner · Serves FR: FR-11, FR-21

As the owner, I want to record the price I quoted and a note on each request, so that I remember what I offered without digging through texts.

**Acceptance criteria**
- **AC-006.1** [happy] Given request `NQ-7K3M9P` with status New, when the owner enters price 450.00 and note "Replace cartridge, 2 hours, can come Thursday" and saves, then after a page reload the request shows $450.00 CAD and that note.
- **AC-006.2** [edge] Given a note with no price, when the owner saves, then the note is stored and the price stays empty.
- **AC-006.3** [edge] Given prices 0, 0.01, 99999.99, 100000.00 and 450.555 in turn, when each is saved, then 0, 100000.00 and 450.555 are refused with a message ("Enter an amount from 0.01 to 99,999.99 with at most 2 decimals") and 0.01 and 99999.99 are stored exactly as typed.
- **AC-006.4** [edge] Given a note of 1,001 characters, when the owner saves, then it is refused with a message that the limit is 1,000 characters and the text she typed stays on screen.
- **AC-006.5** [edge] Given the owner and the helper both opened the same request and the helper saved a price first, when the owner then saves a note, then she sees "This request was changed by someone else. Reload to see the latest." and the helper's price is not overwritten.
- **AC-006.6** [edge] Given a request that already has price 450.00, when the owner saves price 475.00, then the request shows 475.00 and the previous price is not shown anywhere.
- **AC-006.7** [error] Given the network drops during save, when the save fails, then she sees "Couldn't save. Try again.", the typed price and note stay on screen, and nothing changes on the stored request.

**Notes:** Price is in Canadian dollars, entered as typed, with no tax added and no payment taken (NG-5). The first time a price is saved on a request, a `quote_request_quoted` event is recorded. Saving a price does not change the status; the owner changes status herself (US-007).
**Out of scope:** price history, quote PDFs, line items, taxes, deposits.

---

### US-007: Owner changes a request's status
Priority: Must · Persona: Owner · Serves FR: FR-12, FR-21

As the owner, I want to mark a request New, Quoted, Won or Lost, so that I can see at a glance which jobs are open and which came in.

**Acceptance criteria**
- **AC-007.1** [happy] Given a request in status New, when the owner marks it Won, then the request shows Won in the list and in its detail, and the status change time is stored.
- **AC-007.2** [happy] Given a request in status New, when the owner marks it Quoted and later Lost, then it shows Lost and both changes are stored with their times.
- **AC-007.3** [edge] Given a request in status Won, when the owner marks it Lost, then it shows Lost and the Won-to-Lost change is stored with its time.
- **AC-007.4** [edge] Given a request already in status Quoted, when the owner selects Quoted again, then nothing changes and no new change time is stored.
- **AC-007.5** [edge] Given a request marked Won, when the inbox list is viewed, then the request keeps its position by submitted time and does not jump to the top.
- **AC-007.6** [error] Given the network drops while saving a status, when the save fails, then the request still shows its previous status with "Couldn't save. Try again." and nothing is stored.
- **AC-007.7** [nfr] Given any status change, when it is stored, then the record holds the previous status, the new status, the time, and which signed-in user made it.

**Notes:** Any status can be changed to any other status, because mistakes happen. New requests start as New. Concurrent edits follow the rule in AC-006.5. These criteria describe changing status from the List view; dragging a card on the Board has the same rules and effects (US-016), and every real status change also updates the GoHighLevel stage tag when US-017 is built.
**Out of scope:** automatic status changes, assignment to a user, reminders.

---

### US-008: Owner sees this week's count
Priority: Must · Persona: Owner · Serves FR: FR-13, FR-21

As the owner, I want a weekly count of requests, won and lost on the inbox, so that I can see how the week is going without counting by hand.

**Acceptance criteria**
- **AC-008.1** [happy] Given that since Monday 2026-11-16 00:00 Toronto time 4 requests were submitted, 1 request moved to Won and 1 request moved to Lost, when the owner opens the inbox on Thursday 2026-11-19, then it shows "Requests this week 4", "Won 1" and "Lost 1".
- **AC-008.2** [happy] Given the counts above, when the owner marks another request Won and the save succeeds, then Won shows 2 within 2 seconds, without signing in again.
- **AC-008.3** [edge] Given one request submitted Sunday 2026-11-15 at 23:59:59 and one on Monday 2026-11-16 at 00:00:00 Toronto time, when the owner views the week starting 2026-11-16, then only the Monday request counts in Requests this week.
- **AC-008.4** [edge] Given a request submitted last week that is marked Won this week, when the count is shown, then Won this week includes it and Requests this week does not.
- **AC-008.5** [edge] Given a request marked Won on Tuesday and moved to Lost on Wednesday of the same week, when the count is shown, then Won counts 0 for it and Lost counts 1 for it.
- **AC-008.6** [edge] Given the week of Monday 2026-10-26 to Sunday 2026-11-01 (daylight saving ends Sunday 2026-11-01), when counts are shown, then the week still runs from Monday 00:00 to Sunday 23:59:59 Toronto time.
- **AC-008.7** [edge] Given a week with no activity, when the owner opens the inbox, then it shows 0, 0 and 0.
- **AC-008.8** [error] Given the count cannot be loaded, when the owner opens the inbox, then the count area shows "Count unavailable" and the request list still loads.

**Notes:** "Won this week" counts requests whose current status is Won and whose last change to Won happened this week. "Lost this week" works the same way. "Requests this week" counts requests by submitted time. Only the current week is shown (NG-10).
**Out of scope:** past weeks, charts, export.

---

### US-009: Each new request is copied to GoHighLevel
Priority: Should · Persona: Owner · Serves FR: FR-14, FR-15, FR-22

As the owner, I want every new request to also appear in my GoHighLevel as a tagged contact, so that I can follow up from the tool I already use for marketing.

**Acceptance criteria**
- **AC-009.1** [happy] Given GoHighLevel is reachable, when a request is submitted, then within 2 minutes the GHL test sub-account has one contact with that request's name, phone, email and address and the tag `quote-request`.
- **AC-009.2** [error] Given GoHighLevel returns a server error, when a request is submitted, then the request is stored, the homeowner sees the confirmation, and the copy is marked as waiting to retry.
- **AC-009.3** [error] Given the GoHighLevel token is missing or rejected, when a request is submitted, then the request is stored, the homeowner sees the confirmation, the copy is marked as failed, and no token value appears in logs or on any screen.
- **AC-009.4** [edge] Given a copy attempt timed out although GoHighLevel did create the contact, when the retry runs, then the sub-account ends up with exactly one contact for that request.
- **AC-009.5** [edge] Given a request already copied, when the owner changes its price or note, then the GHL contact is not changed (a status change updates only its stage tag, US-017).
- **AC-009.6** [edge] Given a request with 3 photos, when it is copied, then no photo is sent to GoHighLevel.
- **AC-009.7** [nfr] Given GoHighLevel takes 30 seconds to answer, when a homeowner submits, then the confirmation still appears within 3 seconds of the request being stored.
- **AC-009.8** [nfr] Given the configuration, when it is inspected, then the only GoHighLevel destination is the test sub-account and no real client account.

**Notes:** One-way copy: the contact is created once, and afterwards the only thing the app changes on it is its stage tag (US-017). GHL's role here is email marketing; it never owns or changes a request. The contact carries name, phone, email, address and the tag `quote-request`; whether the reference number and problem text can also be attached without extra GHL setup is OQ-11 for the architect.
**Out of scope:** two-way sync, GHL pipelines or opportunities (NG-6; the pipeline lives in our app, US-016).

---

### US-010: Owner sees whether the GoHighLevel copy worked, and it retries by itself
Priority: Should · Persona: Owner · Serves FR: FR-15, FR-21

As the owner, I want to see whether a request's GoHighLevel copy succeeded and have failures retried automatically, so that a short outage does not leave my marketing contacts incomplete.

**Acceptance criteria**
- **AC-010.1** [happy] Given a request whose copy succeeded, when the owner opens it, then it shows "Copied to GoHighLevel" with the time.
- **AC-010.2** [happy] Given a request whose first copy attempt failed and GoHighLevel is back, when the next automatic retry runs, then the state changes to "Copied to GoHighLevel" with no action from the owner.
- **AC-010.3** [error] Given a request whose copy has failed 5 retries after the first attempt, when the owner opens it, then it shows "Copy to GoHighLevel failed" with the time of the last attempt, and no further automatic retries happen.
- **AC-010.4** [edge] Given a request waiting to retry, when the owner opens it, then it shows "Waiting to retry" and the owner can still change price, note and status as usual.
- **AC-010.5** [nfr] Given any failed copy attempt, when its record is read, then it holds the request id, attempt number and an error class, and holds no token and no homeowner name, phone, email or address.

**Notes:** A waiting request is retried at least once every 24 hours until it succeeds or reaches 5 retries; faster retries are welcome if the free hosting plan allows them (OQ-8, architect).
**Out of scope:** alerts when a copy fails (NG-1).

---

### US-011: Owner filters the inbox by status
Priority: Should · Persona: Owner · Serves FR: FR-16, FR-21

As the owner, I want to filter the inbox to New, Quoted, Won or Lost, so that I can find the requests that still need a reply.

**Acceptance criteria**
- **AC-011.1** [happy] Given 3 New, 2 Quoted and 1 Won request, when the owner chooses the New filter, then exactly the 3 New requests are listed, newest first.
- **AC-011.2** [edge] Given no Lost requests, when the owner chooses the Lost filter, then she sees "No lost requests".
- **AC-011.3** [edge] Given a filter is on and the owner marks a listed request Won, when the save succeeds, then the request leaves a New filter list without a full page reload.
- **AC-011.4** [error] Given the list cannot be loaded, when the owner chooses a filter, then she sees "Couldn't load requests. Try again." and the previous list is not shown as if it were filtered.

**Notes:** Filter choices are All, New, Quoted, Won, Lost. The weekly count is not affected by the filter. The filter applies to the List view only; the Board always shows every request in its status column.
**Out of scope:** saved filters, sorting by urgency.

---

### US-012: Owner opens photos at full size
Priority: Should · Persona: Owner · Serves FR: FR-7, FR-17, FR-21

As the owner, I want to open a photo at full size, so that I can judge the problem from the picture.

**Acceptance criteria**
- **AC-012.1** [happy] Given a request with 3 photos, when the owner taps the second thumbnail, then that photo opens at full size and she can move to the other two.
- **AC-012.2** [edge] Given the full-size photo is open, when the owner closes it, then she returns to the same request at the same scroll position.
- **AC-012.3** [error] Given the request page has been open for 2 hours, when the owner taps a thumbnail, then the photo still opens without asking her to sign in again.

**Notes:** none
**Out of scope:** zoom, download, rotate.

---

### US-013: Owner searches requests
Priority: Could · Persona: Owner · Serves FR: FR-18, FR-21

As the owner, I want to search by reference number, name or phone, so that I can find a request when a customer calls me back.

**Acceptance criteria**
- **AC-013.1** [happy] Given a request with reference `NQ-7K3M9P`, when the owner types "nq-7k3m9p" in search, then that request is listed.
- **AC-013.2** [edge] Given no request matches "zzz", when the owner searches it, then she sees "No matching requests".
- **AC-013.3** [edge] Given a request for "Dana Whitfield", when the owner searches "whit", then that request is listed.

**Notes:** Build only if the architect says it is nearly free. Search applies to the List view only.
**Out of scope:** searching the problem text or address, searching on the Board.

---

### US-014: Owner retries a failed GoHighLevel copy by hand
Priority: Could · Persona: Owner · Serves FR: FR-19, FR-21

As the owner, I want a Retry button on a failed copy, so that I can fix it myself once GoHighLevel is back.

**Acceptance criteria**
- **AC-014.1** [happy] Given a request showing "Copy to GoHighLevel failed" and GoHighLevel is reachable, when the owner presses Retry, then the state becomes "Copied to GoHighLevel".
- **AC-014.2** [error] Given GoHighLevel is still down, when the owner presses Retry, then the state stays "Copy to GoHighLevel failed" and a message says the retry did not work.
- **AC-014.3** [edge] Given the owner double-clicks Retry, when GoHighLevel is reachable, then the sub-account ends up with exactly one contact for that request.

**Notes:** Build only if the architect says it is nearly free.
**Out of scope:** bulk retry.

---

### US-015: Owner sees who last changed a request
Priority: Could · Persona: Owner · Serves FR: FR-20, FR-21

As the owner, I want to see who last changed a request and when, so that I can tell whether my helper already dealt with it.

**Acceptance criteria**
- **AC-015.1** [happy] Given the helper saved a note on a request at 14:05, when the owner opens it, then it shows "Last updated by Office helper at 14:05".
- **AC-015.2** [edge] Given a request nobody has changed, when the owner opens it, then it shows "Not updated yet".

**Notes:** The stored audit data already exists from AC-007.7; this story only displays it.
**Out of scope:** full change history.

---

### US-016: Owner moves requests across a pipeline board
Priority: Must · Persona: Owner · Serves FR: FR-12, FR-21, FR-23

As the owner, I want to see my requests as cards in New, Quoted, Won and Lost columns and drag a card to change its status, so that I can see the whole pipeline at a glance and update a job in one move.

**Acceptance criteria**
- **AC-016.1** [happy] Given the inbox holds 2 New, 1 Quoted, 1 Won and 1 Lost request, when the owner switches from List to Board, then she sees four columns in the order New, Quoted, Won, Lost holding 2, 1, 1 and 1 cards, and each card shows reference number, name, urgency and submitted time in Hamilton time.
- **AC-016.2** [happy] Given request `NQ-7K3M9P` is a card in New, when the owner drags it into the Won column and drops it, then the card shows in Won, the request still shows Won after a page reload, the previous status, new status, time and user are stored, and the weekly Won count rises by 1 within 2 seconds.
- **AC-016.3** [happy] Given an owner using only the keyboard, when she tabs to the card for `NQ-7K3M9P`, opens its "Move to" menu with Enter and chooses "Quoted" with the arrow keys and Enter, then the card shows in Quoted with the same stored change and weekly count effect as AC-016.2, focus stays on that card, and the message "NQ-7K3M9P moved to Quoted" is exposed to screen readers.
- **AC-016.4** [happy] Given the owner moved `NQ-7K3M9P` to Won on the Board, when she switches to List, then the list shows newest first with `NQ-7K3M9P` at its submitted-time position and status Won, and switching back to Board shows its card in Won.
- **AC-016.5** [happy] Given a card on the Board, when the owner clicks its reference number or presses Enter on it, then the request detail opens with every submitted field, the photos, the price, the note and the status control, the same as when opened from the list.
- **AC-016.6** [edge] Given a card in Quoted, when the owner drops it back into the Quoted column, then nothing is stored, no new change time is recorded and no `quote_request_status_changed` event is fired.
- **AC-016.7** [edge] Given a card is being dragged out of New, when the owner releases it outside all four columns or presses Escape, then the card returns to its position in New and nothing is stored.
- **AC-016.8** [edge] Given the Won column holds cards submitted at 09:10 and 08:00 and `NQ-7K3M9P` submitted at 09:00 is dropped into it, when the column is shown, then the cards read 09:10, 09:00, 08:00 and the moved card is not placed at the top.
- **AC-016.9** [edge] Given the Board is open, when the owner looks for a way to add, rename, delete or reorder a column, then none is offered anywhere on the Board.
- **AC-016.10** [edge] Given 51 requests are Quoted and 2 are New, when the owner opens the Board, then Quoted shows its 50 newest cards with a "Show more" control that adds the remaining 1, and New shows both of its cards with no "Show more".
- **AC-016.11** [edge] Given no request is Lost, when the owner opens the Board, then the Lost column shows "No lost requests" and a card dropped into it is accepted.
- **AC-016.12** [edge] Given the owner and the helper both have the Board open and the helper moved `NQ-7K3M9P` from New to Won first, when the owner then drags that card, still shown in New on her screen, to Lost, then her card returns to New, she sees "This request was changed by someone else. Reload to see the latest." and the request stays Won.
- **AC-016.13** [error] Given the network drops as the owner drops a card into Won, when the save fails, then the card first shows in Won marked "Saving", then returns to its original column and position, "Couldn't save. Try again." shows, nothing is stored and the weekly Won count is unchanged; the same happens when the move was made with the "Move to" menu.
- **AC-016.14** [error] Given the owner's session has expired, when she drops a card into Won, then the card returns to its original column, nothing is saved and she is sent to the sign-in page.
- **AC-016.15** [error] Given the requests cannot be loaded, when the owner switches to Board, then she sees "Couldn't load requests. Try again." and no empty columns are shown.
- **AC-016.16** [nfr] Given the Board holds 10 cards across the four columns, when an automated WCAG 2.1 AA check runs on it, then it reports 0 serious or critical violations.
- **AC-016.17** [nfr] Given a 375 px wide phone screen, when the owner opens the Board and chooses a status from a card's "Move to" menu with taps only, then the card moves to that column and the page needs no horizontal scrolling.
- **AC-016.18** [nfr] Given 50 requests spread across the four columns, when the owner opens the Board on a desktop broadband connection, then all 50 cards are visible within 2 seconds.

**Notes:** The List view stays as built in US-005 and the inbox opens in it (OQ-14A, decided). Dropping a card or using "Move to" follows the same rules and has the same effects as changing status from the list (US-007, FR-12): any status to any other, the previous status, new status, time and user stored, the weekly count updated, the `quote_request_status_changed` event fired, and (when US-017 is built) the GoHighLevel stage tag updated. Moving a card to Quoted changes the status only: it neither requires nor sets a price and does not fire `quote_request_quoted` (that event fires when a price is first saved, US-006). The Board saves in our app whether or not GoHighLevel is reachable. The List filter (US-011) and search (US-013) do not apply to the Board. The owner and the helper have identical rights.
**Out of scope:** adding, renaming, removing or reordering columns (NG-14), manual card ordering, per-column totals, swimlanes or card colours (NG-15), moving several cards at once, assigning a card to a person (NG-9).

---

### US-017: A status change updates the request's GoHighLevel stage tag
Priority: Should · Persona: Owner · Serves FR: FR-21, FR-22, FR-24

As the owner, I want each request's GoHighLevel contact to carry a tag for its current stage, so that my email marketing in GoHighLevel can tell new, quoted, won and lost contacts apart.

**Acceptance criteria**
- **AC-017.1** [happy] Given request `NQ-7K3M9P` was copied to GoHighLevel with tags `quote-request` and `quote-new`, when the owner drags its card to Quoted, then within 2 minutes the contact carries `quote-request` and `quote-quoted` and no longer carries `quote-new`, and the request detail shows "Stage tag up to date".
- **AC-017.2** [happy] Given the same contact, when the owner marks the request Won from the List view, then within 2 minutes the contact carries `quote-request` and `quote-won` and no other stage tag.
- **AC-017.3** [happy] Given GoHighLevel is reachable, when a homeowner submits a request, then the new contact carries `quote-request` and `quote-new`.
- **AC-017.4** [edge] Given a request at Won whose contact carries `quote-won`, when the owner moves it back to New, then within 2 minutes the contact carries `quote-new` and no longer carries `quote-won`.
- **AC-017.5** [edge] Given a request already in Quoted, when the owner selects Quoted again, then no tag update is attempted and the contact's tags are unchanged.
- **AC-017.6** [edge] Given GoHighLevel is reachable, when the owner moves a request from New to Quoted to Won within 10 seconds, then within 2 minutes the contact carries `quote-won` as its only stage tag and does not end with `quote-quoted`.
- **AC-017.7** [edge] Given the contact copy for a new request is waiting to retry, when the owner marks the request Won before the copy succeeds, then once the copy succeeds the contact exists with `quote-request` and `quote-won` and no other stage tag.
- **AC-017.8** [edge] Given the owner added her own tag `repeat-customer` to the contact inside GoHighLevel, when the request's status changes, then `repeat-customer` is still on the contact.
- **AC-017.9** [error] Given GoHighLevel returns a server error, when the owner marks a request Won, then the request shows Won in the app, the detail shows "Stage tag waiting to retry", and once GoHighLevel is back the next automatic retry sets `quote-won` and the detail shows "Stage tag up to date".
- **AC-017.10** [error] Given the GoHighLevel token is missing or rejected, when the owner marks a request Won, then the request shows Won in the app, the detail shows "Stage tag failed", and no token value appears in logs or on any screen.
- **AC-017.11** [error] Given a stage-tag push has failed 5 retries after its first attempt, when the owner opens the request, then the detail shows "Stage tag failed" with the time of the last attempt, no further automatic retries happen for that push, and the next status change starts a new push.
- **AC-017.12** [nfr] Given GoHighLevel takes 30 seconds to answer, when the owner changes a status by drag or from the list, then the new status shows within 3 seconds of her action.
- **AC-017.13** [nfr] Given any failed stage-tag attempt, when its record is read, then it holds the request id, attempt number, error class and target status, and holds no token and no homeowner name, phone, email or address.
- **AC-017.14** [edge] Given the owner changed the contact's phone number inside GoHighLevel, when the request's status changes, then the phone number in GoHighLevel is unchanged.

**Notes:** Depends on US-009 (the contact must exist) and uses the retry rule of US-010 (at least every 24 hours, up to 5 retries after the first attempt, OQ-8A); it is cut before them. Tag names and the removal of the previous stage tag are OQ-13A (decided). Every retry applies the request's current status, never an older one. The app only adds and removes its own five tags (`quote-request` and the four stage tags) and changes no other tag or field on the contact; GoHighLevel stays non-authoritative. Whether the test sub-account allows tag changes, and whether a missing tag is created automatically, is OQ-15 for the architect.
**Out of scope:** two-way sync, reading tags back from GoHighLevel, GHL pipelines or opportunities (NG-6), a manual retry button for tags, alerts when a push fails (NG-1).

---

## Suggested build order
1. US-001 — thinnest end-to-end slice: homeowner submits and the request is stored with a reference number
2. US-004 — sign-in and protected inbox data, needed before any owner screen
3. US-005 — inbox list and request detail (the E2E "sees it at the top of the inbox" step)
4. US-002 — photos on submit and in the inbox (the E2E starts "with photos")
5. US-006 — price and note
6. US-007 — status changes
7. US-008 — weekly count (the last E2E step)
8. US-016 — pipeline board (needs the list from US-005 and the status rules from US-007; the "marks it won" E2E step can be done from the list or by drag)
9. US-003 — spam protection, before the public page is released (can be built in parallel with 5–8)
10. US-009, then US-010, then US-017 — GoHighLevel copy, its state and retry, then the stage tag (Should; the first to cut if the run overruns, last built is first cut)
11. US-011, US-012 — filter and full-size photo (Should)
12. US-013, US-014, US-015 — Could, only if nearly free

Cut order if the run overruns: US-013, US-014, US-015, US-012, US-011, US-017, US-010, US-009.
