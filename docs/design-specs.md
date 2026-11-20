# Design specs: Northside quote requests

Status: the look is a PROPOSAL until Matthew confirms it or supplies a real brand (see Brand reference).
Reads with: `docs/user-flows.md` (inventory, navigation, flows, edge paths), `DESIGN.md` (tokens), `docs/PRD.md`, `docs/user-stories.md`.
Mockups: `design/mockups/SCR-NN-*.html` (state sheets carry a double dash, for example `SCR-05-inbox-board--errors.html`). Screenshots: `docs/design/screens/SCR-NN-mobile.png` and `SCR-NN-desktop.png`; a state sheet is `SCR-NN--<state>-mobile.png` and `-desktop.png`. No screen is placed inside another site (Non-goal NG-11), so there are no embed screenshots.

## Brand reference

- Source: `DESIGN.md`, a proposal written by the designer because the client has no logo, colours, brand guide or website and the research record names no brand source. Matthew chose option B (confirm the proposal). It is labelled PROPOSAL in every Gate 2 packet until confirmed; a real brand replaces the file whole and nothing on any screen has to change except token values.
- Look: navy ink on white, one copper accent for the single main action and links, square-ish corners, 48 px fields, system fonts (nothing to download, so the public form stays inside the 3-second 4G budget).
- Signature: the job tag. The reference number (`NQ-7K3M9P`) is always a tag: monospaced, tracked-out, ink with a punched hole on SCR-02 and SCR-06, quiet mist in rows and cards.
- No logo is drawn: the header carries the words "Northside Plumbing". None is invented.
- Only `DESIGN.md` values are used in the mockups: colours, type, spacing and radius come through `design/mockups/tokens.css` (generated). The layout constants `DESIGN.md` declares under Layout (44 px touch target, 48 px field, 240 px board column minimum, 1 px hairline, 3 px focus ring) are named once in `design/mockups/app.css`.

## Screens

### SCR-01 · Request a quote

- **Purpose:** a homeowner describes the problem in one sitting on a phone and gets a reference number. One focal point: the copper "Send request" button, the only primary action.
- **Stories:** US-001, US-002, US-003.
- **Mockups:** `design/mockups/SCR-01-request-quote.html` (filled, ready to send), `SCR-01-request-quote--errors.html` (validation), `SCR-01-request-quote--send-failed.html` (send failed, values kept). Screenshots: `docs/design/screens/SCR-01-mobile.png`, `SCR-01-desktop.png`, `SCR-01--errors-mobile.png`, `SCR-01--send-failed-mobile.png`.
- **Layout:** one column, 560 px maximum, on a mist page with a white sheet from 640 px up. Three groups of at most three fields: Your details (name, phone, email), The problem (address, problem text, urgency), Photos (optional). Labels sit above fields and are always visible. Urgency is three large radio cards with the full wording and none preselected. A single line states how the details are used. The primary button is full width, 48 px high, labelled "Send request". A footer link, "Staff sign-in", is the only way to reach SCR-03.
- **Behaviour:** validation runs on Send, not on every keystroke. A failed Send moves focus to an error summary at the top that links to each field; every error also sits under its field with an icon and says how to fix it. Typed values and attached photos are always kept. Photo rows show a thumbnail, file name, size and a Remove button with the file name in its label. The hidden spam field is invisible to everyone, skipped by the keyboard and ignored by screen readers.

| State | Design | AC |
|---|---|---|
| Empty | The blank form. No urgency preselected, no photos. Photos are optional, and Send with no photos is accepted. | AC-002.5 |
| Loading | After Send the button reads "Sending", is paused and cannot be pressed twice; each photo row shows its upload progress in words ("Uploading 2 of 3"); the whole form stays on screen. One tap makes one request. | AC-001.6, AC-002.7 |
| Error | Summary at the top plus a message under each field: empty fields; problem of 9 or 2,001 characters with the allowed length (10 to 2,000); phone or email refused with the rest kept; a 4th photo not added ("You can add up to 3 photos"); a photo over 5 MB ("Each photo must be 5 MB or smaller"); a PDF or renamed text file ("Photos must be JPEG, PNG or WebP"); upload failed on one photo shows the error beside that photo; database down, honeypot filled and too-fast send all show "We couldn't send your request. Please try again." and never say which check failed; the sixth send in 10 minutes shows "Too many requests. Please try again in a few minutes." | AC-001.2, AC-001.3, AC-001.4, AC-001.8, AC-002.2, AC-002.3, AC-002.4, AC-002.6, AC-003.2, AC-003.3, AC-003.4 |
| Success | The page is replaced by SCR-02 with the reference number. A rapid second tap still gives one number. | AC-001.6 |
| Disabled | "Add a photo" is paused once 3 photos are attached, with the words "You can add up to 3 photos" beside it. Send is paused while sending (see Loading). Nothing is hidden. | AC-002.2, AC-001.6 |

