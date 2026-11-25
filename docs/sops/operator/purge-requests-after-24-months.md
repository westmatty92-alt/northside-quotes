# Purge requests older than 24 months

**Purpose:** Delete quote requests that are past the 24-month retention time, with their photos and GoHighLevel contacts.
**Who:** Baseleap (Matthew or a dev) · **When:** The retention rule says 24 months and does not say how often to check. Matthew sets the rhythm · **Kind:** 2 operator
**Evidence:** see [evidence](../evidence.md#purge-requests-after-24-months)

**DRAFT.** This has never been run, and nothing deletes old requests by itself. The rule (decision OQ-10, option A) is "keep 24 months, then Baseleap purges by hand". In the rehearsal all data is test data, and none is 24 months old yet.

## Before you start
- You can open the Supabase dashboard for the right project and the GoHighLevel test sub-account.
- Deleting cannot be undone. The Free Supabase plan has no backup.
- The automatic housekeeping job does not do this. It only removes unfinished requests older than 24 hours, and the anonymous counter rows older than 24 hours.
- Each deletion follows [delete-one-persons-request.md](delete-one-persons-request.md). Read it first.

## Steps
1. ⚠ unverified: Open the Supabase dashboard, then the project, then **SQL Editor**. Run this to list the requests that are past 24 months. It counts from the time the request was submitted. The rule does not say which date the 24 months start from, so this is an assumption for Matthew to confirm. The query was not run in a drill.
   ```sql
   select reference, submitted_at
   from public.quote_requests
   where state = 'submitted'
     and submitted_at < now() - interval '24 months'
   order by submitted_at;
   ```
2. If the list is empty, stop. Write the date in the Baseleap ticket.
3. Send the list of references to Matthew. Wait for his approval of that exact list. The deletion cannot be undone.
4. For each approved reference, follow [delete-one-persons-request.md](delete-one-persons-request.md), steps 1 to 7. Do them one reference at a time.
5. Run the query from step 1 again. It must return no rows, except references Matthew chose to keep.
6. Record in the Baseleap ticket: the date, how many were deleted, and the references. Write no names, emails or phones.

## What you should see
- Step 5: no rows left from the approved list.
- The deleted requests are gone from the app after a reload.

## If it goes wrong
- **The list has a request Northside still needs:** Do not delete it. Tell Matthew. The retention time is a decision for the client.
- **A deletion step fails halfway:** Stop the whole purge. Follow the "If it goes wrong" section of the deletion procedure for that reference, then tell Matthew before you continue.
- **There are hundreds of requests:** Do not script it on your own. Ask Matthew. This procedure is built for a few requests by hand.
- **A GoHighLevel contact is shared with a request you keep:** Keep the contact. The deletion procedure explains why.

## Changelog
- 2026-11-25 — First version, a draft. The rhythm of the purge and the start of the 24 months are not decided. No staging dry run yet — step DOC1
