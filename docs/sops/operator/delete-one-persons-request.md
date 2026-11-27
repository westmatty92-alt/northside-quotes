# Delete one person's request and its data

**Purpose:** Remove one quote request, its photo files and its GoHighLevel contact, when a person asks for their data to be deleted, or when a request is past its retention time.
**Who:** Baseleap (Matthew or a dev) · **When:** A homeowner asks for deletion (privacy request), and for each request the purge procedure lists · **Kind:** 2 operator
**Evidence:** see [evidence](../evidence.md#delete-one-persons-request)

**DRAFT.** This has never been run. The app cannot delete a request, by design (NG-7). Only Baseleap deletes, by hand, and it cannot be undone. The Free Supabase plan has no backup to restore from. Each step marked unverified waits for a dry run on one staging test request.

## Before you start
- You have the request's reference number (it starts with NQ-). The homeowner saw it on the confirmation page. If they lost it, ask Northside's owner to find it with **Search by reference, name or phone** on the **Requests** tab.
- Ask whether the person sent more than one request. Do this procedure once for each reference.
- You can open the Supabase dashboard for the right project (**SQL Editor** and **Storage**) and the GoHighLevel test sub-account.
- Do not copy the person's name, email or phone anywhere. Do not put them in a ticket, a chat or a file.
- Photos live in the private bucket `quote-photos`, in a folder named with the request's id.

## Steps
1. ⚠ unverified: Open the Supabase dashboard, then the project, then **SQL Editor**. Run this with the real reference. It must return exactly one row.
   ```sql
   select id, reference, state, marketing_consent, ghl_contact_id, email
   from public.quote_requests
   where reference = 'NQ-XXXXXX';
   ```
   Write down the `id` and `ghl_contact_id` for the next steps. Look at the email only to find the contact in GoHighLevel. The query was not run in a drill.
2. If `ghl_contact_id` is not empty, run this to see which other requests share that contact. They belong to the same homeowner. Do not delete the contact until you know whether they also asked for those to be deleted.
   ```sql
   select reference, submitted_at from public.quote_requests
   where ghl_contact_id = '<the ghl_contact_id from step 1>';
   ```
3. ⚠ unverified: Open **Storage**, then the bucket `quote-photos`. Open the folder named with the request's `id`. Select every file in it and delete them. Delete the files before the request, so nothing is left behind. The dashboard or the Storage API is the only way, because the database refuses direct deletes from storage tables. The button names are not verified.
4. ⚠ unverified: Back in **SQL Editor**, run this with the `id` from step 1. It must say one row was deleted. The design says it also removes the photo records, the status history, the sync jobs and the events of that request.
   ```sql
   delete from public.quote_requests where id = '<the id from step 1>';
   ```
5. ⚠ unverified: If the request had a `ghl_contact_id`, and you know no other kept request uses it, open the GoHighLevel test sub-account, find the contact and delete it by hand. The app never deletes a GoHighLevel contact. If the request had no offers consent, there is no contact. The GoHighLevel menu names are not verified, and live GoHighLevel has never been called.
6. Run the query from step 1 again. It must return no rows. Open the folder in **Storage** again. It must be gone or empty.
7. Record in the Baseleap ticket: the reference, the date and "row, photos and contact deleted". Write no name, email or phone.
8. Tell the person, or the owner, that it is done.

## What you should see
- Step 4: one row deleted.
- Step 6: no rows, no photo files, no contact in GoHighLevel.
- In the app, the request is gone from the **Requests** and **Pipeline** tabs after a reload. The weekly count may change.

## If it goes wrong
- **Step 1 returns no row:** The reference is wrong, or you are in the wrong project. Check the project name at the top of the dashboard.
- **The person says they sent a request but never got a reference number:** The send did not finish. Unfinished requests have no reference and are removed automatically after 24 hours. Staff never see them.
- **Step 4 fails:** Do not retry blindly. Copy the error text, with no personal data, and tell Matthew.
- **You deleted the row before the photos:** The folder is still in **Storage**. The `id` is in your notes from step 1. Delete the folder now.
- **Other requests share the contact:** Keep the contact until Matthew confirms those requests stay or go.
- **The wrong request was deleted:** It cannot be restored. Tell Matthew at once.

## Changelog
- 2026-11-25 — First version, a draft from `docs/SECURITY_MODEL.md` and the migrations. No staging dry run yet. The plan said this might merge into the purge procedure. It stays separate: the purge procedure links here for each request — step DOC1