### SCR-02 · Request sent

- **Purpose:** show the reference number in the most findable way possible, because no email or text is sent (AC-001.12), and say what happens next. Focal point: the reference number as a large ink job tag.
- **Stories:** US-001, US-002.
- **Mockups:** `design/mockups/SCR-02-confirmation.html`. Screenshots: `docs/design/screens/SCR-02-mobile.png`, `SCR-02-desktop.png`.
- **Layout:** a live "Request sent" line, an h1 that names the homeowner ("Thanks, Dana. Northside has your request."), the tag at display size, a "Copy reference number" button (the one primary action), a short "What happens next" list that says no email or text will arrive so the number should be written down or screenshotted, then a recap of what was sent. "Send another request" is a quiet secondary button.
- **Behaviour:** the confirmation is announced to screen readers when the page loads. The number is real selectable text as well as a button, so copying never depends on the clipboard.

| State | Design | AC |
|---|---|---|
| Empty | N/A — the page is only reached from a successful send. Opening it directly is an open question (see Open questions). | none |
| Loading | N/A — the number arrives with the response that brings the page; SCR-01 shows the busy Send button until then. | none |
| Error | The Copy button cannot reach the clipboard: the line "Couldn't copy. Select the number and copy it by hand." appears under it. Every send failure stays on SCR-01. | AC-001.8 |
| Success | The primary design. It looks exactly the same when the GoHighLevel copy waits or fails; the homeowner is never told about GoHighLevel. | AC-001.9 |
| Disabled | N/A — nothing on this page is ever unavailable. | none |

### SCR-03 · Staff sign-in

- **Purpose:** the owner and helper sign in with email and password. One focal point: the copper "Sign in" button.
- **Stories:** US-004.
- **Mockups:** `design/mockups/SCR-03-sign-in.html`, `SCR-03-sign-in--error.html` (the three notices together for review). Screenshots: `docs/design/screens/SCR-03-mobile.png`, `SCR-03-desktop.png`, `SCR-03--error-mobile.png`.
- **Layout:** a narrow centred form, 440 px maximum. Email, Password with a Show button, Sign in. Both fields work with password managers and paste (`autocomplete` set to username and current-password). No puzzle, no memory test. Notices appear above the form, one at a time.
- **Behaviour:** no "Create account" link and no "Forgot password" link, because neither exists in v1. A failed attempt keeps the email and clears the password.

| State | Design | AC |
|---|---|---|
| Empty | The blank form; nothing is pre-filled. | none |
| Loading | The button reads "Signing in" and is paused so one press makes one attempt. | none |
| Error | Wrong password or unknown email show the same words: "Email or password is incorrect". After 5 failed tries in 15 minutes the warning says sign-in is paused for 15 minutes even with the right password. A session that ended shows an info notice: "Your session ended. Your last change was not saved. Sign in again, then check the request." | AC-004.4, AC-004.5, AC-004.7, AC-016.14 |
| Success | The owner or helper lands on SCR-04. A signed-out visitor who opened the inbox address lands on the inbox after signing in. Signing out returns here. | AC-004.1, AC-004.2, AC-004.3, AC-004.9 |
| Disabled | No way to create an account is offered anywhere on the page, and a direct request to create one is refused. | AC-004.6 |

### SCR-04 · Inbox, List view

