# Brief — Northside Plumbing (TEST): quote requests

**This is the full-team rehearsal.** Northside Plumbing is a fake client; nothing reaches real customers.
Every phase runs for real (gates, ledger, staging, release), on throwaway accounts.

## The problem
Northside is a 3-person plumbing shop in Hamilton. Quote requests arrive by phone, text and Facebook and get lost.
The owner wants one web page where a homeowner asks for a quote, and one inbox where the owner sees every request,
replies, and marks it won or lost.

## What they asked for
- A public **Request a quote** page (mobile first): name, phone, email, address, the problem, how urgent, up to
  3 photos. The homeowner gets an on-screen confirmation with a reference number.
- An **owner inbox** (sign-in required): new / quoted / won / lost, newest first, with the photos.
  The owner adds a price and a note and changes the status.
- A **weekly count** on the inbox: requests this week, won, lost.
- Spam protection on the public form (no CAPTCHA puzzle if it can be avoided).
- Nice to have: each new request also lands in the owner's **GoHighLevel** as a contact with a `quote-request` tag
  (a GHL test sub-account; this is what brings in the integration engineer).

## Constraints
- Two users: the owner and one office helper (same rights). No customer accounts.
- Canadian data residency (Supabase ca-central-1). No Stripe, no n8n/Zapier/Make.
- No real emails or SMS in the rehearsal: anything that would notify someone goes to a test sink or is out of scope.
- Small: a day or two of agent work. The PM should cut anything that doesn't fit.

## Accounts
Throwaway: GitHub `westmatty92-alt`, Vercel team `baseleap`, Supabase. Matthew decides at the account_setup gate
whether to reuse the sandbox Supabase org or create new projects.
