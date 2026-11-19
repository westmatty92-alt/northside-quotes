---
product: Northside quote requests
client: Northside Plumbing (TEST)
version: v1
status: draft
build_mode: hybrid
system_of_record: our app (Supabase ca-central-1) owns every quote request and its photos
platform_roles: our app = public form, owner inbox, source of truth; GoHighLevel test sub-account = one-way contact copy tagged quote-request, never authoritative; Vercel = hosting; Supabase ca-central-1 = database, sign-in, private photo storage
ai_output: false
---

# PRD: Northside quote requests

## Overview

### Problem
When a homeowner in Hamilton has a plumbing problem, the three-person Northside shop struggles to catch the quote request, because requests arrive by phone, text and Facebook and some get lost. That costs Northside jobs it never knew it was offered. Today they scroll three channels and rely on memory (brief, "The problem").

### Job to be done
When a homeowner contacts me about a plumbing problem, I want every request to land in one place with the details and photos, so I can reply, record my price, and know which jobs I won.

### Personas
| Persona | Who they are | Evidence |
|---|---|---|
| Homeowner | A Hamilton homeowner with a plumbing problem who wants a quote, usually on a phone, with no account | Brief, "What they asked for" (mobile-first public page, up to 3 photos, no customer accounts); intake answer 1 |
| Owner | Runs Northside; wants one inbox, to add a price and note, and to mark won or lost | Brief, "The problem"; intake answer 1 |
| Office helper | Works alongside the owner with identical rights (same inbox, same actions) | Brief, "Constraints" (two users, same rights); intake answer 7 |

The research record for this client is empty (no website, no current stack, no research brief). No customer quotes, volumes or baselines are claimed anywhere in this PRD; where a number is a design assumption it says so.

### Why now
This is the full-team rehearsal: it exercises every phase on throwaway accounts with a fake client. For the (fake) client, the cost of waiting is more lost requests; the real purpose is a small, complete product to run the pipeline end to end.

### Severity note
Frequency is unknown (no research). If this were a real client, the first step would be to count requests per week for 14 days. Pain per lost request is high (a lost job), so the build is justified on severity, not frequency.

## Goals & Success Metrics
- **Primary metric:** Median hours to first quote — baseline unknown (measure for 14 days first) → proposed target 24 hours or less within 30 days after launch; target pending OQ-9 (full definition in `docs/metrics-spec.md`)
- **Guardrails:** GHL copy success rate must stay at or above 95% within 24 hours; Photo upload failure rate must stay at or below 5 per 100 submitted requests; Blocked submission share must stay at or below 20% of attempts (all thresholds proposed, set in `docs/metrics-spec.md`)
- **Rehearsal definition of done (intake answer 1):** the Playwright E2E on the staging preview passes: homeowner submits with photos → sees a reference number → owner signs in and sees it at the top of the inbox → adds price and note → marks it won → the weekly count updates. After Gate 3, the production health URL returns 200.

## Scope

### In scope (v1)
Spine: a homeowner submits a request with photos and gets a reference number; the owner signs in, sees it at the top of the inbox, adds a price and note, marks it won, and the weekly count updates.

Must (8 stories):
- Public Request a quote page with validation and reference number — US-001
- Up to 3 private photos per request — US-002
- Spam protection without a puzzle — US-003
- Sign-in for the two users, invite-only — US-004
- Inbox and request detail, newest first, with photos — US-005
- Price and note per request — US-006
- Status New, Quoted, Won, Lost — US-007
- Weekly count of requests, won, lost — US-008

Should (4 stories; cut first if the run overruns):
- One-way copy of each new request to the GoHighLevel test sub-account as a contact tagged `quote-request` — US-009
- Visible copy state and automatic retry — US-010
- Inbox status filter — US-011
- Full-size photo view — US-012

Could (3 stories; only if the architect says nearly free):
- Search by reference, name or phone — US-013
- Manual Retry button for a failed copy — US-014
- "Last updated by" display — US-015

MoSCoW summary: 8 Must, 4 Should, 3 Could, 15 stories in total; Musts are 53% of stories. Won't-this-time items are the non-goals below. Note that the Should-level GHL copy is part of the locked build mode (hybrid); it is Should only because the job works without it, and its safety rule (a failed copy never blocks or loses a request) is a Must inside US-001 (AC-001.9).

