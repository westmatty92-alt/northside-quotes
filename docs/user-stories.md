# User Stories: Northside quote requests

Personas: Homeowner, Owner (the office helper has identical rights and is covered by the Owner stories) (defined in `docs/PRD.md` → Overview)
Tags: `[happy]` main path · `[edge]` boundary or unusual input · `[error]` failure and recovery · `[nfr]` performance, accessibility, security, audit

Conventions used in the criteria:
- "Inbox" is the sign-in-only area where the owner and helper see requests. "Request page" is the public Request a quote page.
- The inbox has two tabs, each with its own address and never a toggle (FR-26): "Requests" (the newest-first list, where signing in lands) and "Pipeline" (the board with columns New, Quoted, Won, Lost; US-016). Unless a story says "Pipeline", "the inbox" means the Requests tab.
- The "offers box" is the optional checkbox on the Request page that is never ticked when the page loads. Only requests whose homeowner ticked it ("consented" requests) are ever sent to GoHighLevel (FR-25, FR-15).
- GoHighLevel stage tags are `quote-new`, `quote-quoted`, `quote-won` and `quote-lost`; `quote-request` marks every contact the app created or linked (US-009, US-017).
- All times shown to people are in America/Toronto (Hamilton) time.
- A "week" is Monday 00:00:00 to Sunday 23:59:59 America/Toronto.
- 5 MB means 5,242,880 bytes.
- Reference numbers look like `NQ-7K3M9P`: `NQ-` plus 6 characters from A–Z and 2–9, never I, L or O.

---

### US-001: Homeowner submits a quote request
Priority: Must · Persona: Homeowner · Serves FR: FR-1, FR-2, FR-3, FR-4, FR-5, FR-14, FR-21, FR-22, FR-25

As a homeowner, I want to describe my plumbing problem on one page and get a reference number, so that I know Northside received my request without having to phone or message them.

**Acceptance criteria**
- **AC-001.1** [happy] Given a homeowner on a phone opens the Request page and enters name "Dana Whitfield", phone "905-555-0142", email "dana@example.com", address "14 Barton St W, Hamilton ON", problem "Kitchen tap drips constantly and the cabinet under it is wet" and urgency "Soon", and leaves the offers box as it was when the page loaded, when she taps Send, then she sees a confirmation showing a reference number like `NQ-7K3M9P` and the request is stored with status New.
- **AC-001.2** [edge] Given the homeowner leaves name, phone, email, address, problem and urgency empty, when she taps Send, then each empty field shows its own message next to it, nothing is stored, and no reference number is shown.
- **AC-001.3** [edge] Given a problem description of 9 characters, 10 characters and 2,001 characters in turn, when she taps Send, then the 9-character and 2,001-character versions are refused with a message that states the allowed length (10 to 2,000) and the 10-character version is accepted.
- **AC-001.4** [edge] Given the phone "12345" or the email "dana@", when she taps Send, then the form refuses it with a message beside that field, and keeps everything else she typed.
- **AC-001.5** [edge] Given the name is `Zoë O'Brien <script>alert(1)</script>`, when the request is sent and later opened in the inbox, then the name appears as plain text and no script runs.
- **AC-001.6** [edge] Given the homeowner double-taps Send within one second, when both taps reach the server, then exactly one request exists and one reference number is shown.
- **AC-001.7** [edge] Given the same phone number sends two separate requests an hour apart, when both are submitted, then two requests exist with two different reference numbers.
- **AC-001.8** [error] Given the database cannot be reached, when she taps Send, then she sees "We couldn't send your request. Please try again.", every field she typed is still on the screen, no reference number is shown, and nothing partial appears in the inbox once the database is back.
- **AC-001.9** [error] Given she ticked the offers box and the GoHighLevel copy cannot be made (service down, or no token configured), when she taps Send, then she still sees the confirmation with a reference number and the request is stored.
- **AC-001.10** [nfr] Given a simulated 4G phone connection, when the Request page is opened, then the form is visible and usable within 3 seconds.
- **AC-001.11** [nfr] Given a keyboard-only user on the Request page, when they tab through it, then every field has a visible label, focus order follows the visual order, and the page passes an automated WCAG 2.1 AA check with 0 serious or critical violations.
- **AC-001.12** [nfr] Given any request is submitted, when it is stored, then no email and no SMS is sent to anyone and no call is made to any email or SMS service.
- **AC-001.13** [nfr] Given the staging project, when its region is inspected, then the database that holds the request is in ca-central-1.
- **AC-001.14** [happy] Given a homeowner fills every required field and ticks the offers box, when she taps Send, then she sees the confirmation with a reference number and the request is stored with consent "yes" and a consent time equal to the time the request was stored.
- **AC-001.15** [edge] Given the Request page has just loaded, when the homeowner looks at the offers box and sends a valid request without touching it, then the box was unticked, the request is stored with consent "no" and no consent time, and it is confirmed with a reference number like any other.
- **AC-001.16** [edge] Given she ticked the offers box and left the email empty, when she taps Send, then the email message shows next to its field, nothing is stored, and the offers box is still ticked with her other entries.
- **AC-001.17** [edge] Given a request sent straight to the form's address with no offers value, and another with the value "maybe", when each is submitted, then both are stored with consent "no" and no consent time.
- **AC-001.18** [nfr] Given a keyboard-only user on the Request page, when they tab to the offers box, then it has a visible label reading "Email me offers and news from Northside. This is optional.", Space ticks and unticks it, and an automated WCAG 2.1 AA check reports 0 serious or critical violations.