- **Purpose:** the owner sees every request, newest first, and finds the one to deal with. Focal point: the first row; the weekly strip sits above it as a glance, not a call to action. There is no primary button on this screen: the work happens by opening a row, and "Move to" is secondary.
- **Stories:** US-005, US-007, US-008, US-011, US-013.
- **Mockups:** `design/mockups/SCR-04-inbox-list.html`, `SCR-04-inbox-list--empty.html`, `SCR-04-inbox-list--errors.html`, `SCR-04-inbox-list--loading.html`. Screenshots: `docs/design/screens/SCR-04-mobile.png`, `SCR-04-desktop.png`, and for each state sheet `SCR-04--empty`, `--errors`, `--loading` with `-mobile.png` and `-desktop.png`.
- **Layout:** the weekly strip (SCR-07), then the List / Board switch with the search beside it, then the status filter (All, New, Quoted, Won, Lost), then the rows. At 1024 px and up each request is one row in a six-column table: reference, name, urgency, status, submitted, Move to. Below 1024 px each request is a stacked card with the same six facts, so nothing scrolls sideways at 375 px. Status badges carry an icon and the word. The list is 50 rows, then a "Show more" button.
- **Behaviour:** the reference and the name are both links to SCR-06. "Move to" is a menu with the other three statuses, available on every row. Changing a status never moves the row (the order is by submitted time only).

| State | Design | AC |
|---|---|---|
| Empty | First use: "No quote requests yet", what will show up here, and a link to the Request a quote page; the count shows 0, 0, 0. A filter with no matches: "No lost requests" style message and a "Show all requests" button. A search with no matches: "No matching requests". | AC-005.4, AC-008.7, AC-011.2, AC-013.2 |
| Loading | Skeleton rows and skeleton count tiles in the real layout, so nothing jumps when data arrives. The page is marked busy and "Loading requests" is announced. | none |
| Error | The list cannot load: "Couldn't load requests. Try again." with a Try again button, and the previous list is not shown as if it were filtered. The count cannot load: "Count unavailable" and the list still loads. A status save from a row fails: "Couldn't save. Try again.", the row keeps its old status. The session ended: sent to SCR-03. | AC-011.4, AC-008.8, AC-007.6, AC-004.7 |
| Success | A status change shows the new badge in place and the row stays where it was. Marking a request Won from Won to Lost works the same. With a filter on, the row leaves the list without a page reload. A partial name search lists the match. | AC-007.5, AC-007.3, AC-011.3, AC-013.3 |
| Disabled | While a row's status saves, its Move to button is paused. Choosing the status a request already has does nothing and shows no message. | AC-007.4 |
| Long list | 51 requests: the 50 newest and a "Show more" button that adds the last one. | AC-005.5 |

### SCR-05 · Inbox, Board view

- **Purpose:** the whole pipeline at a glance and a one-move status change. Focal point: the four columns. No primary button; the "Move to" button on each card is secondary.
- **Stories:** US-016, US-007, US-008.
- **Mockups:** `design/mockups/SCR-05-inbox-board.html`, `SCR-05-inbox-board--moving.html` (menu open, dragging, saving), `SCR-05-inbox-board--errors.html`, `SCR-05-inbox-board--empty.html` (empty columns, "Show more"), `SCR-05-inbox-board--loading.html`. Screenshots: `docs/design/screens/SCR-05-mobile.png`, `SCR-05-desktop.png`, and for each state sheet `SCR-05--moving`, `--errors`, `--empty`, `--loading` with `-mobile.png` and `-desktop.png`.
- **Layout:** four columns at 1280 px (240 px minimum each), two at 640 px, one column stacked on a phone with a "Jump to a column" row so the owner can reach Lost without scrolling past everything. Each card holds the reference tag, the name, urgency (icon and word), the submitted time and a full-width "Move to" button, 44 px high. No column can be added, renamed, recoloured, removed or reordered, and nothing offers it.
- **Behaviour (the three ways to move a card):**
  1. Drag with a mouse or finger. The source keeps a dashed gap; the card under the pointer wears a copper outline and the word "Dragging"; the target column is dashed; Escape or releasing outside the four columns puts it back.
  2. "Move to" menu: Enter or a tap opens it, arrow keys move through the other three statuses, Enter chooses, Escape closes and returns focus to the button.
  3. After either move the card sits in its new column marked "Saving". On success focus stays on the card and a screen-reader message says "NQ-7K3M9P moved to Quoted". On failure the card goes back.
- **Keyboard path for the board:** Tab reaches each card's reference link and then its Move to button; the menu is the keyboard and touch path, so the drag has no keyboard equivalent to build. Cards are listed newest first within a column, and a moved card takes its submitted-time position, never the top.

