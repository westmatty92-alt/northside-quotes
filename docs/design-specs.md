# Design specs: Northside quote requests

Status: rebuilt on the client's own brand files (Matthew's ruling, 2026-11-20). No PROPOSAL label any more.
Changelog: 2026-11-24, two accessible names reworded (QA1 BUG-QA1-5, axe label-in-name). The SCR-06 photo tile now reads "View photo N" with the accessible name "View photo N of 3 at full size". The Move to button on SCR-04 and SCR-05 keeps the visible text "Move to" with the accessible name "Move to another status, NQ-…". In both, the visible words come first in the accessible name (WCAG 2.5.3). The `aria-label` values written in the older mockup HTML for the Move to buttons are illustrative: this spec decides.
Reads with: `docs/user-flows.md` (inventory, navigation, flows, edge paths), `DESIGN.md` (tokens), `docs/PRD.md` (v1.2), `docs/user-stories.md`.
Mockups: `design/mockups/SCR-NN-*.html` (state sheets carry a double dash, for example `SCR-05-inbox-board--errors.html`; the SCR-04 and SCR-05 file names keep their old slugs "inbox-list" and "inbox-board" because the screens kept their IDs). Screenshots: `docs/design/screens/SCR-NN-mobile.png` and `SCR-NN-desktop.png`; a state sheet is `SCR-NN--<state>-mobile.png` and `-desktop.png`. No screen is placed inside another site (Non-goal NG-11), so there are no embed screenshots.

## Brand reference

- Source: the client's brand guide and wordmark in `.baseleap/inputs/brand/` (`brand-guide.md`, `northside-wordmark.svg`). `DESIGN.md` is built from them; the stale `README.md` in that folder (a Console export saying there are no files) is ignored. There is no website or app to match, so each colour role is the one the guide assigns.
- Look: Harbour Teal header, primary buttons, links and active states; Paper page; Fog cards, tiles, columns and dividers; Steel Ink text; Copper kept for the pipe mark and large graphics on light surfaces (never small text, never a button, never on teal, ink or Fog). Barlow Semi Condensed headings and Source Sans 3 body, self-hosted. Slightly squared corners (2, 4, 8 px), 48 px fields.
- Wordmark: the supplied SVG, 44 px high in the header (28 px is the minimum), Paper text on teal, copper pipe. The frontend ships it with the text converted to outlines or with the two fonts loaded.
- Signature: the job tag, hung from the copper pipe. The reference number (`NQ-7K3M9P`) is always a tag: Barlow Semi Condensed Bold, tracked out, Paper on teal with a punched hole on SCR-02 and SCR-06 (where a copper elbow, the shape of the pipe in the wordmark, hooks through the hole), quiet Fog in rows and cards.
- Functional colours (red, green, amber, with tints) are not in the guide; they carry error, success and waiting states only and are flagged as a decision for Matthew in the report.
- Only `DESIGN.md` values are used in the mockups: colours, type, spacing and radius come through `design/mockups/tokens.css` (generated), fonts through `design/mockups/fonts.css` (local files, no network). The layout constants `DESIGN.md` declares under Layout (44 px touch target, 48 px field, 64 px bar, 240 px board column minimum, 1 px hairline, 3 px focus ring) are named once in `design/mockups/app.css`.
- The mockups draw one top-bar navigation and one bottom tab bar, and CSS shows only one at a time by width. The build uses a single navigation landmark restyled by breakpoint. The bottom bar is fixed to the bottom of the screen on phones (the screenshots draw it at the end of the page); content needs bottom padding equal to the bar, and `scroll-padding-bottom` so a focused control is never hidden behind it.

## Screens

### SCR-01 · Request a quote

- **Purpose:** a homeowner describes the problem in one sitting on a phone and gets a reference number. One focal point: the teal "Send request" button, the only primary action.
- **Stories:** US-001, US-002, US-003.
- **Mockups:** `design/mockups/SCR-01-request-quote.html` (filled, ready to send), `SCR-01-request-quote--errors.html` (validation), `SCR-01-request-quote--send-failed.html` (send failed, values kept). Screenshots: `docs/design/screens/SCR-01-mobile.png`, `SCR-01-desktop.png`, `SCR-01--errors-mobile.png`, `SCR-01--send-failed-mobile.png`.
- **Layout:** one column, 560 px maximum, on a Paper page with a Paper sheet on a Fog page from 640 px up. Three groups of at most three fields: Your details (name, phone, email), The problem (address, problem text, urgency), Photos (optional). Labels sit above fields and are always visible. Urgency is three large radio cards with the full wording and none preselected. Below the photos, in this order: the optional offers checkbox, the data-use line, the button. The checkbox sits on its own Fog strip, separate from the line and from Send, and reads "Email me offers and news from Northside. This is optional." (the label is the whole 44 px strip, the box is 24 px). It is **never ticked when the page loads**, is not required, and no scripted default, remembered value or autofill ticks it (CASL). The data-use line, from PRD v1.2, reads "Northside will use these details to reply to your quote request. It will email you offers only if you tick the box." The primary button is full width, 48 px high, labelled "Send request". A footer link, "Staff sign-in", is the only way to reach SCR-03.
- **Behaviour:** validation runs on Send, not on every keystroke. A failed Send moves focus to an error summary at the top that links to each field; every error also sits under its field with an icon and says how to fix it. Typed values, attached photos and the state of the offers box are always kept. Photo rows show a thumbnail, file name, size and a Remove button with the file name in its label. The hidden spam field is invisible to everyone, skipped by the keyboard and ignored by screen readers. The offers box is a native checkbox: Tab reaches it, Space ticks and unticks it, its focus ring is the standard 3 px ring (AC-001.18). Ticking or unticking it changes nothing else on the page and adds no friction to Send.

| State | Design | AC |
|---|---|---|
| Empty | The blank form. No urgency preselected, no photos, **the offers box unticked** (every time the page loads, including after "Send another request"). Photos are optional, and Send with no photos is accepted; sending without touching the box is a normal send that is confirmed like any other. | AC-002.5, AC-001.15 |
| Loading | After Send the button reads "Sending", is paused and cannot be pressed twice; each photo row shows its upload progress in words ("Uploading 2 of 3"); the whole form stays on screen. One tap makes one request. | AC-001.6, AC-002.7 |
| Error | Summary at the top plus a message under each field: empty fields; problem of 9 or 2,001 characters with the allowed length (10 to 2,000); phone or email refused with the rest kept, **and the offers box still ticked if she ticked it** (mockup `--errors`); a 4th photo not added ("You can add up to 3 photos"); a photo over 5 MB ("Each photo must be 5 MB or smaller"); a PDF or renamed text file ("Photos must be JPEG, PNG or WebP"); upload failed on one photo shows the error beside that photo; database down, honeypot filled and too-fast send all show "We couldn't send your request. Please try again." and never say which check failed; the sixth send in 10 minutes shows "Too many requests. Please try again in a few minutes." | AC-001.2, AC-001.3, AC-001.4, AC-001.8, AC-001.16, AC-002.2, AC-002.3, AC-002.4, AC-002.6, AC-003.2, AC-003.3, AC-003.4 |
| Success | The page is replaced by SCR-02 with the reference number, whether the box was ticked or not (a ticked request is stored with consent and its time; the screen shows nothing different). A rapid second tap still gives one number. | AC-001.6, AC-001.14 |
| Disabled | "Add a photo" is paused once 3 photos are attached, with the words "You can add up to 3 photos" beside it. Send is paused while sending (see Loading). Nothing is hidden. | AC-002.2, AC-001.6 |