**Notes:** Field limits: name 2–100 characters; phone 10 digits after removing spaces, dashes, brackets and an optional leading +1; email valid format, up to 254 characters; address 5–200 characters; problem 10–2,000 characters; urgency is one of three options (Emergency, Soon, Flexible) with none preselected. The form also has the optional offers box (label "Email me offers and news from Northside. This is optional."; never ticked on load, never required; ruling 1B of 2026-11-20). The page shows one line of text: "Northside will use these details to reply to your quote request. It will email you offers only if you tick the box." (the earlier "only to reply" line is replaced because a tick now allows offers; wording checked again before any real client, OQ-16). A ticked box is stored as consent "yes" with its time and is the only thing that lets the request reach GoHighLevel (US-009); it is not editable afterwards (NG-16). Urgency labels: Emergency = "Emergency: active leak or no water, need someone today"; Soon = "Soon: within the next few days"; Flexible = "Flexible: within the next two weeks, no rush".
**Out of scope:** photo handling (US-002), spam checks (US-003), homeowner status lookup (Non-goal NG-3), service-area check (NG-8), changing or withdrawing the offers choice after sending (NG-16).

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
- **AC-003.7** [edge] Given one network address sends 30 submissions with the hidden field filled within 10 minutes, when all 30 are sent, then all 30 are refused with nothing stored, and exactly 1 `spam_submission_blocked` event with reason honeypot exists for that address in that window, with `count` 30 and no network address in the event.
- **AC-003.8** [edge] Given 1,000 `spam_submission_blocked` events were already recorded today (Hamilton day), when a different address sends a submission with the hidden field filled, then it is refused exactly as before, no reference number is issued, and the events table gains no new row.

**Notes:** Thresholds (honeypot, 3 seconds, 5 per 10 minutes per network address) are decided defaults (OQ-1A). Refusals are logged as `spam_submission_blocked` events, capped at one event per network address and reason per 10 minutes (its `count` holds every refusal in the window) and 1,000 events a day in total (S0 finding SEC-14, FR-8); a refusal past either cap is still refused and is not logged as a new event, so the blocked-share guardrail reads low on a flood day (accepted).
**Out of scope:** CAPTCHA or any challenge vendor (NG-2), blocking by country, reviewing blocked submissions.

---

