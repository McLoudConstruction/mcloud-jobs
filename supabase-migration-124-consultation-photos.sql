-- Run in Supabase SQL Editor after migration 123. Safe to re-run.
--
-- Supports the "Upload Photos" field on the marketing site's Consultation
-- form (mcloud-website's ConsultationForm.js). Photos are attached to a
-- lead before any job exists, so they can't live in job_photos (which is
-- keyed to jobs.id) — this is its own table keyed to opportunities.id.
-- The consultation-request API route uploads these with the service role
-- (same as every other public/unauthenticated write in this app), so
-- RLS/storage policies here just need to let staff view them back.

create table if not exists opportunity_photos (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table opportunity_photos enable row level security;

drop policy if exists "Admin can do everything on opportunity_photos" on opportunity_photos;
create policy "Admin can do everything on opportunity_photos"
  on opportunity_photos for all using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'opportunity_photos'
  ) then
    alter publication supabase_realtime add table opportunity_photos;
  end if;
end $$;

-- ─── Private storage bucket for the actual photo files ──────────────────
insert into storage.buckets (id, name, public)
values ('consultation-photos', 'consultation-photos', false)
on conflict (id) do nothing;

-- Files are stored as {opportunity_id}/{filename}. Only staff ever view
-- these (through signed URLs from the sales page) — there's no portal
-- account tied to a lead yet, so unlike job_photos there's no customer
-- read policy here.

drop policy if exists "Admin can do everything with consultation photo files" on storage.objects;
create policy "Admin can do everything with consultation photo files"
  on storage.objects for all
  using (bucket_id = 'consultation-photos' and is_admin())
  with check (bucket_id = 'consultation-photos' and is_admin());

-- ─── Schedule: "Mixed" work location + draft schedules ──────────────────
-- work_location was locked to 'indoor'/'outdoor' only — add 'mixed' for
-- jobs with real interior+exterior overlap (framing with some indoor
-- finish bundled in, etc.). Both jobs.work_location and
-- job_phases.work_location carry this same check constraint.
alter table jobs drop constraint if exists jobs_work_location_check;
alter table jobs add constraint jobs_work_location_check check (work_location in ('indoor', 'outdoor', 'mixed'));

alter table job_phases drop constraint if exists job_phases_work_location_check;
alter table job_phases add constraint job_phases_work_location_check check (work_location in ('indoor', 'outdoor', 'mixed'));

-- Generate Schedule used to hold the freshly-generated draft only in the
-- staff browser's local state — nothing was written to job_phases until
-- Confirm was clicked, so navigating away (or the tab reloading) before
-- that lost the whole draft. Now a draft is its own real rows, tagged
-- status = 'draft', persisted the moment Generate Schedule runs; every
-- consumer that reads job_phases for the *live* schedule (customer
-- portal, sub portal, weather checks, dashboards) must keep filtering to
-- status = 'published' so a draft never leaks out as if it were live.
alter table job_phases add column if not exists status text not null default 'published';
alter table job_phases drop constraint if exists job_phases_status_check;
alter table job_phases add constraint job_phases_status_check check (status in ('draft', 'published'));

-- Preserves the "trade no longer in this job's breakdown" distinction
-- (vs. "duration kept from your edit — review") across a draft's
-- generate → persist → reload round trip, now that a draft's needs_review
-- reasoning has to survive being written to and read back from the table
-- instead of just staying in memory.
alter table job_phases add column if not exists orphaned boolean not null default false;