| State | Design | AC |
|---|---|---|
| Empty | No requests at all: four columns each with its own message ("No new requests", "No quoted requests", "No won requests", "No lost requests"), and the count 0, 0, 0. An empty column is still a valid place to move a card to. | AC-016.11, AC-005.4 |
| Loading | Four skeleton columns with skeleton cards, and skeleton count tiles. Busy and announced as "Loading the board". | none |
| Error | The board cannot load: "Couldn't load requests. Try again." and no columns. The save fails after a drop or a menu choice: the card goes back to its column and position, "Couldn't save. Try again." shows, focus returns to the card's Move to button. Someone else changed it first: the card goes back and "This request was changed by someone else. Reload to see the latest." with a Reload button. The session ended: the card goes back and the owner is sent to SCR-03. | AC-016.15, AC-016.13, AC-016.12, AC-016.14 |
| Success | The card stays in its new column, the weekly count updates within 2 seconds, and the screen-reader message is read. A moved card takes its time position (09:10, 09:00, 08:00), not the top. Dropping a card back into its own column, outside the columns, or pressing Escape stores nothing. 51 cards in one column: 50 and "Show more" for that column only. | AC-016.3, AC-016.6, AC-016.7, AC-016.8, AC-016.10 |
| Disabled | A card that is saving shows "Saving" and its Move to button is paused. No control to add, rename, delete or reorder a column exists. On a 375 px phone the Move to menu moves a card with taps only and the page never scrolls sideways. | AC-016.13, AC-016.9, AC-016.17 |

### SCR-06 · Request detail

- **Purpose:** read one request, record the price and note, set the status, and see whether the GoHighLevel copy worked. Focal point: the job tag and name at the top, then the copper "Save price and note" button, the only primary action.
- **Stories:** US-005, US-006, US-007, US-009, US-010, US-012, US-014, US-015, US-017.
- **Mockups:** `design/mockups/SCR-06-request-detail.html` (primary), `SCR-06-request-detail--saved.html`, `--errors.html`, `--sync.html` (GoHighLevel and stage-tag states, retry, last updated), `--empty.html` (no photos, no price), `--loading.html`. Screenshots: `docs/design/screens/SCR-06-mobile.png`, `SCR-06-desktop.png`, and for each state sheet `SCR-06--saved`, `--errors`, `--sync`, `--empty`, `--loading` with `-mobile.png` and `-desktop.png`.
- **Layout:** header with a "Back to Inbox" link, the display job tag, the name as h1, then status badge, urgency and submitted time (Hamilton time). From 1024 px two columns: left is the request (call and email buttons, then phone, email, address, urgency and the problem as plain text) and the photos; right is Your quote (price and note), Status, and GoHighLevel. On a phone one column in that order, so the owner reads, then quotes. Phone is a tap-to-call link and email is an email link. Price has a visible label, a fixed "$" prefix and the hint "From 0.01 to 99,999.99. No tax is added and no payment is taken." Both price and note are optional and either can be saved alone. Status is a four-part control; choosing one saves at once and the control is busy until it finishes. Saving a price never changes the status, and the screen says so.
- **GoHighLevel card:** two lines, each an icon and words (never colour alone): CONTACT COPY (Copied to GoHighLevel with the time; Waiting to retry; Copy to GoHighLevel failed with the time of the last try and a "Retry copy" button) and STAGE TAG (Stage tag up to date; Stage tag waiting to retry; Stage tag failed with the time of the last try). Retry copy is the Could story US-014 and is one self-contained button. No token or technical detail is ever shown.
- **Last updated:** "Last updated by Office helper at 2:05 p.m." or "Not updated yet" (US-015, Could).