### US-004: Owner and helper sign in to the inbox
Priority: Must · Persona: Owner · Serves FR: FR-9, FR-21, FR-22, FR-26, FR-27

As the owner, I want only me and my office helper to be able to open the inbox, so that customers' phone numbers, addresses and photos stay private.

**Acceptance criteria**
- **AC-004.1** [happy] Given the owner has an account, when she signs in with her email and password, then she lands on the Requests tab, and the main navigation shows two tabs, Requests and Pipeline, with Requests marked as current.
- **AC-004.2** [happy] Given the office helper has an account, when he signs in, then he sees the same requests as the owner and can change price, note and status on them.
- **AC-004.3** [edge] Given nobody is signed in, when someone opens the Requests tab's address, then they are sent to the sign-in page and, after signing in, land on the Requests tab.
- **AC-004.4** [edge] Given a wrong password, or an email that has no account, when sign-in is attempted, then both show the same message "Email or password is incorrect".
- **AC-004.5** [edge] Given 5 failed sign-in attempts for the owner's email within 15 minutes, when a 6th attempt is made at once with the right password, then it is refused with "Too many sign-in attempts. Try again in a few minutes.", and a further attempt 5 minutes after the 5th failure with the right password signs her in.
- **AC-004.6** [edge] Given a visitor on the sign-in page, when they look for a way to create an account, then there is none, and a direct request to create an account is refused.
- **AC-004.7** [error] Given a signed-in session that has expired, when the owner saves a note, then nothing is saved and she is sent to the sign-in page.
- **AC-004.8** [nfr] Given a request with no sign-in, when it asks for the list of quote requests or any one request, then it receives an authorization error and no request data.
- **AC-004.9** [nfr] Given the owner signs out, when she opens the inbox address, then she is sent to the sign-in page.
- **AC-004.10** [edge] Given the owner has forgotten her password, when she looks at the sign-in page and at every signed-in screen, then there is no "forgot password" link and no way to change or reset a password, and a direct request to change or reset one is refused and sends no email.
- **AC-004.11** [edge] Given 20 failed sign-in attempts from one network address within 15 minutes, spread over 5 different emails with 4 failures each, so that no single email reached 5, when a 21st attempt is made from that address with the owner's right email and password, then it is refused with "Too many sign-in attempts. Try again in a few minutes.", and an attempt from another address with the same right credentials signs her in.
- **AC-004.12** [edge] Given 5 failed sign-in attempts within 15 minutes for an email that has no account, when a 6th attempt is made for it, then the refusal is the same message as for a real account, and the message does not show whether the email has an account.
- **AC-004.13** [error] Given the sign-in attempt counters cannot be read, when the owner signs in with the right email and password, then sign-in is refused with "Sign-in is unavailable. Try again in a few minutes." and no session starts.
- **AC-004.14** [edge] Given nobody is signed in, when someone opens the Pipeline tab's address, then they are sent to the sign-in page and, after signing in, land on the Pipeline tab.

**Notes:** Exactly two accounts exist (owner, office helper), created by Baseleap before staging; Baseleap sets each password, hands it over by phone and resets a forgotten one from the Supabase dashboard, and there is no in-app account management, password change or reset, and no sign-in method that needs an email to be sent (NG-4, FR-27). A session lasts at most 7 days. Sign-in limits (ruling 4A, SEC-11, FR-9): 5 failed attempts per email in 15 minutes pause that email for 5 minutes, 20 failed attempts per network address in 15 minutes pause that address for 15 minutes, and each count restarts when its pause ends. Trade-off in plain words: someone who knows the owner's email can keep her out for 5 minutes at a time, and people behind the same address as a guesser are paused with them; she waits or phones Baseleap. Open: password strength (OQ-17).
**Out of scope:** password change or reset by the user or by email, customer accounts, more than two users, any alert when a lockout happens (NG-1).

---

