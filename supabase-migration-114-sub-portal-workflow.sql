-- Run in Supabase SQL Editor after migration 113. Safe to re-run.
--
-- Sub Portal workflow round: schedule visibility, two-way messaging,
-- field progress tracking + photos, clearer payment status, and
-- self-serve W-9/COI uploads. Follows the existing conventions:
-- is_sub_portal_member()/is_admin() for RLS, security definer RPCs for
-- every sub-side write (no broad UPDATE/INSERT grants), and the private
-- subcontractor-docs bucket with a foldername-matched policy per feature.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Schedule visibility — expose scheduled_start_date (already on jobs,
--    migration 032) through the same safe view subs already read from.
-- ═══════════════════════════════════════════════════════════════════════
create or replace view sub_visible_jobs as
select distinct j.id, j.job_number, j.project_address, j.job_type, j.stage,
  j.expected_close_date, j.scheduled_start_date
from jobs j
where exists (
  select 1 from work_orders wo
  where wo.job_id = j.id and is_sub_portal_member(wo.company_id)
);
grant select on sub_visible_jobs to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Messaging — one flat, company-scoped thread (optionally tagged to a
--    job for context), same shape as job_questions on the customer side:
--    sender + message + read_at, no separate "response" field since
--    either side can send a standalone message, not just reply.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists sub_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  sender text not null check (sender in ('sub', 'staff')),
  sender_email text,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table sub_messages enable row level security;

drop policy if exists "Admin can do everything on sub_messages" on sub_messages;
create policy "Admin can do everything on sub_messages" on sub_messages
  for all using (is_admin()) with check (is_admin());

drop policy if exists "Sub can view own company messages" on sub_messages;
create policy "Sub can view own company messages" on sub_messages for select using (
  is_sub_portal_member(company_id)
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sub_messages'
  ) then
    alter publication supabase_realtime add table sub_messages;
  end if;
end $$;