| State | Design | AC |
|---|---|---|
| Empty | No photos: a dashed panel "No photos" with a line that the homeowner did not attach any. No price or note yet: both fields blank and a line saying either can be saved alone. A request nobody has changed: "Not updated yet". | AC-005.6, AC-002.5, AC-015.2 |
| Loading | Skeleton in the real two-column layout, including the three photo tiles, so nothing jumps. While a save runs the Save button reads "Saving", and the status control is paused with the chosen status showing a busy icon. | none |
| Error | Price or note refused: an error summary at the top of the form that links to each field, the message under the field ("Enter an amount from 0.01 to 99,999.99 with at most 2 decimals"; "Notes can be up to 1,000 characters. This one is 1,001."), and everything typed stays. Save failed on the network: "Couldn't save. Try again." with values kept and the button reading "Try saving again". Someone else saved first: "This request was changed by someone else. Reload to see the latest." with a Reload button and the typed note kept below to copy. Photo storage unreachable: each photo slot says "Photo unavailable" and the rest of the page shows. Session ended: nothing saved, sent to SCR-03. A failed status save keeps the previous status with "Couldn't save. Try again." | AC-006.3, AC-006.4, AC-006.7, AC-006.5, AC-005.7, AC-004.7, AC-007.6 |
| Success | A "Saved." banner names what was stored ("Price $450.00 CAD and your note are stored"), the price shows large above the field, the status badge changes, and "Last updated by Owner at 2:05 p.m." appears. A note can be saved without a price. A new price replaces the old one and the old one is shown nowhere. Won can go to Lost. | AC-006.2, AC-006.6, AC-007.3, AC-015.1 |
| Disabled | Choosing the status already selected does nothing and says nothing. "Retry copy" is paused while the try runs ("Retrying"), so a double click makes one try. | AC-007.4, AC-014.3 |
| Partial or stale | Copy waiting, failed or token rejected, and stage tag waiting, failed or up to date, each shown in the GoHighLevel card as above. The request stays fully editable in every one of these states. A retry that fails says "The retry did not work." and the state stays failed. A stage tag for a request whose copy is still waiting reads "Stage tag waiting to retry" too. | AC-009.2, AC-009.3, AC-010.3, AC-010.4, AC-014.2, AC-017.7, AC-017.9, AC-017.10, AC-017.11 |

### SCR-07 · Weekly count

- **Purpose:** three numbers for the current Monday to Sunday week, so the owner does not count by hand. Not a page: a strip at the top of SCR-04 and SCR-05, above the view switch, identical in both. Focal point: three large numbers. No action on it except "Try again" when it cannot load.
- **Stories:** US-008.
- **Mockups:** `design/mockups/SCR-07-weekly-count.html` (the strip alone in each state; it also appears in context on the SCR-04 and SCR-05 mockups). Screenshots: `docs/design/screens/SCR-07-mobile.png`, `SCR-07-desktop.png`.
- **Layout:** a small "THIS WEEK" label with the dates ("Mon Nov 16 to Sun Nov 22, Hamilton time"), then three tiles in a row at every width: Requests this week, Won (check icon), Lost (cross icon). The number is 40 px, the label 14 px semibold. The strip never changes with the list filter.
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
| Button | shadcn `Button` | primary (copper, 48 px), secondary (white with steel border, 44 px), link, nav (on ink); busy and disabled | all | One primary per view. A saving button reads "Saving" and is paused. |
| Field and Label | shadcn `Input`, `Textarea`, `Label` | default, error, with prefix ("$") | SCR-01, SCR-03, SCR-06 | Label above and always visible. Error text sits under the field, linked with `aria-describedby`; `aria-invalid` on the field. |
| UrgencyChoice | shadcn `RadioGroup` | three large radio cards, with error | SCR-01 | Arrow keys move, none preselected. The full wording is in the label. |
| PhotoPicker | custom | row with thumbnail, name, size, Remove; row with error | SCR-01 | Native file input behind a button. Remove has the file name in its label. Max 3. |
| ErrorSummary | shadcn `Alert` | error | SCR-01, SCR-06 | Takes focus on a failed submit; each item links to its field. |
| Banner | shadcn `Alert` | error, warning, success, info | SCR-01, 03, 04, 05, 06 | Icon plus title plus sentence. `role="alert"` for errors, `role="status"` for the rest. Stays until dismissed by the next action; no auto-vanishing toast for anything that matters. |
| JobTag | custom | display (ink, punched hole), default (ink), quiet (mist, link) | SCR-02, 04, 05, 06, 08 | Monospace. The display tag has an `aria-label` that spells the characters out. |
| StatusBadge | shadcn `Badge` | New, Quoted, Won, Lost | SCR-04, SCR-06 | Icon plus word plus tint, never colour alone. |
| UrgencyChip | shadcn `Badge` | Emergency (red, alert icon), Soon (clock), Flexible (calendar) | SCR-04, 05, 06 | Icon plus word. |
| ViewSwitch and StatusFilter | shadcn `ToggleGroup` | List / Board; All, New, Quoted, Won, Lost | SCR-04, SCR-05 | 44 px segments, active segment is ink with a white label. |
| MoveToMenu | shadcn `DropdownMenu` | on a list row, on a board card | SCR-04, SCR-05 | Always visible, never hover-only. Lists the other three statuses. Arrow keys, Enter, Escape. |
| BoardColumn and BoardCard | custom | column with cards, empty column, drop target; card default, dragging, saving | SCR-05 | Drag is an extra; the menu is the guaranteed path. The drag library is the frontend's call; it must honour Escape and a drop outside the columns. |
| WeekCount | custom | three tiles; updated; zero; unavailable; loading | SCR-07 (on SCR-04, SCR-05) | Polite live region. |
| RequestRow | custom | table row at 1024 px and up, stacked card below | SCR-04 | Same six facts in both layouts. |
| SyncState | custom | ok, waiting, failed, each with a time where it applies | SCR-06 | Icon plus words. Retry copy is the only action. |
| Skeleton | shadcn `Skeleton` | rows, cards, tiles, photo tiles | SCR-04, 05, 06, 07, 08 | Real layout shape. The shimmer is still under `prefers-reduced-motion`. |
| PhotoThumb | custom | button; unavailable | SCR-06 | Label "Open photo 2 of 3 at full size". |
| PhotoViewer | shadcn `Dialog` | photo, loading, unavailable | SCR-08 | Focus trap, Escape closes, focus returns to the thumbnail. |
| EmptyState | custom | first use, no matches, empty column | SCR-04, 05, 06 | What it is, why it is empty, the one action that fills it. |