### US-005: Owner sees every request in the inbox, newest first
Priority: Must · Persona: Owner · Serves FR: FR-7, FR-10, FR-21, FR-26

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
- **AC-005.10** [happy] Given the owner is signed in and has saved the address of the Requests tab, when she opens that address directly in a new browser tab, then the Requests list opens with the weekly count, Requests is marked as current in the main navigation, and the Pipeline tab's address is a different address.

**Notes:** The list order is by submitted time only; changing status or price never moves a request. The owner replies to homeowners outside the app, by calling or texting the number shown. Signing in lands on the Requests tab; Pipeline is its own tab with its own address, not a view inside this one (US-016, FR-26, OQ-14A reworded 2026-11-20). The weekly count shows on both tabs (OQ-18).
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

**Notes:** Any status can be changed to any other status, because mistakes happen. New requests start as New. Concurrent edits follow the rule in AC-006.5. These criteria describe changing status from the Requests tab; dragging a card on the Pipeline tab has the same rules and effects (US-016), and every real status change of a consented request also updates the GoHighLevel stage tag when US-017 is built.
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

**Notes:** "Won this week" counts requests whose current status is Won and whose last change to Won happened this week. "Lost this week" works the same way. "Requests this week" counts requests by submitted time. Only the current week is shown (NG-10). The three numbers show on both the Requests and the Pipeline tab (FR-13, OQ-18); the criteria above are written for the Requests tab and hold on Pipeline too.
**Out of scope:** past weeks, charts, export.

---

### US-009: Requests from homeowners who agreed to offers are copied to GoHighLevel
Priority: Should · Persona: Owner · Serves FR: FR-14, FR-15, FR-22, FR-25

As the owner, I want a request to appear in my GoHighLevel as one tagged contact per homeowner, and only when that homeowner agreed to offers, so that I can follow up from the tool I already use for marketing without emailing anyone who did not say yes.

**Acceptance criteria**
- **AC-009.1** [happy] Given a homeowner ticked the offers box and GoHighLevel is reachable, when the request is submitted, then within 2 minutes the GHL test sub-account has one contact with that request's name, phone, email and address and the tag `quote-request`.
- **AC-009.2** [error] Given a homeowner ticked the offers box and GoHighLevel returns a server error, when the request is submitted, then the request is stored, the homeowner sees the confirmation, and the copy is marked as waiting to retry.
- **AC-009.3** [error] Given a homeowner ticked the offers box and the GoHighLevel token is missing or rejected, when the request is submitted, then the request is stored, the homeowner sees the confirmation, the copy is marked as failed, and no token value appears in logs or on any screen.
- **AC-009.4** [edge] Given a copy attempt timed out although GoHighLevel did create the contact, when the retry runs, then the sub-account ends up with exactly one contact for that homeowner.
- **AC-009.5** [edge] Given a request already copied, when the owner changes its price or note, then the GHL contact is not changed (a status change updates only its stage tag, US-017).
- **AC-009.6** [edge] Given a request with 3 photos, when it is copied, then no photo is sent to GoHighLevel.
- **AC-009.7** [nfr] Given GoHighLevel takes 30 seconds to answer, when a homeowner submits, then the confirmation still appears within 3 seconds of the request being stored.
- **AC-009.8** [nfr] Given the configuration, when it is inspected, then the only GoHighLevel destination is the test sub-account and no real client account.
- **AC-009.9** [edge] Given a homeowner left the offers box unticked, when the request is submitted, then the request is stored and confirmed, GoHighLevel receives no call for it (no contact search, create or tag), and no copy job exists for it.
- **AC-009.10** [edge] Given Dana Whitfield's earlier request, sent with the offers box ticked and email "dana@example.com", was copied and GoHighLevel holds one contact for it, when she sends a second request with the box ticked, the same email and a different address "9 King St E, Hamilton ON", then within 2 minutes GoHighLevel still holds exactly one contact for her, the second request is linked to that contact, and the contact's address is still the first request's address.
- **AC-009.11** [edge] Given the same earlier contact with phone "905-555-0142", when she sends a second ticked request with that phone and a different email "dana.w@example.com", then GoHighLevel still holds exactly one contact for her, the second request is linked to it, and the contact's email is unchanged.
- **AC-009.12** [edge] Given Dana's first request was ticked and copied, when she sends a second request with the same email and the box unticked, then the second request is stored and confirmed, GoHighLevel receives no call for it, and the contact's tags and fields are unchanged.
- **AC-009.13** [edge] Given Dana's first request was sent with the box unticked and nothing is in GoHighLevel for her, when she sends a second request with the box ticked and a different address, then the contact created within 2 minutes holds the second request's name, phone, email and address, and nothing from the first request was sent.