### SCR-02 · Request sent

- **Purpose:** show the reference number in the most findable way possible, because no email or text is sent (AC-001.12), and say what happens next. Focal point: the reference number as a large ink job tag.
- **Stories:** US-001, US-002.
- **Mockups:** `design/mockups/SCR-02-confirmation.html`. Screenshots: `docs/design/screens/SCR-02-mobile.png`, `SCR-02-desktop.png`.
- **Layout:** a live "Request sent" line, an h1 that names the homeowner ("Thanks, Dana. Northside has your request."), the tag at display size hung from the copper pipe elbow, a "Copy reference number" button (the one primary action), a short "What happens next" list that says no email or text will arrive so the number should be written down or screenshotted, then a recap of what was sent. "Send another request" is a quiet secondary button.
- **Behaviour:** the confirmation is announced to screen readers when the page loads. The number is real selectable text as well as a button, so copying never depends on the clipboard.

| State | Design | AC |
|---|---|---|
| Empty | N/A — the page is only reached from a successful send. Opening it directly is an open question (see Open questions). | none |
| Loading | N/A — the number arrives with the response that brings the page; SCR-01 shows the busy Send button until then. | none |
| Error | The Copy button cannot reach the clipboard: the line "Couldn't copy. Select the number and copy it by hand." appears under it. Every send failure stays on SCR-01. | AC-001.8 |
| Success | The primary design. It looks exactly the same when the GoHighLevel copy waits or fails; the homeowner is never told about GoHighLevel. | AC-001.9 |
| Disabled | N/A — nothing on this page is ever unavailable. | none |

### SCR-03 · Staff sign-in

- **Purpose:** the owner and helper sign in with email and password. One focal point: the teal "Sign in" button.
- **Stories:** US-004.
- **Mockups:** `design/mockups/SCR-03-sign-in.html`, `SCR-03-sign-in--error.html` (the four notices together for review). Screenshots: `docs/design/screens/SCR-03-mobile.png`, `SCR-03-desktop.png`, `SCR-03--error-mobile.png`, `SCR-03--error-desktop.png`.
- **Layout:** a narrow centred form, 440 px maximum, under the teal header with the wordmark. Email, Password with a Show button, Sign in. Both fields work with password managers and paste (`autocomplete` set to username and current-password). No puzzle, no memory test. Notices appear above the form, one at a time.
- **Behaviour:** no "Create account" link, no "Forgot password" link and no way to change or reset a password, because none exists (NG-4, FR-27: Baseleap sets and resets passwords). A failed attempt keeps the email and clears the password. The page remembers which tab address brought the visitor here and returns to it after sign-in; opened directly it leads to Requests. The two limit messages never say which limit applied or whether an email has an account.

| State | Design | AC |
|---|---|---|
| Empty | The blank form; nothing is pre-filled. | none |
| Loading | The button reads "Signing in" and is paused so one press makes one attempt. | none |
| Error | Wrong password or unknown email show the same words: "Email or password is incorrect". Five failed tries for one email, twenty from one network address, or five for an email that has no account all show the same warning: "Too many sign-in attempts. Try again in a few minutes." (even with the right password; the per-address case is the same words, so a person behind a shared network sees nothing different from the per-email case). When the attempt counters cannot be read the warning is "Sign-in is unavailable. Try again in a few minutes." and no session starts (fails closed). A session that ended shows an info notice: "Your session ended. Your last change was not saved. Sign in again, then check the request." | AC-004.4, AC-004.5, AC-004.7, AC-004.11, AC-004.12, AC-004.13, AC-016.14 |
| Success | The owner or helper lands on the Requests tab (SCR-04). A signed-out visitor who opened the Requests address lands on Requests after signing in; one who opened the Pipeline address lands on the Pipeline tab (SCR-05). Signing out returns here. | AC-004.1, AC-004.2, AC-004.3, AC-004.14, AC-004.9 |
| Disabled | No way to create an account, to ask for a forgotten password or to change or reset one is offered anywhere on this page or on any signed-in screen, and a direct request to create, change or reset is refused (no email is sent). | AC-004.6, AC-004.10 |

### SCR-04 · Requests tab (the list)

- **Purpose:** the owner sees every request, newest first, and finds the one to deal with. It is its own tab with its own address; sign-in lands here. Focal point: the first row; the weekly strip sits above it as a glance, not a call to action. There is no primary button on this screen: the work happens by opening a row, and "Move to" is secondary.
- **Stories:** US-005, US-007, US-008, US-011, US-013.
- **Mockups:** `design/mockups/SCR-04-inbox-list.html` (file name keeps its old slug), `SCR-04-inbox-list--empty.html`, `SCR-04-inbox-list--errors.html`, `SCR-04-inbox-list--loading.html`. Screenshots: `docs/design/screens/SCR-04-mobile.png`, `SCR-04-desktop.png`, and for each state sheet `SCR-04--empty`, `--errors`, `--loading` with `-mobile.png` and `-desktop.png`.
- **Layout:** the teal top bar with the Requests tab marked current (bottom tab bar on phones), the page title "Requests", the weekly strip (SCR-07), then the status filter (All, New, Quoted, Won, Lost) with the search beside it from 640 px up (stacked on phones), then the rows. **There is no List / Board switch** (AC-016.20): the Pipeline tab is a separate entry in the main navigation. At 1024 px and up each request is one row in a six-column table: reference, name, urgency, status, submitted, Move to. Below 1024 px each request is a stacked card with the same six facts, so nothing scrolls sideways at 375 px. Status badges carry an icon and the word. The list is 50 rows, then a "Show more" button.
- **Behaviour:** the reference and the name are both links to SCR-06. "Move to" is a menu with the other three statuses, available on every row. Changing a status never moves the row (the order is by submitted time only). Opened by its own saved address in a new browser tab, the tab opens directly with the weekly count and Requests marked current, at an address different from the Pipeline tab's (AC-005.10). Filter and search live on this tab only.