### Non-goals
- **NG-1** No notification of any kind (no email, SMS, push, or in-app alert) to the owner, the helper or the homeowner — the $0 limit allows no email or SMS provider and the rehearsal sends no real messages; the owner replies by phone or text from her own phone using the number shown — revisit when a provider is approved and a real client is live.
- **NG-2** No CAPTCHA, Turnstile or any third-party bot challenge — needs an outside account, and the $0 limit applies — revisit only if the honeypot, time trap and rate limit let spam through (see OQ-1).
- **NG-3** No customer accounts and no page where a homeowner looks up a request's status; the reference number is the only receipt — brief says no customer accounts — revisit after the owner asks for it.
- **NG-4** No in-app user management, public sign-up, password-reset email, magic links or social sign-in; the two accounts are created by Baseleap — email-based sign-in flows need an email provider — revisit with NG-1.
- **NG-5** No payments, deposits, invoices, tax calculation or Stripe; the price is a note of what was quoted — brief and intake exclude Stripe — revisit as a separate project.
- **NG-6** No two-way GoHighLevel sync, pipelines, opportunities, workflows or photo copy, and no contact with any real GHL account — the hybrid mode asks for a one-way contact copy only — revisit after the copy has run in production for a month.
- **NG-7** No deleting, archiving, exporting or editing of submitted requests in the app; a privacy deletion request is handled by Baseleap by hand — keeps v1 small — revisit with the retention decision (OQ-10).
- **NG-8** No scheduling, calendar, job management, service-area check, maps or address lookup; the address is free text — outside the quote-request job — revisit after 30 days of use.
- **NG-9** No roles beyond the two equal users, and no assigning requests to a person — same rights by decision — revisit if the shop grows.
- **NG-10** No reporting beyond the current week's three numbers: no past weeks, charts, trends or CSV export — the brief asks for a weekly count only — revisit after a month of data.
- **NG-11** No marketing website, no embedding on a GHL page, and no analytics tools such as GA4 or Meta Pixel; events go to our own table only — not asked for — revisit if a marketing site is commissioned.
- **NG-12** No languages other than English, no quote PDFs, no reply templates — keeps v1 small — revisit on request.
- **NG-13** No AI features of any kind — not asked for — not planned.