**Notes:** One-way copy, one contact per homeowner (ruling 2A): before creating a contact the app looks for an existing one with the same email or phone (the match rule in `docs/integration-contract.md`) and links to it instead of creating a second; afterwards the only thing the app changes on a contact is its own tags (the stage tag, US-017), never its name, phone, email or address (OQ-19). Nothing is sent unless the homeowner ticked the offers box (ruling 1B, FR-25); an unticked request is never sent, and a later ticked request does not send an earlier unticked one. GHL's role here is email marketing; it never owns or changes a request. The contact carries name, phone, email, address and the tag `quote-request`; whether the reference number and problem text can also be attached without extra GHL setup is OQ-11 for the architect. When GoHighLevel answers 400, 404 or 422 the attempt is recorded with error class `rejected` (metrics spec).
**Out of scope:** two-way sync, GHL pipelines or opportunities (NG-6; the pipeline lives in our app, US-016), changing or withdrawing consent (NG-16).

---

### US-010: Owner sees whether the GoHighLevel copy worked, and it retries by itself
Priority: Should · Persona: Owner · Serves FR: FR-15, FR-21, FR-25

As the owner, I want to see whether a request's GoHighLevel copy succeeded and have failures retried automatically, so that a short outage does not leave my marketing contacts incomplete.

**Acceptance criteria**
- **AC-010.1** [happy] Given a request whose copy succeeded, when the owner opens it, then it shows "Copied to GoHighLevel" with the time.
- **AC-010.2** [happy] Given a request whose first copy attempt failed and GoHighLevel is back, when the next automatic retry runs, then the state changes to "Copied to GoHighLevel" with no action from the owner.
- **AC-010.3** [error] Given a request whose copy has failed 5 retries after the first attempt, when the owner opens it, then it shows "Copy to GoHighLevel failed" with the time of the last attempt, and no further automatic retries happen.
- **AC-010.4** [edge] Given a request waiting to retry, when the owner opens it, then it shows "Waiting to retry" and the owner can still change price, note and status as usual.
- **AC-010.5** [nfr] Given any failed copy attempt, when its record is read, then it holds the request id, attempt number and an error class, and holds no token and no homeowner name, phone, email or address.
- **AC-010.6** [edge] Given a request whose homeowner left the offers box unticked, when the owner opens it, then it shows "Not copied: no offers consent" instead of a copy state, with no Retry control and no stage-tag line.

**Notes:** A waiting request is retried at least once every 24 hours until it succeeds or reaches 5 retries; faster retries are welcome if the free hosting plan allows them (OQ-8, architect).
**Out of scope:** alerts when a copy fails (NG-1).

---

### US-011: Owner filters the Requests tab by status
Priority: Should · Persona: Owner · Serves FR: FR-16, FR-21

As the owner, I want to filter the Requests tab to New, Quoted, Won or Lost, so that I can find the requests that still need a reply.

**Acceptance criteria**
- **AC-011.1** [happy] Given 3 New, 2 Quoted and 1 Won request, when the owner chooses the New filter, then exactly the 3 New requests are listed, newest first.
- **AC-011.2** [edge] Given no Lost requests, when the owner chooses the Lost filter, then she sees "No lost requests".
- **AC-011.3** [edge] Given a filter is on and the owner marks a listed request Won, when the save succeeds, then the request leaves a New filter list without a full page reload.
- **AC-011.4** [error] Given the list cannot be loaded, when the owner chooses a filter, then she sees "Couldn't load requests. Try again." and the previous list is not shown as if it were filtered.