| State | Design | AC |
|---|---|---|
| Empty | First use: "No quote requests yet", what will show up here, and a link to the Request a quote page; the count shows 0, 0, 0. A filter with no matches: "No lost requests" style message and a "Show all requests" button. A search with no matches: "No matching requests". | AC-005.4, AC-008.7, AC-011.2, AC-013.2 |
| Loading | Skeleton rows and skeleton count tiles in the real layout, so nothing jumps when data arrives. The page is marked busy and "Loading requests" is announced. | none |
| Error | The list cannot load: "Couldn't load requests. Try again." with a Try again button, and the previous list is not shown as if it were filtered. The count cannot load: "Count unavailable" and the list still loads. A status save from a row fails: "Couldn't save. Try again.", the row keeps its old status. The session ended: sent to SCR-03. | AC-011.4, AC-008.8, AC-007.6, AC-004.7 |
| Success | A status change shows the new badge in place and the row stays where it was. Marking a request Won from Won to Lost works the same. With a filter on, the row leaves the list without a page reload. A partial name search lists the match. A request moved to Won on the Pipeline tab shows here at its submitted-time position with status Won. | AC-007.5, AC-007.3, AC-011.3, AC-013.3, AC-016.4, AC-005.10 |
| Disabled | While a row's status saves, its Move to button is paused. Choosing the status a request already has does nothing and shows no message. There is no List / Board switch to disable or hide: the two tabs are separate navigation entries and selecting one changes the address. | AC-007.4, AC-016.20 |
| Long list | 51 requests: the 50 newest and a "Show more" button that adds the last one. | AC-005.5 |

### SCR-05 · Pipeline tab (the board)

- **Purpose:** the whole pipeline at a glance and a one-move status change. It is its own tab with its own address, shows every request (never filtered, no search) and has no List / Board switch. Focal point: the four columns. No primary button; the "Move to" button on each card is secondary.
- **Stories:** US-016, US-007, US-008.
- **Mockups:** `design/mockups/SCR-05-inbox-board.html`, `SCR-05-inbox-board--moving.html` (menu open, dragging, saving), `SCR-05-inbox-board--errors.html`, `SCR-05-inbox-board--empty.html` (empty columns, "Show more"), `SCR-05-inbox-board--loading.html`. Screenshots: `docs/design/screens/SCR-05-mobile.png`, `SCR-05-desktop.png`, and for each state sheet `SCR-05--moving`, `--errors`, `--empty`, `--loading` with `-mobile.png` and `-desktop.png`.
- **Layout:** the Pipeline tab marked current in the top bar (or bottom tab bar), the page title "Pipeline", the weekly strip (SCR-07, identical to the one on Requests), one line saying what the tab does and where filter and search are ("To filter or search, use the Requests tab."), then the columns: four at 1280 px (240 px minimum each), two at 640 px, one column stacked on a phone with a "Jump to a column" row so the owner can reach Lost without scrolling past everything. Each card holds the reference tag, the name, urgency (icon and word), the submitted time and a full-width "Move to" button, 44 px high. No column can be added, renamed, recoloured, removed or reordered, and nothing offers it.
- **Behaviour (the three ways to move a card):**
  1. Drag with a mouse or finger. The source keeps a dashed gap; the card under the pointer wears a copper outline and the word "Dragging"; the target column is dashed; Escape or releasing outside the four columns puts it back.
  2. "Move to" menu: Enter or a tap opens it, arrow keys move through the other three statuses, Enter chooses, Escape closes and returns focus to the button.
  3. After either move the card sits in its new column marked "Saving". On success focus stays on the card and a screen-reader message says "NQ-7K3M9P moved to Quoted". On failure the card goes back.
- **Keyboard path for the board:** Tab reaches each card's reference link and then its Move to button; the menu is the keyboard and touch path, so the drag has no keyboard equivalent to build. Cards are listed newest first within a column, and a moved card takes its submitted-time position, never the top.

| State | Design | AC |
|---|---|---|
| Empty | No requests at all: four columns each with its own message ("No new requests", "No quoted requests", "No won requests", "No lost requests"), and the count 0, 0, 0. An empty column is still a valid place to move a card to. | AC-016.11, AC-005.4 |
| Loading | Four skeleton columns with skeleton cards, and skeleton count tiles. Busy and announced as "Loading the board". | none |
| Error | The Pipeline cannot load: "Couldn't load requests. Try again." and no columns (the tab bar and the Requests tab stay usable). The save fails after a drop or a menu choice: the card goes back to its column and position, "Couldn't save. Try again." shows, focus returns to the card's Move to button. Someone else changed it first: the card goes back and "This request was changed by someone else. Reload to see the latest." with a Reload button. The session ended: the card goes back and the owner is sent to SCR-03. | AC-016.15, AC-016.13, AC-016.12, AC-016.14 |
| Success | The card stays in its new column, the weekly count updates within 2 seconds, and the screen-reader message is read. A moved card takes its time position (09:10, 09:00, 08:00), not the top. Dropping a card back into its own column, outside the columns, or pressing Escape stores nothing. 51 cards in one column: 50 and "Show more" for that column only. Opened by its own saved address in a new browser tab, the tab opens directly with the four columns and the weekly count, Pipeline marked current, at an address different from the Requests tab's. After a move, the Requests tab lists the request at its time position with its new status (AC-016.4). | AC-016.3, AC-016.6, AC-016.7, AC-016.8, AC-016.10, AC-016.19, AC-016.4 |
| Disabled | A card that is saving shows "Saving" and its Move to button is paused. No control to add, rename, delete or reorder a column exists, and no List / Board switch: Requests and Pipeline are two entries in the main navigation. On a 375 px phone the Move to menu moves a card with taps only and the page never scrolls sideways. | AC-016.13, AC-016.9, AC-016.17, AC-016.20 |

### SCR-06 · Request detail