## Functional Requirements
- **FR-1** The public Request page collects name (2–100 characters), phone (10 digits after removing spaces, dashes, brackets and an optional leading +1), email (valid format, up to 254 characters), address (5–200 characters), problem (10–2,000 characters) and urgency (exactly one of Emergency, Soon, Flexible, none preselected). All six are required, each invalid or empty field shows its own message next to it, and entered values are kept on any refusal. The page shows the line "Northside will use these details only to reply to your quote request." Serves: US-001
- **FR-2** Every stored request gets a unique reference number in the form `NQ-` plus 6 characters from A–Z and 2–9 excluding I, L and O (for example `NQ-7K3M9P`), that is not sequential. It is shown on the confirmation and in the inbox, and is never issued for a request that was not stored. Serves: US-001
- **FR-3** A request and all of its selected photos are stored together or not at all: the confirmation and reference number appear only after everything is stored; on any failure the homeowner sees the failure message, keeps everything she entered, and nothing partial is visible in the inbox; a double submit creates one request. Serves: US-001, US-002
- **FR-4** Submitting a request sends no email or SMS and calls no email or SMS service. Serves: US-001
- **FR-5** The Request page is usable within 3 seconds on a simulated 4G phone and passes an automated WCAG 2.1 AA check with 0 serious or critical violations. Serves: US-001
- **FR-6** A request takes 0 to 3 photos; each photo is JPEG, PNG or WebP (checked by content), at most 5 MB (5,242,880 bytes); a refused or failed photo shows its message next to that photo while the rest of the form is kept. Serves: US-002
- **FR-7** Photos are private: only the two signed-in users can see them, and a direct address for a photo returns nothing to anyone who is not signed in. A photo that cannot be loaded shows "Photo unavailable". Serves: US-002, US-005, US-012
- **FR-8** The public form is protected by a hidden honeypot field, a minimum 3 seconds between page load and submit, and a limit of 5 accepted submissions per 10 minutes per network address; refusals store nothing, issue no reference number, and do not reveal which check failed; if the rate-limit counter cannot be read the request is accepted; no third-party challenge is loaded. Serves: US-003
- **FR-9** Exactly two accounts (owner, office helper) with identical rights sign in with email and password; the inbox and all request and photo data require sign-in; there is no public sign-up; 5 failed attempts per email in 15 minutes pauses sign-in for 15 minutes; a session lasts at most 7 days. Serves: US-004
- **FR-10** The inbox lists requests newest first by submitted time, 50 at a time with a "Show more" control, each row showing reference, name, urgency, status and submitted time (Hamilton time); opening a request shows every submitted field, the phone as a tap-to-call link, the email as an email link, and the photos; it works at 375 px width without horizontal scrolling and shows the first 50 rows within 2 seconds. Serves: US-005
- **FR-11** The owner or helper can save one price (CAD, 0.01 to 99,999.99, at most 2 decimals, stored to the cent as typed) and one note (up to 1,000 characters) per request; either may be blank; a new price replaces the old one; saving over someone else's newer change is refused with a reload message and overwrites nothing. Serves: US-006
- **FR-12** The owner or helper can set a request's status to New, Quoted, Won or Lost, from any status to any other; each real change stores the previous status, the new status, the time and the user; selecting the current status changes nothing; status and price changes never reorder the list. Serves: US-007
- **FR-13** The inbox shows three numbers for the current week (Monday 00:00:00 to Sunday 23:59:59 America/Toronto): Requests this week (by submitted time), Won (requests currently Won whose last change to Won was this week) and Lost (same rule for Lost); the numbers update within 2 seconds of a status save; if the numbers cannot be loaded the list still loads. Serves: US-008
- **FR-14** The GoHighLevel copy never blocks, delays beyond 3 seconds, or loses a request: the request is stored and confirmed first, and any copy failure (GHL down, slow, token missing or rejected) leaves the request and its confirmation untouched. Serves: US-001, US-009
- **FR-15** After a request is stored, a contact with the request's name, phone, email, address and the tag `quote-request` is created in the GoHighLevel test sub-account within 2 minutes; the copy is one-way and creation-only, never creates a second contact for the same request, and never includes photos; each request shows its copy state (Copied, Waiting to retry, Failed); a waiting request is retried at least every 24 hours until it succeeds or has had 5 retries after the first attempt; copy records hold no token and no personal data. Serves: US-009, US-010
- **FR-16** The inbox can be filtered to All, New, Quoted, Won or Lost, keeping newest-first order. Serves: US-011
- **FR-17** A photo opens at full size from its thumbnail and keeps opening for as long as the user is signed in. Serves: US-012
- **FR-18** The owner can search by reference number, name or phone, case-insensitively, with partial name match. Serves: US-013
- **FR-19** A request with a failed copy has a Retry control that creates at most one contact. Serves: US-014
- **FR-20** A request shows who last changed it and when, or "Not updated yet". Serves: US-015
- **FR-21** The server records the events listed in `docs/metrics-spec.md` when the stated trigger happens, with ids only and no personal data in event properties. Serves: US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-008, US-009, US-010, US-011, US-012, US-013, US-014, US-015
- **FR-22** All personal data and photos are stored in Canada (Supabase ca-central-1), and the GoHighLevel copy goes only to the test sub-account. Serves: US-001, US-002, US-004, US-009