**Notes:** Filter choices are All, New, Quoted, Won, Lost. The weekly count is not affected by the filter. The filter lives on the Requests tab only; the Pipeline tab always shows every request in its status column.
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

**Notes:** Build only if the architect says it is nearly free. Search lives on the Requests tab only.
**Out of scope:** searching the problem text or address, searching on the Pipeline tab.

---

### US-014: Owner retries a failed GoHighLevel copy by hand
Priority: Could · Persona: Owner · Serves FR: FR-19, FR-21

As the owner, I want a Retry button on a failed copy, so that I can fix it myself once GoHighLevel is back.

**Acceptance criteria**
- **AC-014.1** [happy] Given a request showing "Copy to GoHighLevel failed" and GoHighLevel is reachable, when the owner presses Retry, then the state becomes "Copied to GoHighLevel".
- **AC-014.2** [error] Given GoHighLevel is still down, when the owner presses Retry, then the state stays "Copy to GoHighLevel failed" and a message says the retry did not work.
- **AC-014.3** [edge] Given the owner double-clicks Retry, when GoHighLevel is reachable, then the sub-account ends up with exactly one contact for that homeowner.
- **AC-014.4** [edge] Given a request whose homeowner left the offers box unticked, when the owner opens it, then there is no Retry control, and a retry asked for directly is refused with an error and creates no contact.

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
Priority: Must · Persona: Owner · Serves FR: FR-12, FR-21, FR-23, FR-26

As the owner, I want a Pipeline tab that shows my requests as cards in New, Quoted, Won and Lost columns and lets me drag a card to change its status, so that I can see the whole pipeline at a glance and update a job in one move.