- **Purpose:** read one request, record the price and note, set the status, and see whether the GoHighLevel copy worked. Focal point: the job tag and name at the top, then the teal "Save price and note" button, the only primary action.
- **Stories:** US-005, US-006, US-007, US-009, US-010, US-012, US-014, US-015, US-017.
- **Mockups:** `design/mockups/SCR-06-request-detail.html` (primary), `SCR-06-request-detail--saved.html`, `--errors.html`, `--sync.html` (GoHighLevel and stage-tag states, retry, last updated, and the no-offers-consent state), `--empty.html` (no photos, no price, no offers consent), `--loading.html`. Screenshots: `docs/design/screens/SCR-06-mobile.png`, `SCR-06-desktop.png`, and for each state sheet `SCR-06--saved`, `--errors`, `--sync`, `--empty`, `--loading` with `-mobile.png` and `-desktop.png`.
- **Layout:** the top bar keeps the tab the owner came from marked (a detail page is not a tab itself), then a link reading "Back to Requests" or "Back to Pipeline" to match, the display job tag hung from the copper elbow, the name as h1, then status badge, urgency and submitted time (Hamilton time). From 1024 px two columns: left is the request (call and email buttons, then phone, email, address, urgency and the problem as plain text) and the photos; right is Your quote (price and note), Status, and GoHighLevel. On a phone one column in that order, so the owner reads, then quotes. Phone is a tap-to-call link and email is an email link. Price has a visible label, a fixed "$" prefix and the hint "From 0.01 to 99,999.99. No tax is added and no payment is taken." Both price and note are optional and either can be saved alone. Status is a four-part control; choosing one saves at once and the control is busy until it finishes. Saving a price never changes the status, and the screen says so.
- **GoHighLevel card:** two lines, each an icon and words (never colour alone): CONTACT COPY (Copied to GoHighLevel with the time; Waiting to retry; Copy to GoHighLevel failed with the time of the last try and a "Retry copy" button) and STAGE TAG (Stage tag up to date; Stage tag waiting to retry; Stage tag failed with the time of the last try). Retry copy is the Could story US-014 and is one self-contained button. No token or technical detail is ever shown. **A request whose homeowner did not tick the offers box** shows one line instead of the two: an info icon and "Not copied: no offers consent", with a sentence that nothing is sent to GoHighLevel for it. It has no Retry copy button and no stage tag line, in any status, and looks the same when the same person has another request that was copied. A second request that is linked to an existing contact shows the ordinary copy state.
- **Last updated:** "Last updated by Office helper at 2:05 p.m." or "Not updated yet" (US-015, Could).

| State | Design | AC |
|---|---|---|
| Empty | No photos: a dashed panel "No photos" with a line that the homeowner did not attach any. No price or note yet: both fields blank and a line saying either can be saved alone. A request nobody has changed: "Not updated yet". | AC-005.6, AC-002.5, AC-015.2 |
| Loading | Skeleton in the real two-column layout, including the three photo tiles, so nothing jumps. While a save runs the Save button reads "Saving", and the status control is paused with the chosen status showing a busy icon. | none |
| Error | Price or note refused: an error summary at the top of the form that links to each field, the message under the field ("Enter an amount from 0.01 to 99,999.99 with at most 2 decimals"; "Notes can be up to 1,000 characters. This one is 1,001."), and everything typed stays. Save failed on the network: "Couldn't save. Try again." with values kept and the button reading "Try saving again". Someone else saved first: "This request was changed by someone else. Reload to see the latest." with a Reload button and the typed note kept below to copy. Photo storage unreachable: each photo slot says "Photo unavailable" and the rest of the page shows. Session ended: nothing saved, sent to SCR-03. A failed status save keeps the previous status with "Couldn't save. Try again." | AC-006.3, AC-006.4, AC-006.7, AC-006.5, AC-005.7, AC-004.7, AC-007.6 |
| Success | A "Saved." banner names what was stored ("Price $450.00 CAD and your note are stored"), the price shows large above the field, the status badge changes, and "Last updated by Owner at 2:05 p.m." appears. A note can be saved without a price. A new price replaces the old one and the old one is shown nowhere. Won can go to Lost. | AC-006.2, AC-006.6, AC-007.3, AC-015.1 |
| Disabled | Choosing the status already selected does nothing and says nothing. "Retry copy" is paused while the try runs ("Retrying"), so a double click makes one try. **No offers consent:** the card says "Not copied: no offers consent" and there is no Retry control at all (not a paused one, and a retry asked for directly is refused), no stage tag line, and no call to GoHighLevel is made when the status changes; mockup `SCR-06--empty` and `--sync` (panel 7). | AC-007.4, AC-014.3, AC-010.6, AC-014.4, AC-009.9, AC-017.16 |
| Partial or stale | Copy waiting, failed or token rejected, and stage tag waiting, failed or up to date, each shown in the GoHighLevel card as above. The request stays fully editable in every one of these states. A retry that fails says "The retry did not work." and the state stays failed. A stage tag for a request whose copy is still waiting reads "Stage tag waiting to retry" too. A request with no offers consent shows none of these, even when the same person's other request was copied and its contact tag changes (the unticked request's own card stays "Not copied"). | AC-009.2, AC-009.3, AC-010.3, AC-010.4, AC-014.2, AC-017.7, AC-017.9, AC-017.10, AC-017.11, AC-017.17 |

### SCR-07 · Weekly count

- **Purpose:** three numbers for the current Monday to Sunday week, so the owner does not count by hand. Not a page: a strip under the page title on both SCR-04 (Requests) and SCR-05 (Pipeline), identical on each (OQ-18, option A). Focal point: three large numbers. No action on it except "Try again" when it cannot load.
- **Stories:** US-008.
- **Mockups:** `design/mockups/SCR-07-weekly-count.html` (the strip alone in each state; it also appears in context on the SCR-04 and SCR-05 mockups). Screenshots: `docs/design/screens/SCR-07-mobile.png`, `SCR-07-desktop.png`.
- **Layout:** a small "THIS WEEK" label with the dates ("Mon Nov 16 to Sun Nov 22, Hamilton time"), then three tiles in a row at every width: Requests this week, Won (check icon), Lost (cross icon). The number is 40 px, the label 14 px semibold. The strip never changes with the Requests filter or search, and it does not reset when the owner switches tabs.
- **Behaviour:** the number changes in place within 2 seconds of a successful status save, with no reload and no sign-in. The strip is a polite live region ("Won 2"). The brief green outline on the changed tile is an extra, never the only signal, and is replaced by a still change under reduced motion. If a save fails nothing changes.

| State | Design | AC |
|---|---|---|
| Empty | A week with no activity shows 0, 0 and 0 (never blank). | AC-008.7, AC-005.4 |
| Loading | Three skeleton tiles the same size as the real ones. | none |
| Error | The strip says "Count unavailable" with a Try again button, and the list or board below still loads. | AC-008.8 |
| Success | The normal strip (4, 1, 1) and the updated strip after a save (Won 2). | AC-008.1, AC-008.2 |
| Disabled | N/A — the strip is read-only and has no controls to disable. | none |

### SCR-08 · Photo viewer