## Edge Cases
| Case | Expected behaviour | Covered by |
|---|---|---|
| Empty required fields | Message next to each empty field; nothing stored; values kept | AC-001.2 |
| Problem text 9, 10 and 2,001 characters | 9 and 2,001 refused with allowed length; 10 accepted | AC-001.3 |
| Malformed phone or email | Refused beside the field; other values kept | AC-001.4 |
| Special characters and script text in any field | Stored and shown as plain text; nothing runs | AC-001.5 |
| Double-tap on Send | One request, one reference number | AC-001.6 |
| Same phone submits twice | Two requests, two reference numbers; no merging | AC-001.7 |
| Database unreachable on submit | Failure message; entries kept; no reference number; nothing partial | AC-001.8 |
| GHL down, slow, or token missing | Request stored and confirmed; copy waits or fails, visibly | AC-001.9, AC-009.2, AC-009.3, AC-009.7 |
| GHL created the contact but the reply was lost | Retry yields exactly one contact | AC-009.4, AC-014.3 |
| Fourth photo, 5,242,881-byte photo, PDF, renamed text file | Refused with a message beside the photo; rest kept | AC-002.2, AC-002.3, AC-002.4 |
| No photos | Accepted; inbox shows "No photos" | AC-002.5, AC-005.6 |
| Photo upload fails mid-way | Error at that photo; no reference number; nothing partial; retry works | AC-002.6 |
| Photo address opened without signing in | Nothing returned | AC-002.8 |
| Bot fills the hidden field, submits in under 3 seconds, or sends the 6th request in 10 minutes | Refused, nothing stored, no reference number | AC-003.2, AC-003.3, AC-003.4 |
| Rate-limit counter unavailable | Request still accepted | AC-003.5 |
| Not signed in, wrong role, expired session | Redirect to sign-in; authorization error on data; nothing saved | AC-004.3, AC-004.7, AC-004.8 |
| Wrong password, unknown email, repeated failures | Same message for both; pause after 5 failures | AC-004.4, AC-004.5 |
| Anyone looks for sign-up | None offered; direct attempts refused | AC-004.6 |
| First use, no requests | "No quote requests yet"; count 0, 0, 0 | AC-005.4, AC-008.7 |
| 51 requests | 50 shown plus "Show more" | AC-005.5 |
| Storage down when viewing | "Photo unavailable"; rest shown | AC-005.7 |
| Price 0, 0.01, 99,999.99, 100,000.00, 450.555 | Refused, accepted, accepted, refused, refused | AC-006.3 |
| Note of 1,001 characters | Refused; text kept | AC-006.4 |
| Owner and helper edit the same request | Second saver told to reload; first change kept | AC-006.5 |
| Network drops while saving price, note or status | Message; typed values kept; stored request unchanged | AC-006.7, AC-007.6 |
| Same status selected again | No change, no new time stored | AC-007.4 |
| Won moved to Lost | Counts move from Won to Lost | AC-007.3, AC-008.5 |
| Request at Sunday 23:59:59 versus Monday 00:00:00 | Falls into the week by Hamilton time | AC-008.3 |
| Daylight saving change (Sunday 2026-11-01) | Week still Monday to Sunday local time | AC-008.6 |
| Submitted last week, won this week | Counts in Won, not in Requests this week | AC-008.4 |
| Count cannot load | "Count unavailable"; list still loads | AC-008.8 |
| Filter with no matches | "No lost requests" style message | AC-011.2 |

## AI Behaviour and Evaluation
Not applicable — no feature output comes from a model.

## Technical Considerations
- **System of record:** our app (Supabase, ca-central-1) owns every quote request, photo, price, note and status. GoHighLevel never owns or changes a request.
- **Platform roles:** our app = public form, owner inbox and source of truth; GoHighLevel test sub-account = one-way contact copy tagged `quote-request`, creation only; Vercel = hosting for the app and the production health URL; Supabase ca-central-1 = database, sign-in and private photo storage. No Stripe, no n8n, Zapier or Make, no email or SMS provider, no CAPTCHA vendor.
- **Data:** nothing exists to migrate (research record is empty). New data: quote requests, photos, price, note, status changes, copy state, events. Volume is a design assumption, not evidence: up to 200 requests a month, up to 600 photos a month, 2 users. Personal data collected from homeowners: name, phone, email, home address, and photos that may show the inside of a home. Retention for a real client is undecided (OQ-10); in the rehearsal all data is test data.
- **Roles & permissions:** anonymous visitors can only submit a request (and see their own confirmation); the owner and the office helper have identical rights to read and change everything; no other roles; no customer accounts. Row-level security applies to every table and the photo bucket is private (house stack, intake answer 4).
- **Integrations:** GoHighLevel via one private-integration token for the test sub-account (variable name set by devops and the integration engineer; Matthew sets the value; no value appears in any file or log). No other third party. Technical flags for the architect: the free hosting plan may limit how often a background retry can run (US-010 asks for at least every 24 hours); the GHL copy needs a way to avoid duplicate contacts when a timed-out attempt is retried (AC-009.4); whether the reference number and problem text can be attached to the GHL contact without extra GHL setup is open (OQ-11).
- **Money:** no payment is taken, but price is a money value: Canadian dollars, stored to the cent with no rounding, no tax added.
- **Personal data and residency:** all data and photos stay in ca-central-1. The GHL copy puts name, phone, email and address in GoHighLevel; GHL's own hosting location is not verified and is only acceptable here because the sub-account is a test account (OQ-12 for a real client).
- **Constraints:** mobile-first public page; Request page usable in 3 seconds on a simulated 4G phone; WCAG 2.1 AA check on the public page; inbox first 50 rows in 2 seconds; all times shown in America/Toronto; English only; $0 spend (anything paid opens a spend approval).