**Acceptance criteria**
- **AC-016.1** [happy] Given the inbox holds 2 New, 1 Quoted, 1 Won and 1 Lost request, when the owner selects the Pipeline tab, then she sees four columns in the order New, Quoted, Won, Lost holding 2, 1, 1 and 1 cards, and each card shows reference number, name, urgency and submitted time in Hamilton time.
- **AC-016.2** [happy] Given request `NQ-7K3M9P` is a card in New, when the owner drags it into the Won column and drops it, then the card shows in Won, the request still shows Won after a page reload, the previous status, new status, time and user are stored, and the weekly Won count rises by 1 within 2 seconds.
- **AC-016.3** [happy] Given an owner using only the keyboard, when she tabs to the card for `NQ-7K3M9P`, opens its "Move to" menu with Enter and chooses "Quoted" with the arrow keys and Enter, then the card shows in Quoted with the same stored change and weekly count effect as AC-016.2, focus stays on that card, and the message "NQ-7K3M9P moved to Quoted" is exposed to screen readers.
- **AC-016.4** [happy] Given the owner moved `NQ-7K3M9P` to Won on the Pipeline tab, when she selects the Requests tab, then the list shows newest first with `NQ-7K3M9P` at its submitted-time position and status Won, and selecting the Pipeline tab again shows its card in Won.
- **AC-016.5** [happy] Given a card on the Pipeline tab, when the owner clicks its reference number or presses Enter on it, then the request detail opens with every submitted field, the photos, the price, the note and the status control, the same as when opened from the Requests tab.
- **AC-016.6** [edge] Given a card in Quoted, when the owner drops it back into the Quoted column, then nothing is stored, no new change time is recorded and no `quote_request_status_changed` event is fired.
- **AC-016.7** [edge] Given a card is being dragged out of New, when the owner releases it outside all four columns or presses Escape, then the card returns to its position in New and nothing is stored.
- **AC-016.8** [edge] Given the Won column holds cards submitted at 09:10 and 08:00 and `NQ-7K3M9P` submitted at 09:00 is dropped into it, when the column is shown, then the cards read 09:10, 09:00, 08:00 and the moved card is not placed at the top.
- **AC-016.9** [edge] Given the Pipeline tab is open, when the owner looks for a way to add, rename, delete or reorder a column, then none is offered anywhere on the tab.
- **AC-016.10** [edge] Given 51 requests are Quoted and 2 are New, when the owner opens the Pipeline tab, then Quoted shows its 50 newest cards with a "Show more" control that adds the remaining 1, and New shows both of its cards with no "Show more".
- **AC-016.11** [edge] Given no request is Lost, when the owner opens the Pipeline tab, then the Lost column shows "No lost requests" and a card dropped into it is accepted.
- **AC-016.12** [edge] Given the owner and the helper both have the Pipeline tab open and the helper moved `NQ-7K3M9P` from New to Won first, when the owner then drags that card, still shown in New on her screen, to Lost, then her card returns to New, she sees "This request was changed by someone else. Reload to see the latest." and the request stays Won.
- **AC-016.13** [error] Given the network drops as the owner drops a card into Won, when the save fails, then the card first shows in Won marked "Saving", then returns to its original column and position, "Couldn't save. Try again." shows, nothing is stored and the weekly Won count is unchanged; the same happens when the move was made with the "Move to" menu.
- **AC-016.14** [error] Given the owner's session has expired, when she drops a card into Won, then the card returns to its original column, nothing is saved and she is sent to the sign-in page.
- **AC-016.15** [error] Given the requests cannot be loaded, when the owner selects the Pipeline tab, then she sees "Couldn't load requests. Try again." and no empty columns are shown.
- **AC-016.16** [nfr] Given the Pipeline tab holds 10 cards across the four columns, when an automated WCAG 2.1 AA check runs on it, then it reports 0 serious or critical violations.
- **AC-016.17** [nfr] Given a 375 px wide phone screen, when the owner opens the Pipeline tab and chooses a status from a card's "Move to" menu with taps only, then the card moves to that column and the page needs no horizontal scrolling.
- **AC-016.18** [nfr] Given 50 requests spread across the four columns, when the owner opens the Pipeline tab on a desktop broadband connection, then all 50 cards are visible within 2 seconds.
- **AC-016.19** [happy] Given the owner is signed in and has saved the address of the Pipeline tab, when she opens that address directly in a new browser tab, then the Pipeline tab opens with the four columns and the weekly count, Pipeline is marked as current in the main navigation, and its address differs from the Requests tab's address.
- **AC-016.20** [edge] Given the owner is on the Requests tab or the Pipeline tab, when she looks for a List / Board switch, then there is none: the two tabs are separate entries in the main navigation and selecting one changes the browser's address.

**Notes:** The Requests tab stays as built in US-005 and is where signing in lands (OQ-14A reworded 2026-11-20); the Pipeline tab is its own tab with its own address, not a view toggle (FR-26). Dropping a card or using "Move to" follows the same rules and has the same effects as changing status from the list (US-007, FR-12): any status to any other, the previous status, new status, time and user stored, the weekly count updated, the `quote_request_status_changed` event fired, and (when US-017 is built, for consented requests only) the GoHighLevel stage tag updated. Moving a card to Quoted changes the status only: it neither requires nor sets a price and does not fire `quote_request_quoted` (that event fires when a price is first saved, US-006). The Board saves in our app whether or not GoHighLevel is reachable. The Requests tab's filter (US-011) and search (US-013) stay on Requests: the Pipeline tab shows every request. The weekly count shows on both tabs (OQ-18). The owner and the helper have identical rights.
**Out of scope:** adding, renaming, removing or reordering columns (NG-14), manual card ordering, per-column totals, swimlanes or card colours (NG-15), moving several cards at once, assigning a card to a person (NG-9).

---

### US-017: A status change updates the request's GoHighLevel stage tag
Priority: Should · Persona: Owner · Serves FR: FR-21, FR-22, FR-24, FR-25