- **Purpose:** look at one photo at full size and move through the request's others. A dialog over SCR-06. Focal point: the photo.
- **Stories:** US-012.
- **Mockups:** `design/mockups/SCR-08-photo-viewer.html` (photo 2 of 3), `SCR-08-photo-viewer--error.html` (photo 1, unavailable), `SCR-08-photo-viewer--loading.html` (photo 3). The mockup draws a neutral stand-in where the homeowner's photo goes, because no real photo is used. Screenshots: `docs/design/screens/SCR-08-mobile.png`, `SCR-08-desktop.png`, and for each state sheet `SCR-08--error`, `--loading` with `-mobile.png` and `-desktop.png`.
- **Layout:** full-screen ink background; top bar with "Photo 2 of 3", the reference and name, and a "Close" button with a text label; the photo in a 4:3 frame; "Previous photo" and "Next photo" buttons, 44 px high, at the bottom (reachable by thumb). No zoom, download or rotate (out of scope).
- **Keyboard path:** a dialog. Focus moves to Close on open and is trapped inside. Left and Right arrow keys, or the two buttons, move between photos; Escape or Close closes and puts focus back on the thumbnail that opened it, at the same scroll position. The title "Photo 2 of 3" is announced on every move.

| State | Design | AC |
|---|---|---|
| Empty | N/A — the dialog only opens from a thumbnail; a request with no photos shows "No photos" on SCR-06 and has nothing to open. | none |
| Loading | The frame keeps its size and shows "Loading photo" so nothing jumps; Previous and Next work meanwhile. | none |
| Error | The frame says "Photo unavailable" with a "Try again" button and a line that the request itself is fine. A photo opened after the page sat for 2 hours opens as normal with no sign-in prompt. | AC-005.7, AC-012.3 |
| Success | The photo at full size with "Photo 2 of 3". Closing returns to the same request at the same scroll position, and focus goes back to the thumbnail. | AC-012.1, AC-012.2 |
| Disabled | Previous is paused on the first photo and Next on the last. There is no wrap-around. | none |

## Component map

Base components are shadcn/ui (the house stack). Everything uses `DESIGN.md` tokens through the Tailwind theme (`src/app/theme.css`). One icon family: 2 px-stroke outline icons (Lucide, the shadcn default); no emoji, no icon font. The mockups draw the same shapes inline.