Count: 11 shadcn primitives (Button, Input, Textarea, Label, RadioGroup, Alert, Badge, ToggleGroup, DropdownMenu, Skeleton, Dialog) and 8 custom components (PhotoPicker, JobTag, BoardColumn with BoardCard, WeekCount, RequestRow, SyncState, PhotoThumb, EmptyState). Each custom one has a reason: the job tag is the brand signature, the board and the strip have no equivalent in the base set, and the rest are small compositions of base parts.

## State matrix

Every data-bearing screen has its own States table above. Cross-screen rules that hold everywhere:

- **Loading** uses the thresholds from the handoff skill: under 100 ms nothing; 100 ms to 1 s a skeleton in the real layout; 1 to 10 s the skeleton plus a status word ("Loading requests"); a Send with photos on a slow connection shows per-photo progress in words. Skeletons reserve the same height as the content, so the page does not jump.
- **Saving** is always: the button or control says "Saving", is paused, and then resolves to success words or "Couldn't save. Try again." with the typed values kept. Optimistic movement exists only on the Board, where rollback is designed (card returns to its column and position).
- **Errors** say what happened, what was kept, and what to do. Field errors sit under the field; page-level failures are a banner at the top of the affected area.
- **Session ended** during any save sends the user to SCR-03 with the notice; nothing is saved.
- **Nothing hides what is unavailable by colour alone** and nothing the role must never know exists is hidden (both staff have identical rights).

## Responsive behaviour

Breakpoints from `DESIGN.md`: 640, 1024, 1280. Phone first at 390 px; the layouts were checked at 375 px for the "no horizontal scrolling" criteria.

| Width | What changes |
|---|---|
| 390 px and below 640 | One column everywhere. The public form fills the width on a plain white page; request rows become stacked cards with a full-width Move to button; the Board is one stacked column per status with a "Jump to a column" row; SCR-06 is one column (request, photos, quote, status, GoHighLevel); the signed-in name in the top bar is hidden. Weekly tiles stay three across. |
| 640 and up | The public form sits on a white sheet on a mist page; two-field rows (phone and email); the Board shows two columns; call and email buttons sit side by side; the search sits beside the view switch; the signed-in name appears. |
| 1024 and up | The inbox list becomes a six-column table; SCR-06 becomes two columns (request and photos on the left, quote, status and GoHighLevel on the right). |
| 1280 and up | The Board shows four columns of at least 240 px with drag grips visible on cards; staff content is up to 1,120 px wide, the board up to 1,280 px. |

Touch: no action is hover-only. The Move to button is always visible. Adjacent targets are at least 8 px apart. Primary touch targets are 44 px or more (Send and Save are 48 px).

## GHL embed

None. No screen of this product is placed inside a GoHighLevel page (Non-goal NG-11), so no embed width, no embed screenshot and no frame behaviour is designed. The public Request a quote page is a normal page Northside links to. GoHighLevel appears only as a copied contact and a stage tag, shown to staff on SCR-06.

## Accessibility notes

Target: WCAG 2.2 AA, designed in.