-- ─── Photos: "Share with customer" for every job photo, not just  ───────
-- ─── work-order progress photos, and auto-foldered sub uploads    ───────
--
-- job_photos previously had an unconditional customer SELECT policy (any
-- photo on the job, always visible) — there was just no is_internal
-- concept for it at all, unlike work_order_photos. That's flipped here to
-- match: hidden by default, opt-in shared, same as work_order_photos.
--
-- source_bucket / source_work_order_photo_id let a subcontractor's
-- progress photo (uploaded to the subcontractor-docs bucket, via
-- work_order_photos) be *mirrored* into job_photos as its own row —
-- auto-foldered by trade — without copying the file: the mirrored row
-- just points at the same bucket+path. Sharing a mirrored row keeps
-- work_order_photos.is_internal in sync (see PhotoGallery.js toggleShared)
-- since that's what the actual storage.objects policy below checks for
-- files in that bucket — job_photos.is_internal alone wouldn't unlock the
-- file itself for a customer.
alter table job_photos add column if not exists is_internal boolean not null default true;
alter table job_photos add column if not exists source_bucket text not null default 'job-photos';
alter table job_photos add column if not exists source_work_order_photo_id uuid references work_order_photos(id) on delete cascade;

-- One mirror row per source photo — without this, calling the mirror
-- function twice for the same upload (a retry, a slow network double-fire)
-- would duplicate the photo in the job's Photos tab.
create unique index if not exists job_photos_source_work_order_photo_id_key
  on job_photos (source_work_order_photo_id) where source_work_order_photo_id is not null;

drop policy if exists "Customers can view photos on their own jobs" on job_photos;
create policy "Customers can view photos on their own jobs" on job_photos for select using (
  has_job_portal_access(job_id) and not is_internal
);

drop policy if exists "Customers can view their own job photo files" on storage.objects;
create policy "Customers can view their own job photo files" on storage.objects for select using (
  bucket_id = 'job-photos'
  and not is_admin()
  and has_job_portal_access(((storage.foldername(name))[1])::uuid)
  and exists (
    select 1 from job_photos jp where jp.storage_path = storage.objects.name and not jp.is_internal
  )
);

-- Lets a sub's progress-photo upload (work_order_photos, via the existing
-- add_work_order_photo RPC + subcontractor-docs bucket) also show up in
-- the job's own Photos tab, auto-filed into a trade-named folder, without
-- staff having to manually re-upload or re-file anything. Called from
-- the sub portal right after a photo upload succeeds (see
-- app/sub-portal/work-orders/[workOrderId]/page.js).
create or replace function mirror_work_order_photo_to_job_photos(work_order_photo_id_in uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  wop record;
  wo record;
begin
  select * into wop from work_order_photos where id = work_order_photo_id_in;
  if wop is null then return; end if;

  select id, job_id, trade, company_id into wo from work_orders where id = wop.work_order_id;
  if wo.job_id is null then return; end if;

  if not (is_admin() or is_sub_portal_member(wo.company_id)) then
    raise exception 'Not authorized.';
  end if;

  insert into job_photos (job_id, storage_path, source_bucket, folder, caption, is_internal, source_work_order_photo_id)
  values (
    wo.job_id,
    wop.storage_path,
    'subcontractor-docs',
    coalesce(wo.trade, 'Subcontractor') || ' — Sub Photos',
    wop.caption,
    true,
    wop.id
  )
  on conflict (source_work_order_photo_id) where source_work_order_photo_id is not null do nothing;
end;
$$;

grant execute on function mirror_work_order_photo_to_job_photos(uuid) to authenticated;

-- A mirrored row's file lives in subcontractor-docs, not job-photos — the
-- customer storage policy for that bucket (migration 123) already gates
-- on work_order_photos.is_internal, which toggleShared() keeps in sync,
-- so no separate storage policy is needed here for mirrored rows.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_photos'
  ) then
    alter publication supabase_realtime add table job_photos;
  end if;
end $$;

-- Same security-definer-view pattern as customer_visible_work_order_photos
-- (migration 123) — lets the customer portal's "Photo Updates" feed
-- (components/PortalPhotoFeed.js) also pick up general job photos staff
-- shared, not just work-order progress photos, without granting a direct
-- table policy beyond the is_internal-gated one added above.
drop view if exists customer_visible_job_photos;
create view customer_visible_job_photos as
select jp.id, jp.job_id, jp.storage_path, jp.source_bucket, jp.folder, jp.caption, jp.created_at
from job_photos jp
where not jp.is_internal
  and has_job_portal_access(jp.job_id);

grant select on customer_visible_job_photos to authenticated;