## Agent Execution Contract
- **Authoritative sources (highest first):** this PRD → `docs/decisions/` → `docs/openapi.yaml` + migrations → `docs/design-specs.md`
- **Do not touch:** the kit files (`scripts/`, `.claude/`); the Baseleap Console database except ledger writes; any real GoHighLevel account (only the test sub-account); production data; any real customer's email or phone. Never send a real email or SMS.
- **Verification map:** FR-1 → AC-001.1, AC-001.2, AC-001.3, AC-001.4, AC-001.5 · FR-2 → AC-001.1, AC-001.7 · FR-3 → AC-001.6, AC-001.8, AC-002.6 · FR-4 → AC-001.12 · FR-5 → AC-001.10, AC-001.11 · FR-6 → AC-002.1, AC-002.2, AC-002.3, AC-002.4, AC-002.5, AC-002.7 · FR-7 → AC-002.8, AC-002.9, AC-005.7, AC-012.3 · FR-8 → AC-003.1, AC-003.2, AC-003.3, AC-003.4, AC-003.5, AC-003.6 · FR-9 → AC-004.1, AC-004.2, AC-004.3, AC-004.4, AC-004.5, AC-004.6, AC-004.7, AC-004.8, AC-004.9 · FR-10 → AC-005.1, AC-005.2, AC-005.3, AC-005.4, AC-005.5, AC-005.6, AC-005.8, AC-005.9 · FR-11 → AC-006.1, AC-006.2, AC-006.3, AC-006.4, AC-006.5, AC-006.6, AC-006.7 · FR-12 → AC-007.1, AC-007.2, AC-007.3, AC-007.4, AC-007.5, AC-007.6, AC-007.7 · FR-13 → AC-008.1, AC-008.2, AC-008.3, AC-008.4, AC-008.5, AC-008.6, AC-008.7, AC-008.8 · FR-14 → AC-001.9, AC-009.2, AC-009.3, AC-009.7 · FR-15 → AC-009.1, AC-009.4, AC-009.5, AC-009.6, AC-009.8, AC-010.1, AC-010.2, AC-010.3, AC-010.4, AC-010.5 · FR-16 → AC-011.1, AC-011.2, AC-011.3, AC-011.4 · FR-17 → AC-012.1, AC-012.2, AC-012.3 · FR-18 → AC-013.1, AC-013.2, AC-013.3 · FR-19 → AC-014.1, AC-014.2, AC-014.3 · FR-20 → AC-015.1, AC-015.2 · FR-21 → the QA tracking checklist in `docs/metrics-spec.md`, exercised through the ACs that trigger each event · FR-22 → AC-001.13, AC-002.9, AC-009.8 (QA writes one test per AC; region criteria are checked by inspection)
- **Rehearsal done check:** one Playwright journey chains AC-001.1 (with 3 photos from AC-002.1) → AC-005.2 → AC-006.1 → AC-007.1 → AC-008.2 on the staging preview.
- **Stop and escalate (raise a contract question, don't decide):** any new personal-data field; any notification channel (email, SMS, push); any paid or new third-party service, including a CAPTCHA vendor; any change to how the weekly count or week boundary is defined; any change to how price is stored or rounded; any step that would make the GHL copy block or delay a request; any request to use a real GHL account; storing the GHL token anywhere except the environment; making photos reachable without sign-in; adding a table or screen for something listed under a Non-goal.

## Dependencies & Risks
| Item | Type | Owner | Mitigation |
|---|---|---|---|
| GHL private-integration token for the test sub-account (variable name only; Matthew sets the value) | dependency | Matthew | The Should-level GHL stories are the first to cut; requests are never blocked by a missing token (AC-009.3) |
| Two sign-in accounts (owner, office helper) and E2E test credentials, created without sending email | dependency | Matthew and devops | Credential values stay in the environment; QA uses names only |
| Supabase project in ca-central-1 (sandbox org or new, decided at account_setup) | dependency | Matthew | Region is checked by AC-001.13 and AC-002.9 |
| Staging preview protection on the Vercel team (plan unverified) may block the public form or the E2E | risk | devops | Devops confirms before QA runs; if protected, QA uses the bypass the platform gives |
| Photo upload from phones is the most likely place for the E2E and real use to break (large files, slow networks, HEIC) | risk | architect, QA | Limits fixed in FR-6; QA covers AC-002.3, AC-002.6 and AC-002.7 |
| Spam checks with no vendor may block real users on shared mobile networks or let bots through | risk | Matthew | Thresholds are proposals (OQ-1); every block is recorded so they can be tuned |
| Free hosting may not allow a background retry more often than daily | risk | architect | US-010 only needs a retry every 24 hours |
| Run size: 15 stories in a day or two | risk | orchestrator | Cut order: US-013, US-014, US-015, then US-012, US-011, then US-010, US-009 |

## Open Questions
Defaults below are what this PRD is written on; each is pending confirmation from Matthew unless the owner says otherwise.

| # | Question | Options (recommended first) | Owner |
|---|---|---|---|
| OQ-1 | How to stop spam with no puzzle | A honeypot + 3-second minimum + 5 per 10 minutes per address (rec; used) / B add Cloudflare Turnstile (needs an outside account, spend gate) / C a simple maths question | Matthew |
| OQ-2 | Photo rules | A optional, up to 3, 5 MB each, JPEG, PNG or WebP (rec; used) / B at least 1 required / C also accept HEIC from iPhones | Matthew |
| OQ-3 | Urgency options | A three: Emergency, Soon, Flexible (rec; used) / B two: Emergency, Not urgent / C four, adding "This week" | Matthew |
| OQ-4 | Reference number format | A `NQ-` plus 6 random characters, not sequential (rec; used) / B sequential `NQ-0001` / C date-based such as `NQ-20261119-07` | Matthew |
| OQ-5 | Weekly count rules | A Monday to Sunday Hamilton time; Won and Lost counted by the date of the status change (rec; used) / B Won counted by request date / C rolling last 7 days | Matthew |
| OQ-6 | How the two accounts are created | A created by Baseleap before staging, no in-app screen, no password-reset email (rec; used) / B invite emails (needs an email sender, conflicts with $0 and no email) | Matthew |
| OQ-7 | Notifications in v1 | A none at all; owner checks the inbox (rec; used) / B an on-screen "new since you last looked" badge only / C emails to a test inbox (needs a provider) | Matthew |
| OQ-8 | GHL copy when GHL is down | A request saved first; automatic retry at least every 24 hours, up to 5 retries, then shown as failed (rec; used) / B retry once, then manual button only / C no retry, log only. Architect to confirm what the free hosting plan can run and whether a faster retry is possible | Matthew; architect for feasibility |
| OQ-9 | Primary metric target | A 24 hours or less median to first quote, confirmed after a 14-day baseline (rec; used) / B 4 business hours / C no target until the baseline exists | Matthew |
| OQ-10 | For a real client: how long to keep requests and photos, and the exact consent wording on the form | A keep 24 months then Baseleap purges by hand; wording as written in US-001 (rec; used for the rehearsal) / B keep until the owner asks for deletion / C 12 months | Matthew |
| OQ-11 | Can the reference number and problem text be attached to the GHL contact without extra GHL setup (custom fields)? | A yes, include them (rec if free) / B no, contact fields only (used until the architect answers) | architect |
| OQ-12 | For a real client: is it acceptable that the GHL copy of personal data may be stored outside Canada? | A confirm GHL's hosting location before any real client goes live (rec) / B accept without checking | Matthew |

## Appendix
- Sources: `.baseleap/brief.md`; `.baseleap/inputs/intake.md` (Matthew's seven intake answers and the "For the PM" list); `.baseleap/inputs/client-research.md` (research record, empty apart from client id, industry Plumbing, location Hamilton ON, status prospect). No web research was done: no decision depended on it, and no competitor or market figures are claimed.
- Locked intake decisions copied, not re-decided: build_mode hybrid; done definition; two users with equal rights and no customer accounts; ca-central-1; no Stripe, n8n, Zapier or Make; $0 spend, no email, SMS or CAPTCHA vendor; no real emails or SMS.
- Where this PRD departs from the brief: none. The brief calls the GHL copy "nice to have" and the intake locks the hybrid mode; this PRD builds it as Should and flags it as the first thing to cut.
- Revision history: v1 2026-11-19 — initial draft