- **Contrast:** the DESIGN.md linter passes (0 errors). Pairings it cannot see were checked by hand from the token values: slate hint text on white 7.7:1 and on mist 7.0:1; badge text on its own tint 5.5 to 6.6:1; Emergency red on its tint 5.5:1; copper link on white 6.0:1; the disabled Move to and Send buttons (slate on fog 6.3:1, and exempt as disabled); white text on ink for the active segment and the staff bar 15.6:1; the paper focus ring on ink 15.6:1; ink focus ring on white or mist 14:1 or better. Form field borders are steel at 4.7:1 (3:1 needed).
- **Colour is never the only signal:** every status badge, urgency chip, sync state and error has an icon and words; the selected urgency card and the active segment also differ by shape (outline, check icon).
- **Focus:** a 3 px ring with a 2 px gap on every control, inside the photo dialog too, and never behind a sticky bar (nothing is sticky in v1). On the ink bar and the photo viewer the ring is paper.
- **Keyboard:** every task is completable by keyboard. Board: Tab to a card, Enter on the reference opens the request, Enter on Move to opens the menu, arrows choose, Enter confirms, Escape closes. Photo dialog: arrows move between photos, Escape closes. Segmented controls: Tab reaches the group, arrow keys or Tab move between segments.
- **Screen readers:** one h1 per screen; landmarks (header, nav, main); every icon-only element is decorative (hidden) because each control also has words. Buttons whose words repeat per row carry the reference in their label ("Move NQ-7K3M9P to another status", "Remove photo under-sink-1.jpg", "Open photo 2 of 3 at full size"). Live regions: "Request sent" (SCR-02), "NQ-7K3M9P moved to Quoted" (SCR-05), "Won 2" (SCR-07), "Saved." (SCR-06), "Loading requests" (loading states), error banners as alerts. The reference number tag spells itself out for screen readers.
- **Forms:** labels are programmatic and visible, errors are linked to their fields, a failed submit shows a summary that links to each field, typed values are kept, nothing times out.
- **Targets:** 44 px for primary touch actions, never under 24 px.
- **Motion:** at most two things animate in any view: the skeleton shimmer and a moved card; both are still under reduced motion. Nothing flashes.
- **Text:** reading text is 16 px; resizes to 200% without loss; long words, emails and addresses wrap (`overflow-wrap`).
- **Intentional exception (one):** hints, meta lines (times, dates), badges and column labels are 14 px, never smaller. Anything a user must read to finish a task is also stated at 16 px (error messages, button labels, the line about how details are used). The 14 px hints under the price and note fields repeat limits that the 16 px error messages also state.
- **Honeypot field (US-003):** present in the page but out of sight, skipped by Tab (`tabindex="-1"`), hidden from assistive technology (`aria-hidden`), no label read out, and autofill disabled so a password manager never fills it.

## Conversion path

Primary metric: median hours to first quote (`docs/metrics-spec.md`). The path has two halves.

**Half 1, the homeowner (SCR-01, SCR-02).** Event: `quote_request_submitted` fires when the request and its photos are stored.
- Motivation: the page says what it does in one sentence ("Tell Northside what's wrong and add photos if you can. Northside will get back to you about a quote.").
- Friction cut: one page, six required answers, three groups of at most three fields, no account, no puzzle, photos optional, phone-friendly input types and autofill, urgency choices with plain wording and nothing preselected (so the choice is real).
- Prompt: one primary button labelled with the outcome, "Send request", full width at the bottom.
- Anxiety answered at the action: "Northside will use these details only to reply to your quote request." sits directly above Send; "Only Northside staff can see them" sits at the photo picker; SCR-02 says plainly that no email or text will arrive, so the number must be written down, which removes the "will they spam me" and "did it work" worries.
- Honest persuasion only: no review counts, no ratings, no "as seen on", no urgency timers, no fake scarcity. No trust slot is drawn because the client has none yet to show.
- No marketing consent is asked or pre-checked anywhere (CASL). The form collects contact details for replying only.

**Half 2, the owner (SCR-04, SCR-05, SCR-06).** Event: `quote_request_quoted` fires when a price is first saved.
- The inbox puts the newest request first and urgency visible on every row and card, with Emergency in red with an icon, so the one that needs a reply today is found at a glance (SCR-04, SCR-05).
- SCR-06 puts call and email first, then the quote form, so the first quote takes one screen: read, call, type the price, Save (the single primary action). A price needs one field and no confirmation.
- The Board's Move to menu and the list's Move to menu reach the same status change in one step.