-- A sub (admin or crew — asking a question isn't a "money thing", unlike
-- accept/decline) sends through this rather than a direct insert grant,
-- both to check company membership and to raise a normal office
-- notification (same table/shape the customer-portal flow already uses)
-- in the same transaction.
create or replace function send_sub_message(target_company_id uuid, target_job_id uuid, message_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  company_name_text text;
begin
  if not is_sub_portal_member(target_company_id) then
    raise exception 'Not authorized';
  end if;
  if message_in is null or trim(message_in) = '' then
    raise exception 'Message cannot be empty';
  end if;
  if target_job_id is not null and not exists (select 1 from sub_visible_jobs where id = target_job_id) then
    raise exception 'That job is not visible to this company';
  end if;

  insert into sub_messages (company_id, job_id, sender, sender_email, message)
  values (target_company_id, target_job_id, 'sub', caller_email, trim(message_in));

  select company_name into company_name_text from companies where id = target_company_id;
  insert into notifications (message, job_id)
  values (coalesce(company_name_text, 'A subcontractor') || ': ' || left(trim(message_in), 140), target_job_id);
end;
$$;
grant execute on function send_sub_message(uuid, uuid, text) to authenticated;

-- Staff already has full read/write on sub_messages via the admin policy
-- above, so a reply is a plain insert from the office UI — no RPC
-- needed there. This one just clears the unread badge for a company's
-- thread once staff has looked at it.
create or replace function mark_sub_messages_read(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;
  update sub_messages set read_at = now()
  where company_id = target_company_id and sender = 'sub' and read_at is null;
end;
$$;
grant execute on function mark_sub_messages_read(uuid) to authenticated;

-- Mirror image for the sub side — clears the unread badge for staff
-- messages once the sub has opened the Messages page.
create or replace function mark_staff_messages_read(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_sub_portal_member(target_company_id) then
    raise exception 'Not authorized';
  end if;
  update sub_messages set read_at = now()
  where company_id = target_company_id and sender = 'staff' and read_at is null;
end;
$$;
grant execute on function mark_staff_messages_read(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Field progress — distinct from the business-lifecycle `status`
--    column (draft/issued/accepted/.../paid). This tracks whether the
--    crew has actually started/finished the physical work, settable by
--    either an admin or crew login once the work order is accepted.
-- ═══════════════════════════════════════════════════════════════════════
alter table work_orders add column if not exists field_progress text not null default 'not_started'
  check (field_progress in ('not_started', 'in_progress', 'completed'));

create or replace function set_work_order_progress(target_work_order_id uuid, progress_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  wo_company_id uuid;
  wo_status text;
begin
  if progress_in not in ('not_started', 'in_progress', 'completed') then
    raise exception 'Invalid progress value';
  end if;
  select company_id, status into wo_company_id, wo_status from work_orders where id = target_work_order_id;
  if wo_company_id is null or not is_sub_portal_member(wo_company_id) then
    raise exception 'Not authorized';
  end if;
  if wo_status not in ('accepted', 'completed') then
    raise exception 'Field progress can only be tracked once a work order is accepted';
  end if;
  update work_orders set field_progress = progress_in where id = target_work_order_id;
end;
$$;
grant execute on function set_work_order_progress(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Work order progress photos — separate from job_photos (which is
--    staff/customer-facing and folder-organized); this is a flat log of
--    whatever a sub snaps and attaches to a specific work order.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists work_order_photos (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  storage_path text not null,
  caption text,
  uploaded_by_email text,
  created_at timestamptz not null default now()
);

alter table work_order_photos enable row level security;

drop policy if exists "Admin can do everything on work_order_photos" on work_order_photos;
create policy "Admin can do everything on work_order_photos" on work_order_photos
  for all using (is_admin()) with check (is_admin());

drop policy if exists "Sub can view own work order photos" on work_order_photos;
create policy "Sub can view own work order photos" on work_order_photos for select using (
  exists (select 1 from work_orders wo where wo.id = work_order_photos.work_order_id and is_sub_portal_member(wo.company_id))
);

create or replace function add_work_order_photo(target_work_order_id uuid, storage_path_in text, caption_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  wo_company_id uuid;
begin
  select company_id into wo_company_id from work_orders where id = target_work_order_id;
  if wo_company_id is null or not is_sub_portal_member(wo_company_id) then
    raise exception 'Not authorized';
  end if;
  insert into work_order_photos (work_order_id, storage_path, caption, uploaded_by_email)
  values (target_work_order_id, storage_path_in, caption_in, auth.jwt()->>'email');
end;
$$;
grant execute on function add_work_order_photo(uuid, text, text) to authenticated;

create or replace function remove_work_order_photo(target_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  photo_wo_id uuid;
  wo_company_id uuid;
begin
  select work_order_id into photo_wo_id from work_order_photos where id = target_photo_id;
  if photo_wo_id is null then
    raise exception 'Photo not found';
  end if;
  select company_id into wo_company_id from work_orders where id = photo_wo_id;
  if not is_sub_portal_member(wo_company_id) then
    raise exception 'Not authorized';
  end if;
  delete from work_order_photos where id = target_photo_id;
end;
$$;
grant execute on function remove_work_order_photo(uuid) to authenticated;

drop policy if exists "Subcontractor can upload own work order photo" on storage.objects;
create policy "Subcontractor can upload own work order photo" on storage.objects for insert
  with check (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'progress-photos'
    and exists (
      select 1 from work_orders wo
      where wo.id::text = (storage.foldername(name))[2] and is_sub_portal_member(wo.company_id)
    )
  );

drop policy if exists "Staff and sub can view work order photo files" on storage.objects;
create policy "Staff and sub can view work order photo files" on storage.objects for select
  using (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'progress-photos'
    and (
      is_admin()
      or exists (
        select 1 from work_orders wo
        where wo.id::text = (storage.foldername(name))[2] and is_sub_portal_member(wo.company_id)
      )
    )
  );

drop policy if exists "Subcontractor can delete own work order photo file" on storage.objects;
create policy "Subcontractor can delete own work order photo file" on storage.objects for delete
  using (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'progress-photos'
    and exists (
      select 1 from work_orders wo
      where wo.id::text = (storage.foldername(name))[2] and is_sub_portal_member(wo.company_id)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Payment clarity — paid_at is set automatically the moment a work
--    order's status flips to 'paid', and cleared if it's ever moved back
--    off 'paid' (a correction) — no office UI change needed for this to
--    start working.
-- ═══════════════════════════════════════════════════════════════════════
alter table work_orders add column if not exists paid_at timestamptz;

create or replace function set_work_order_paid_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    new.paid_at := now();
  elsif new.status <> 'paid' then
    new.paid_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_work_order_paid_at on work_orders;
create trigger trg_work_order_paid_at
  before update on work_orders
  for each row execute function set_work_order_paid_at();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Self-serve compliance docs — W-9/COI already have office-side
--    upload (migration 029: companies.w9_storage_path/coi_storage_path/
--    coi_expires_at) but only the office could set them. This lets a
--    sub admin keep their own on file current without waiting on a call.
--    New 'compliance/{company_id}/...' path, distinct from the office's
--    existing bare '{company_id}/...' uploads — both are read the same
--    way (whatever path is stored on companies), so old files keep
--    working untouched.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function submit_sub_compliance_doc(target_company_id uuid, kind text, storage_path_in text, expires_at_in date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  is_authorized boolean;
begin
  if kind not in ('w9', 'coi') then
    raise exception 'Invalid document type';
  end if;
  select exists (
    select 1 from sub_portal_users where company_id = target_company_id and email = auth.jwt()->>'email' and role = 'admin'
  ) into is_authorized;
  if not is_authorized then
    raise exception 'Not authorized';
  end if;

  if kind = 'w9' then
    update companies set w9_storage_path = storage_path_in where id = target_company_id;
  else
    update companies set coi_storage_path = storage_path_in, coi_expires_at = expires_at_in where id = target_company_id;
  end if;
end;
$$;
grant execute on function submit_sub_compliance_doc(uuid, text, text, date) to authenticated;

drop policy if exists "Subcontractor can upload own compliance doc" on storage.objects;
create policy "Subcontractor can upload own compliance doc" on storage.objects for insert
  with check (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'compliance'
    and is_sub_portal_member(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "Staff and sub can view compliance doc file" on storage.objects;
create policy "Staff and sub can view compliance doc file" on storage.objects for select
  using (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'compliance'
    and (
      is_admin()
      or is_sub_portal_member(((storage.foldername(name))[2])::uuid)
    )
  );