As the owner, I want each request's GoHighLevel contact to carry a tag for its current stage, so that my email marketing in GoHighLevel can tell new, quoted, won and lost contacts apart.

**Acceptance criteria**
- **AC-017.1** [happy] Given request `NQ-7K3M9P` was copied to GoHighLevel with tags `quote-request` and `quote-new`, when the owner drags its card to Quoted, then within 2 minutes the contact carries `quote-request` and `quote-quoted` and no longer carries `quote-new`, and the request detail shows "Stage tag up to date".
- **AC-017.2** [happy] Given the same contact, when the owner marks the request Won from the Requests tab, then within 2 minutes the contact carries `quote-request` and `quote-won` and no other stage tag.
- **AC-017.3** [happy] Given GoHighLevel is reachable, when a homeowner ticks the offers box and submits a request, then the new contact carries `quote-request` and `quote-new`.
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
- **AC-017.15** [edge] Given Dana Whitfield's two consented requests share one GoHighLevel contact (US-009, AC-009.10), when the owner moves the first request to Quoted and then the second to Won, then within 2 minutes the contact carries `quote-request` and `quote-won` as its only stage tag, and when she then moves the first request to Lost, the contact carries `quote-lost` as its only stage tag (the most recent change wins).
- **AC-017.16** [edge] Given a request whose homeowner left the offers box unticked, when the owner changes its status from either tab, then the status is saved, GoHighLevel receives no call, and the request detail shows no stage-tag line.
- **AC-017.17** [edge] Given Dana's first request was ticked and copied with tag `quote-new` and her second request was unticked, when the owner marks the second request Won, then the contact still carries `quote-request` and `quote-new` and no other stage tag.

**Notes:** Only consented requests have a contact, so only they have a stage tag (ruling 1B); when one contact serves several requests from one person (ruling 2A), the most recent copy or status change among them sets the stage tag (FR-24, `docs/integration-contract.md`). Depends on US-009 (the contact must exist) and uses the retry rule of US-010 (at least every 24 hours, up to 5 retries after the first attempt, OQ-8A); it is cut before them. Tag names and the removal of the previous stage tag are OQ-13A (decided). Every retry applies the request's current status, never an older one. The app only adds and removes its own five tags (`quote-request` and the four stage tags) and changes no other tag or field on the contact; GoHighLevel stays non-authoritative. Whether the test sub-account allows tag changes, and whether a missing tag is created automatically, is OQ-15 for the architect.
**Out of scope:** two-way sync, reading tags back from GoHighLevel, GHL pipelines or opportunities (NG-6), a manual retry button for tags, alerts when a push fails (NG-1).

---

## Suggested build order
1. US-001 — thinnest end-to-end slice: homeowner submits and the request is stored with a reference number, with the offers box and its stored consent (needed before US-009 can decide what to send)
2. US-004 — sign-in, lockout limits and protected inbox data, needed before any owner screen; the main navigation with its two tab addresses starts here (the Pipeline tab fills in at step 8)
3. US-005 — Requests tab and request detail (the E2E "sees it at the top of the inbox" step)
4. US-002 — photos on submit and in the inbox (the E2E starts "with photos")
5. US-006 — price and note
6. US-007 — status changes
7. US-008 — weekly count (the last E2E step)
8. US-016 — Pipeline tab (needs the list from US-005 and the status rules from US-007; the "marks it won" E2E step can be done from the Requests tab or by drag)
9. US-003 — spam protection and its capped event log, before the public page is released (can be built in parallel with 5–8)
10. US-009, then US-010, then US-017 — GoHighLevel copy for consented requests (one contact per homeowner), its state and retry, then the stage tag (Should; the first to cut if the run overruns, last built is first cut; when they are cut, the offers box and stored consent in US-001 stay)
11. US-011, US-012 — filter and full-size photo (Should)
12. US-013, US-014, US-015 — Could, only if nearly free

Cut order if the run overruns: US-013, US-014, US-015, US-012, US-011, US-017, US-010, US-009.