Sector conventions followed: a trades quote form looks like the simple "describe the job, add photos, we'll call you" forms homeowners already know from other trades sites, with the urgency choice up front for emergencies; the inbox follows the familiar email-inbox pattern (newest first, one line per item, status at the side); the board follows the familiar kanban pattern with the unfamiliar part (dragging) made optional by the always-visible menu.

Suggestions for the PM (the PM owns the metrics spec): none required, the primary metric is covered end to end. If the owner later wants to know where homeowners drop off, an event for "form started" would show it; not needed for v1.

## Copy

Key microcopy, used exactly as written.

| Where | Copy |
|---|---|
| SCR-01 title and lede | "Request a quote" / "Tell Northside what's wrong and add photos if you can. Northside will get back to you about a quote." |
| SCR-01 labels | "Your name", "Phone number", "Email", "Address of the job", "What's the problem?", "How urgent is it?", "Photos (optional)" |
| SCR-01 urgency | "Emergency: Active leak or no water, need someone today"; "Soon: Within the next few days"; "Flexible: Within the next two weeks, no rush" |
| SCR-01 data use line | "Northside will use these details only to reply to your quote request." |
| SCR-01 button | "Send request" (busy: "Sending") |
| SCR-01 failures | "We couldn't send your request. Please try again."; "Too many requests. Please try again in a few minutes."; "You can add up to 3 photos"; "Each photo must be 5 MB or smaller"; "Photos must be JPEG, PNG or WebP" |
| SCR-02 | "Request sent"; "Thanks, Dana. Northside has your request."; "YOUR REFERENCE NUMBER"; "Copy reference number"; "What happens next"; "Send another request" |
| SCR-03 | "Staff sign-in"; "Sign in"; "Email or password is incorrect"; "Sign-in is paused for 15 minutes."; "Your session ended." |
| SCR-04 empty | "No quote requests yet"; "No lost requests" (and the same pattern for each status); "No matching requests" |
| SCR-04 and SCR-05 failures | "Couldn't load requests. Try again."; "Couldn't save. Try again."; "This request was changed by someone else. Reload to see the latest."; "Count unavailable" |
| SCR-05 | "Move to"; "Dragging"; "Saving"; "Release to move to Quoted"; "No new requests", "No quoted requests", "No won requests", "No lost requests"; "NQ-7K3M9P moved to Quoted" (read out) |
| SCR-06 | "Back to Inbox"; "The request"; "Photos"; "No photos"; "Your quote"; "Save price and note"; "Saved."; "Photo unavailable"; "Status"; "GoHighLevel" |
| SCR-06 price errors | "Enter an amount from 0.01 to 99,999.99 with at most 2 decimals"; "Notes can be up to 1,000 characters." |
| SCR-06 sync | "Copied to GoHighLevel"; "Waiting to retry"; "Copy to GoHighLevel failed"; "Retry copy"; "Stage tag up to date"; "Stage tag waiting to retry"; "Stage tag failed" |
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
| AC-003.5 | If the rate-limit counter cannot be read the request is simply accepted. The homeowner sees the normal confirmation. |
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

1. **Brand (Matthew, decided as option B, still to confirm).** `DESIGN.md` is a PROPOSAL: navy and white, one copper accent, system fonts. Recommendation: confirm it for the rehearsal; for a real client, upload a logo or brand guide and the file is replaced whole.
2. **SCR-02 opened again (architect and Matthew).** The reference number is shown once and there is no status lookup (NG-3). If the homeowner reloads or comes back to the page, what should it show? Recommendation: keep showing the same number in the same browser tab for the session, and send anyone arriving without one to SCR-01. The PRD does not say; the screen is designed for the normal case only.
3. **Where Back to Inbox returns (designer's choice, confirm at Gate 2).** The design returns to the view the owner came from (List or Board), with the filter and scroll position kept. The stories do not require it; it costs the frontend a little state.
4. **Drag on touch (frontend and architect).** The Move to menu is the guaranteed touch path (AC-016.17). Whether a finger drag is also offered on phones is left to the frontend; the design works without it.
5. **Could stories on screen.** Search (US-013), Retry copy (US-014) and "Last updated by" (US-015) are drawn so they can be dropped without redesign, if the architect says they are not nearly free.
