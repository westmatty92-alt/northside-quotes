-- 20261120000700_storage.sql
-- Purpose: the private quote-photos bucket (5 MB, JPEG/PNG/WebP) and its storage.objects
--          policies: an anonymous homeowner may add up to 3 photos, only into the folder of
--          their own pending request and only for a planned position; only staff can read
--          (through short-lived signed URLs), and only photos stored with a submitted request.
--          Nobody but the server updates or deletes.
--          FR-3, FR-6, FR-7, FR-22 · US-002, US-005, US-012.
-- Decision: docs/decisions/0002-public-submission-and-photo-upload.md
-- The bucket is created here, never by hand (docs/ops/account-setup.md, Part 2 step 3).

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quote-photos', 'quote-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Object names are {request_id}/photo-{1..3}. Allowed only when the request is pending, was
-- created in the last 60 minutes, planned at least that many photos, and its folder holds fewer
-- than 3 objects. The fixed names plus the unique (bucket_id, name) index also cap a folder at 3.
-- Security definer: anonymous callers cannot read quote_requests or storage.objects themselves.
-- It reads quote_requests (RLS forced) as its owner postgres, which has BYPASSRLS on Supabase
-- (asserted in supabase/tests/rls/all_tables.sql); without it, uploads are refused (fails closed).
create or replace function app_private.photo_upload_allowed(p_name text) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_position   integer;
  v_req        public.quote_requests%rowtype;
  v_existing   integer;
begin
  if p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/photo-[1-3]$' then
    return false;
  end if;

  v_request_id := split_part(p_name, '/', 1)::uuid;
  v_position := right(p_name, 1)::integer;

  select * into v_req from public.quote_requests where id = v_request_id;
  if not found
     or v_req.state <> 'pending'
     or v_req.created_at < now() - interval '60 minutes'
     or v_position > v_req.photo_count then
    return false;
  end if;

  select count(*) into v_existing
    from storage.objects o
   where o.bucket_id = 'quote-photos'
     and o.name like v_request_id::text || '/%';

  return v_existing < 3;
end
$$;
revoke all on function app_private.photo_upload_allowed(text) from public;
grant execute on function app_private.photo_upload_allowed(text) to anon, authenticated, service_role;

-- Upload: the public form uploads with the publishable key (anon). Authenticated is included so a
-- signed-in staff member testing the public form is held to the same rule, not refused.
drop policy if exists nq_quote_photos_insert_own_pending on storage.objects;
create policy nq_quote_photos_insert_own_pending on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'quote-photos' and app_private.photo_upload_allowed(name));

-- Read (download and createSignedUrl): staff with a fresh session only (FR-7), and only objects
-- recorded in public.quote_photos. Those rows exist only for submitted requests (written by
-- complete_quote_request), and quote_photos' own RLS also requires a fresh staff session and a
-- submitted parent. So pending, never-submitted or refused uploads are invisible to staff
-- (invariant 5, S0 SEC-8). Served by the unique index on quote_photos.storage_path.
drop policy if exists nq_quote_photos_select_staff on storage.objects;
create policy nq_quote_photos_select_staff on storage.objects
  for select to authenticated
  using (
    bucket_id = 'quote-photos'
    and (select app_private.is_staff())
    and exists (select 1 from public.quote_photos p where p.storage_path = objects.name)
  );

-- No update and no delete policy: no client can overwrite or remove a photo. The server removes
-- abandoned pending uploads and by-hand privacy deletions through the Storage API (service role).

commit;

-- rollback
-- begin;
-- drop policy if exists nq_quote_photos_select_staff on storage.objects;
-- drop policy if exists nq_quote_photos_insert_own_pending on storage.objects;
-- drop function if exists app_private.photo_upload_allowed(text);
-- commit;
-- Then empty and delete the quote-photos bucket through the Storage API or dashboard
-- (DESTRUCTIVE: every photo). Supabase refuses direct SQL deletes from storage tables.