| Component | Base | Variants | Used on | Notes |
|---|---|---|---|---|
| Button | shadcn `Button` | primary (teal, hover Steel Ink, 48 px), secondary (Paper with ink-faint border, 44 px), link, nav (on teal); busy and disabled (Paper with a dashed border, so it still shows on a Fog card) | all | One primary per view. A saving button reads "Saving" and is paused. |
| Field and Label | shadcn `Input`, `Textarea`, `Label` | default, error, with prefix ("$") | SCR-01, SCR-03, SCR-06 | Label above and always visible. Error text sits under the field, linked with `aria-describedby`; `aria-invalid` on the field. |
| OffersCheckbox | shadcn `Checkbox` | unticked (default), ticked, focus | SCR-01 | Never ticked on load, not required, never pre-set by script or autofill. The label is the click target (44 px strip) and reads "Email me offers and news from Northside. This is optional." Space toggles. The ticked state keeps through a refused send. |
| Wordmark | custom (the client's SVG) | on teal (Paper text, copper pipe) | header of every page except SCR-08 | 44 px high, never under 28 px, never recoloured. `aria-label` "Northside Plumbing, Hamilton"; on staff pages it is a link to Requests. Ship with text outlined or the brand fonts loaded. |
| TabNav | custom, on shadcn `NavigationMenu` | top bar (640 px and up), bottom tab bar (phones); current | SCR-04, SCR-05, SCR-06 | Two tabs, Requests and Pipeline, each its own address. One landmark, `aria-label="Main"`, `aria-current="page"` on the current tab (on SCR-06 the tab she came from is marked with `aria-current="true"`). Tab label is text plus icon, 44 px or higher. |
| UrgencyChoice | shadcn `RadioGroup` | three large radio cards, with error | SCR-01 | Arrow keys move, none preselected. The full wording is in the label. |
| PhotoPicker | custom | row with thumbnail, name, size, Remove; row with error | SCR-01 | Native file input behind a button. Remove has the file name in its label. Max 3. |
| ErrorSummary | shadcn `Alert` | error | SCR-01, SCR-06 | Takes focus on a failed submit; each item links to its field. |
| Banner | shadcn `Alert` | error, warning, success, info | SCR-01, 03, 04, 05, 06 | Icon plus title plus sentence. `role="alert"` for errors, `role="status"` for the rest. Stays until dismissed by the next action; no auto-vanishing toast for anything that matters. |
| JobTag | custom | display (teal, punched hole, hung from the copper elbow), default (teal), quiet (Fog, link) | SCR-02, 04, 05, 06, 08 | Barlow Semi Condensed Bold, tracked out. The display tag has an `aria-label` that spells the characters out; the elbow is decorative and hidden from assistive technology. The display size is smaller on phones (the h1 size) so it never forces sideways scrolling. |
| StatusBadge | shadcn `Badge` | New (teal), Quoted (amber tint), Won (green tint), Lost (Fog) | SCR-04, SCR-06 | Icon plus word plus fill, never colour alone. |
| UrgencyChip | shadcn `Badge` | Emergency (alert icon and a copper left bar on Paper), Soon (clock), Flexible (calendar) | SCR-04, 05, 06 | Icon plus word. Copper is graphic only here; the word is ink. |
| StatusFilter | shadcn `ToggleGroup` | All, New, Quoted, Won, Lost | SCR-04 only | 44 px segments, active segment is teal with a Paper label. There is no ViewSwitch any more: Requests and Pipeline are tabs (TabNav). |
| MoveToMenu | shadcn `DropdownMenu` | on a list row, on a board card | SCR-04, SCR-05 | Always visible, never hover-only. Visible text "Move to"; accessible name "Move to another status, NQ-7K3M9P" (the visible words start the name; "Move to another status, NQ-7K3M9P, saving" while it saves). Lists the other three statuses. Arrow keys, Enter, Escape. |
| BoardColumn and BoardCard | custom | column with cards, empty column, drop target; card default, dragging, saving | SCR-05 | Drag is an extra; the menu is the guaranteed path. The drag library is the frontend's call; it must honour Escape and a drop outside the columns. |
| WeekCount | custom | three tiles; updated; zero; unavailable; loading | SCR-07 (on SCR-04, SCR-05) | Polite live region. |
| RequestRow | custom | table row at 1024 px and up, stacked card below | SCR-04 | Same six facts in both layouts. |
| SyncState | custom | ok, waiting, failed, each with a time where it applies | SCR-06 | Icon plus words. Retry copy is the only action. |
| Skeleton | shadcn `Skeleton` | rows, cards, tiles, photo tiles | SCR-04, 05, 06, 07, 08 | Real layout shape. The shimmer is still under `prefers-reduced-motion`. |
| PhotoThumb | custom | button; unavailable | SCR-06 | Visible text "View photo 2"; accessible name "View photo 2 of 3 at full size" (the visible words start the name). |
| PhotoViewer | shadcn `Dialog` | photo, loading, unavailable | SCR-08 | Focus trap, Escape closes, focus returns to the thumbnail. |
| EmptyState | custom | first use, no matches, empty column | SCR-04, 05, 06 | What it is, why it is empty, the one action that fills it. |

Count: 12 shadcn primitives (Button, Input, Textarea, Label, RadioGroup, Checkbox, Alert, Badge, ToggleGroup, DropdownMenu, Skeleton, Dialog; TabNav builds on NavigationMenu) and 10 custom components (PhotoPicker, JobTag, Wordmark, TabNav, BoardColumn with BoardCard, WeekCount, RequestRow, SyncState, PhotoThumb, EmptyState). Each custom one has a reason: the job tag is the brand signature, the board and the strip have no equivalent in the base set, and the rest are small compositions of base parts.

## State matrix

Every data-bearing screen has its own States table above. Cross-screen rules that hold everywhere:

- **Loading** uses the thresholds from the handoff skill: under 100 ms nothing; 100 ms to 1 s a skeleton in the real layout; 1 to 10 s the skeleton plus a status word ("Loading requests"); a Send with photos on a slow connection shows per-photo progress in words. Skeletons reserve the same height as the content, so the page does not jump.
- **Saving** is always: the button or control says "Saving", is paused, and then resolves to success words or "Couldn't save. Try again." with the typed values kept. Optimistic movement exists only on the Pipeline tab, where rollback is designed (card returns to its column and position).
- **Errors** say what happened, what was kept, and what to do. Field errors sit under the field; page-level failures are a banner at the top of the affected area.
- **Session ended** during any save sends the user to SCR-03 with the notice; nothing is saved.
- **Nothing hides what is unavailable by colour alone** and nothing the role must never know exists is hidden (both staff have identical rights).

## Responsive behaviour

Breakpoints from `DESIGN.md`: 640, 1024, 1280. Phone first at 390 px; the layouts were checked at 375 px for the "no horizontal scrolling" criteria.

| Width | What changes |
|---|---|
| 390 px and below 640 | One column everywhere. The top bar holds the wordmark and Sign out; **the Requests and Pipeline tabs are a bottom tab bar** (64 px, icon above label, current tab on Fog with a teal top bar). The public form fills the width on a plain Paper page; request rows become stacked cards with a full-width Move to button; the Pipeline is one stacked column per status with a "Jump to a column" row; SCR-06 is one column (request, photos, quote, status, GoHighLevel); the signed-in name in the top bar is hidden. Weekly tiles stay three across. The display job tag drops to the h1 size so it fits. |
| 640 and up | **The tabs move into the teal top bar** beside the wordmark and the bottom bar goes away. The public form sits on a Paper sheet on a Fog page; two-field rows (phone and email); the Pipeline shows two columns; call and email buttons sit side by side; the search sits beside the status filter; the signed-in name appears. |
| 1024 and up | The Requests list becomes a six-column table; SCR-06 becomes two columns (request and photos on the left, quote, status and GoHighLevel on the right). |
| 1280 and up | The Pipeline shows four columns of at least 240 px with drag grips visible on cards; staff content is up to 1,120 px wide, the Pipeline up to 1,280 px. |

Touch: no action is hover-only. The Move to button is always visible. Adjacent targets are at least 8 px apart. Primary touch targets are 44 px or more (Send and Save are 48 px, tabs are 64 px).

## GHL embed

None. No screen of this product is placed inside a GoHighLevel page (Non-goal NG-11), so no embed width, no embed screenshot and no frame behaviour is designed. The public Request a quote page is a normal page Northside links to. GoHighLevel appears only as a copied contact and a stage tag, shown to staff on SCR-06.

## Accessibility notes

Target: WCAG 2.2 AA, designed in.

- **Contrast:** the DESIGN.md linter passes (0 errors, 0 warnings). Pairings it cannot see were computed by hand from the token values: ink-soft hint text on Paper 7.7:1 and on Fog 6.3:1; Paper text on teal (header, primary button, active segment, New badge, job tag) 8.4:1; teal text and links on Paper 8.4:1 and on Fog 6.9:1 (the current tab on the phone bar); badge text on its own tint 5.5 to 6.6:1; the disabled buttons (ink-soft on Paper 7.7:1, and exempt as disabled); Paper focus ring on teal and on ink 8.4:1 or better; ink focus ring on Paper or Fog 12:1 or better. Form field borders are ink-faint at 4.0:1 on Paper (3:1 needed) and 3.3:1 on Fog. **Copper is 3.3:1 on Paper**, so it is used only for graphics and large marks (the pipe, the elbow, the Emergency bar and icon, the drag outline), each with a word beside it, and never for text, links or buttons, and never on teal, ink or Fog (2.5 to 2.7:1).
- **Colour is never the only signal:** every status badge, urgency chip, sync state and error has an icon and words; the selected urgency card and the active segment also differ by shape (outline, check icon); the current tab differs by an underline or a top bar and bold text; the ticked offers box shows a tick.
- **Focus:** a 3 px ring with a 2 px gap on every control, inside the photo dialog too. The phone tab bar is fixed to the bottom, so the page sets bottom padding and `scroll-padding-bottom` equal to the bar and a focused control is never hidden behind it. On the teal bar and the photo viewer the ring is Paper.
- **Keyboard:** every task is completable by keyboard. Tabs: Tab reaches each tab, Enter opens it. Pipeline: Tab to a card, Enter on the reference opens the request, Enter on Move to opens the menu, arrows choose, Enter confirms, Escape closes. Offers checkbox: Tab reaches it, Space ticks and unticks. Photo dialog: arrows move between photos, Escape closes. Segmented controls: Tab reaches the group, arrow keys or Tab move between segments.
- **Screen readers:** one h1 per screen; landmarks (header, one nav named "Main", main); the wordmark has the text "Northside Plumbing, Hamilton"; every icon-only element is decorative (hidden) because each control also has words. Buttons whose words repeat per row carry the reference in their label (visible "Move to", name "Move to another status, NQ-7K3M9P"; "Remove photo under-sink-1.jpg"; visible "View photo 2", name "View photo 2 of 3 at full size"). Where a control shows words, its accessible name starts with exactly those words (label in name). Live regions: "Request sent" (SCR-02), "NQ-7K3M9P moved to Quoted" (SCR-05), "Won 2" (SCR-07), "Saved." (SCR-06), "Loading requests" (loading states), error banners as alerts. The reference number tag spells itself out for screen readers.
- **Forms:** labels are programmatic and visible, errors are linked to their fields, a failed submit shows a summary that links to each field, typed values are kept, nothing times out.
- **Targets:** 44 px for primary touch actions, never under 24 px.
- **Motion:** at most two things animate in any view: the skeleton shimmer and a moved card; both are still under reduced motion. Nothing flashes.
- **Text:** reading text is 16 px; resizes to 200% without loss; long words, emails and addresses wrap (`overflow-wrap`).
- **Intentional exception (one):** hints, meta lines (times, dates), badges and column labels are 15 px (Source Sans 3 runs small), never smaller. Anything a user must read to finish a task is at 17 px (error messages, button labels, the offers label, the line about how details are used). The 15 px hints under the price and note fields repeat limits that the 17 px error messages also state.
- **Wordmark small print:** "PLUMBING · HAMILTON" in the supplied logo is about 9 px tall at the 44 px header size. It is part of the logotype (exempt from text-size and contrast rules) and the header repeats the name in the wordmark's accessible name.
- **Honeypot field (US-003):** present in the page but out of sight, skipped by Tab (`tabindex="-1"`), hidden from assistive technology (`aria-hidden`), no label read out, and autofill disabled so a password manager never fills it.

## Conversion path

Primary metric: median hours to first quote (`docs/metrics-spec.md`). The path has two halves.

**Half 1, the homeowner (SCR-01, SCR-02).** Event: `quote_request_submitted` fires when the request and its photos are stored.
- Motivation: the page says what it does in one sentence ("Tell Northside what's wrong and add photos if you can. Northside will get back to you about a quote.").
- Friction cut: one page, six required answers, three groups of at most three fields, no account, no puzzle, photos optional, phone-friendly input types and autofill, urgency choices with plain wording and nothing preselected (so the choice is real).
- Prompt: one primary button labelled with the outcome, "Send request", full width at the bottom.
- Anxiety answered at the action: "Northside will use these details to reply to your quote request. It will email you offers only if you tick the box." sits directly above Send; "Only Northside staff can see them" sits at the photo picker; SCR-02 says plainly that no email or text will arrive, so the number must be written down, which removes the "will they spam me" and "did it work" worries.
- Honest persuasion only: no review counts, no ratings, no "as seen on", no urgency timers, no fake scarcity. No trust slot is drawn because the client has none yet to show.
- Marketing consent is optional, express and never pre-checked (CASL): one box, "Email me offers and news from Northside. This is optional.", unticked on every load, on its own strip apart from Send, with no wording that shames the homeowner for leaving it and no effect on whether the request is accepted or confirmed. It adds one optional tap and no required step, so it does not slow the conversion path.

**Half 2, the owner (SCR-04, SCR-05, SCR-06).** Event: `quote_request_quoted` fires when a price is first saved.
- Sign-in lands on the Requests tab, which puts the newest request first and urgency visible on every row and card, with Emergency marked by a copper bar, an alert icon and the word, so the one that needs a reply today is found at a glance (SCR-04, SCR-05). The Pipeline tab is one tap away on the same bar and shows the same count.
- SCR-06 puts call and email first, then the quote form, so the first quote takes one screen: read, call, type the price, Save (the single primary action). A price needs one field and no confirmation.
- The Pipeline's Move to menu and the Requests list's Move to menu reach the same status change in one step.

Sector conventions followed: a trades quote form looks like the simple "describe the job, add photos, we'll call you" forms homeowners already know from other trades sites, with the urgency choice up front for emergencies; the Requests tab follows the familiar email-inbox pattern (newest first, one line per item, status at the side); the Pipeline tab follows the familiar kanban pattern with the unfamiliar part (dragging) made optional by the always-visible menu; two tabs at the top on a computer and at the bottom on a phone is the pattern every phone app uses.

Suggestions for the PM (the PM owns the metrics spec): none required, the primary metric is covered end to end. If the owner later wants to know where homeowners drop off, an event for "form started" would show it; not needed for v1.

## Copy

Key microcopy, used exactly as written.

| Where | Copy |
|---|---|
| SCR-01 title and lede | "Request a quote" / "Tell Northside what's wrong and add photos if you can. Northside will get back to you about a quote." |
| SCR-01 labels | "Your name", "Phone number", "Email", "Address of the job", "What's the problem?", "How urgent is it?", "Photos (optional)" |
| SCR-01 urgency | "Emergency: Active leak or no water, need someone today"; "Soon: Within the next few days"; "Flexible: Within the next two weeks, no rush" |
| SCR-01 offers checkbox | "Email me offers and news from Northside. This is optional." (never ticked on load) |
| SCR-01 data use line (PRD v1.2) | "Northside will use these details to reply to your quote request. It will email you offers only if you tick the box." |
| SCR-01 button | "Send request" (busy: "Sending") |
| SCR-01 failures | "We couldn't send your request. Please try again."; "Too many requests. Please try again in a few minutes."; "You can add up to 3 photos"; "Each photo must be 5 MB or smaller"; "Photos must be JPEG, PNG or WebP" |
| SCR-02 | "Request sent"; "Thanks, Dana. Northside has your request."; "YOUR REFERENCE NUMBER"; "Copy reference number"; "What happens next"; "Send another request" |
| Navigation | Tabs: "Requests", "Pipeline". Top bar: "Signed in as Owner" / "Signed in as Office helper", "Sign out". |
| SCR-03 | "Staff sign-in"; "Sign in"; "Email or password is incorrect"; "Too many sign-in attempts. Try again in a few minutes."; "Sign-in is unavailable. Try again in a few minutes."; "Your session ended." |
| SCR-04 empty | "No quote requests yet"; "No lost requests" (and the same pattern for each status); "No matching requests" |
| SCR-04 and SCR-05 failures | "Couldn't load requests. Try again."; "Couldn't save. Try again."; "This request was changed by someone else. Reload to see the latest."; "Count unavailable" |
| SCR-05 | Page title "Pipeline"; "Every request, by status. Drag a card to another column, or use its Move to button. Press Escape to cancel a drag. To filter or search, use the Requests tab."; "Move to"; "Dragging"; "Saving"; "Release to move to Quoted"; "No new requests", "No quoted requests", "No won requests", "No lost requests"; "NQ-7K3M9P moved to Quoted" (read out) |
| SCR-06 | "Back to Requests" (or "Back to Pipeline"); "The request"; "Photos"; "View photo 1", "View photo 2", "View photo 3" (names "View photo N of 3 at full size"); "No photos"; "Your quote"; "Save price and note"; "Saved."; "Photo unavailable"; "Status"; "GoHighLevel" |
| SCR-06 price errors | "Enter an amount from 0.01 to 99,999.99 with at most 2 decimals"; "Notes can be up to 1,000 characters." |
| SCR-06 sync | "Copied to GoHighLevel"; "Waiting to retry"; "Copy to GoHighLevel failed"; "Retry copy"; "Stage tag up to date"; "Stage tag waiting to retry"; "Stage tag failed"; "Not copied: no offers consent" |
| SCR-06 last updated | "Last updated by Office helper at 2:05 p.m."; "Not updated yet" |
| SCR-07 | "THIS WEEK"; "Requests this week"; "Won"; "Lost"; "Count unavailable" |
| SCR-08 | "Photo 2 of 3"; "Previous photo"; "Next photo"; "Close"; "Photo unavailable"; "Loading photo" |

Dates and times are shown in Hamilton time in 12-hour form ("Nov 19, 9:10 a.m."), money as Canadian dollars ("$450.00 CAD"). All names and numbers in the mockups are made-up examples on `example.com` and 555 numbers.

## Criteria with no UI

Edge and error criteria with no screen of their own: each is behaviour the frontend and server must honour, with nothing for the designer to draw beyond what is already in the States tables.

| Criteria | Reason |
|---|---|
| AC-001.5 | A name containing script text is drawn as ordinary text everywhere it appears (SCR-02, SCR-04, SCR-05, SCR-06). A rendering rule for the frontend and a QA check; no visual state. |
| AC-001.7 | The same phone sending twice makes two requests with two numbers. Nothing on screen differs. |
| AC-001.17 | A request sent straight to the form's address with no offers value, or with "maybe", is stored as consent no. A server rule on a request the form never makes; nothing on screen differs. |
| AC-003.5 | If the rate-limit counter cannot be read the request is simply accepted. The homeowner sees the normal confirmation. |
| AC-003.7 | Thirty honeypot refusals from one address in 10 minutes log one event with a count of 30: a logging cap. The homeowner side shows the usual refusal, nothing else. |
| AC-003.8 | Past 1,000 blocked events in a Hamilton day, further refusals are not logged: a logging cap. The refusal looks the same. |
| AC-009.10 | A second ticked request with the same email links to the existing contact and leaves its address alone: server behaviour inside GoHighLevel. The owner sees the ordinary "Copied to GoHighLevel" state. |
| AC-009.11 | A second ticked request with the same phone links to the existing contact and leaves its email alone: server behaviour. Same screen as above. |
| AC-009.12 | A second request with the box unticked after a ticked first one is stored and confirmed with no GoHighLevel call and the contact unchanged: server behaviour; the screen is the "Not copied: no offers consent" state already drawn. |
| AC-009.13 | A ticked second request after an unticked first one creates the contact from the second request only: server behaviour; nothing from the first was sent. No screen difference. |
| AC-017.15 | Two ticked requests sharing one contact: the contact carries only the stage tag of the most recent change (last change wins). Server behaviour inside GoHighLevel; each request's own card shows its own stage tag state. |
| AC-008.3 | Week boundary at Sunday 23:59:59 and Monday 00:00:00 is a calculation rule; the strip only shows the resulting numbers and the dates. |
| AC-008.4 | A request submitted last week and won this week counts in Won and not in Requests this week: a calculation rule. |
| AC-008.5 | Won on Tuesday then Lost on Wednesday counts only as Lost: a calculation rule. |
| AC-008.6 | The daylight saving week (Monday 2026-10-26 to Sunday 2026-11-01) still runs Monday to Sunday in Hamilton time: a calculation rule. |
| AC-009.4 | A timed-out copy that did create the contact must not produce a second one when retried: server idempotency, invisible to the owner. |
| AC-009.5 | A price or note change does not touch the GoHighLevel contact: server behaviour, nothing shown. |
| AC-009.6 | Photos are never sent to GoHighLevel: server behaviour, nothing shown. |
| AC-017.4 | Moving a request from Won back to New swaps the stage tag: server behaviour; the screen only shows the stage tag state in the GoHighLevel card. |
| AC-017.5 | Selecting the status a request already has attempts no tag update: server behaviour, and the screen shows no message either. |
| AC-017.6 | Several quick status changes end with the latest stage tag only: server behaviour; the card shows the state of the latest push. |
| AC-017.8 | The owner's own tags on the contact are kept: server behaviour inside GoHighLevel. |
| AC-017.14 | A phone number changed inside GoHighLevel is not overwritten by a status change: server behaviour inside GoHighLevel. |

## Open questions

1. **Functional colours (Matthew).** The client's guide has five colours and no error, success or warning colour. The design adds red, green and amber with tints, for state only and always with an icon and a word. Recommendation: keep them (a product that cannot show a failed save in red is harder to use). The alternative is to rebuild Won and Quoted as teal-outlined badges and show errors in ink on Fog, which is less clear. Northside's call.
2. **Fonts in the screenshots (orchestrator).** The screenshots were rendered without Barlow Semi Condensed and Source Sans 3 because this session could not run `npm pack` to fetch the woff2 files (the command needs approval, and none was available). `design/mockups/fonts.css` already points at `design/fonts/*.woff2`; once the four files are in that folder a re-render shows the real faces. Headings will be narrower than in the current images. Nothing in the design depends on the fallback.
3. **Wordmark file (frontend).** The supplied SVG uses live text. It must ship with the text converted to outlines (or with the two fonts loaded) so it does not fall back to a system font.
4. **Tab addresses (architect).** The design needs two different addresses for Requests and Pipeline and the signed-out return to the one that was opened. `docs/architecture.md` still lists `/inbox` and `/inbox?view=board` and a view switch; those rows need to change (suggested `/requests` and `/pipeline`).
5. **SCR-02 opened again (architect and Matthew).** The reference number is shown once and there is no status lookup (NG-3). If the homeowner reloads or comes back to the page, what should it show? Recommendation: keep showing the same number in the same browser tab for the session, and send anyone arriving without one to SCR-01. The PRD does not say; the screen is designed for the normal case only.
6. **Where Back returns (designer's choice, confirm at Gate 2).** The design returns to the tab the owner came from (Requests or Pipeline), with the filter, search and scroll position kept. The stories do not require it; it costs the frontend a little state.
7. **Who a locked-out owner should phone (PM and Matthew).** FR-9 and FR-27 say she waits or phones Baseleap, but the sign-in page may not carry a forgot-password link (AC-004.10). The "unavailable" notice says "phone Baseleap" in plain text with no number, because none is on record. Recommendation: add the number as plain text once Baseleap decides which one.
8. **Drag on touch (frontend and architect).** The Move to menu is the guaranteed touch path (AC-016.17). Whether a finger drag is also offered on phones is left to the frontend; the design works without it.
9. **Could stories on screen.** Search (US-013), Retry copy (US-014) and "Last updated by" (US-015) are drawn so they can be dropped without redesign, if the architect says they are not nearly free.
10. **Offers wording (PM, real client only).** The checkbox and data-use wording are PRD v1.2 as written (OQ-16). Withdrawal of consent has no screen (NG-16).
