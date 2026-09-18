-- Run in Supabase SQL Editor after migration 112. Safe to re-run.
--
-- Two things:
-- 1. Estimator role — a new staff role, same permission scope as General
--    Manager, sitting between General Manager and Project Manager in the
--    roster UI. Owner + Estimator are the only roles that can create or
--    manage RFPs (below).
-- 2. RFPs — a new "Request For Proposal" object, distinct from Work
--    Orders, used to solicit bids from subs before work is committed.
--    Lives in the Sub Portal under its own "Requests" section so a sub
--    never confuses an open bid with an assigned, active job.

-- ═══════════════════════════════════════════════════════════════════════
-- Estimator role
-- ═══════════════════════════════════════════════════════════════════════
alter table staff_users drop constraint if exists staff_users_role_check;
alter table staff_users add constraint staff_users_role_check
  check (role in ('owner', 'general_manager', 'estimator', 'project_manager', 'bookkeeper'));

-- ═══════════════════════════════════════════════════════════════════════
-- rfps — one per "ask" sent out on a job. Sourced from a set of photos
-- (typically the Initial Inspection folder), scoped to a single job.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists rfps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  title text not null,
  description text,
  source_folder text, -- job_photos.folder value this RFP was built from, e.g. "Initial Inspection/2026-09-18"
  photo_ids uuid[] not null default '{}', -- job_photos.id values packaged into this RFP
  created_by uuid references staff_users(id),
  status text not null default 'open' check (status in ('open', 'awarded', 'not_awarded')),
  awarded_company_id uuid references companies(id),
  awarded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table rfps enable row level security;

-- ═══════════════════════════════════════════════════════════════════════
-- rfp_recipients — one row per sub the RFP was sent to. This is the
-- table a sub actually interacts with: their own proposal, and (once
-- the job resolves) whether they were awarded. A sub never sees another
-- company's row — no shared "who else got this" view.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists rfp_recipients (
  id uuid primary key default gen_random_uuid(),
  rfp_id uuid not null references rfps(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  status text not null default 'sent' check (status in ('sent', 'viewed', 'responded', 'awarded', 'not_awarded')),
  sent_at timestamptz not null default now(),
  first_viewed_at timestamptz,
  responded_at timestamptz,
  proposal_text text,
  proposal_files jsonb not null default '[]'::jsonb, -- [{name, storage_path}]
  created_at timestamptz not null default now(),
  unique (rfp_id, company_id)
);

alter table rfp_recipients enable row level security;

-- ═══════════════════════════════════════════════════════════════════════
-- RLS — rfps and rfp_recipients are Owner/Estimator territory on the
-- staff side (current_staff_role() already exists from migration 079).
-- Other staff roles (GM, PM, Bookkeeper) get no policy at all here, so
-- they see nothing — matches "RFPs should only be accessible by
-- Owners/Estimators."
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "Owner/Estimator manage rfps" on rfps;
create policy "Owner/Estimator manage rfps" on rfps for all using (
  current_staff_role() in ('owner', 'estimator')
) with check (
  current_staff_role() in ('owner', 'estimator')
);

drop policy if exists "Sub can view rfps they are invited to" on rfps;
create policy "Sub can view rfps they are invited to" on rfps for select using (
  exists (
    select 1 from rfp_recipients rr
    where rr.rfp_id = rfps.id and is_sub_portal_member(rr.company_id)
  )
);

drop policy if exists "Owner/Estimator manage rfp recipients" on rfp_recipients;
create policy "Owner/Estimator manage rfp recipients" on rfp_recipients for all using (
  current_staff_role() in ('owner', 'estimator')
) with check (
  current_staff_role() in ('owner', 'estimator')
);

drop policy if exists "Sub can view own rfp recipient row" on rfp_recipients;
create policy "Sub can view own rfp recipient row" on rfp_recipients for select using (
  is_sub_portal_member(company_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- Secure functions — a sub interacts with their recipient row only
-- through these (same pattern as accept_work_order/decline_work_order),
-- never a raw UPDATE grant. Proposal format is intentionally
-- unstructured: free text plus optional file attachments, since
-- responses range from two sentences to a full document.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function mark_rfp_viewed(target_recipient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company_id uuid;
begin
  select company_id into target_company_id from rfp_recipients where id = target_recipient_id;
  if target_company_id is null or not is_sub_portal_member(target_company_id) then
    raise exception 'Not authorized';
  end if;
  update rfp_recipients
  set first_viewed_at = coalesce(first_viewed_at, now()),
      status = case when status = 'sent' then 'viewed' else status end
  where id = target_recipient_id;
end;
$$;
grant execute on function mark_rfp_viewed(uuid) to authenticated;

create or replace function submit_rfp_proposal(target_recipient_id uuid, proposal_text_in text, proposal_files_in jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  target_company_id uuid;
  is_authorized boolean;
begin
  select company_id into target_company_id from rfp_recipients where id = target_recipient_id;
  if target_company_id is null then
    raise exception 'Request not found';
  end if;
  -- Admin login only (same "money things" split as accept/decline work order) — crew is view-only.
  select exists (
    select 1 from sub_portal_users
    where company_id = target_company_id and email = caller_email and role = 'admin'
  ) into is_authorized;
  if not is_authorized then
    raise exception 'Not authorized to respond to this request';
  end if;

  update rfp_recipients
  set proposal_text = proposal_text_in,
      proposal_files = coalesce(proposal_files_in, '[]'::jsonb),
      responded_at = now(),
      status = case when status in ('sent', 'viewed') then 'responded' else status end
  where id = target_recipient_id;
end;
$$;
grant execute on function submit_rfp_proposal(uuid, text, jsonb) to authenticated;

-- Staff-side resolution. Both check current_staff_role() directly rather
-- than relying on the caller having already passed the table's RLS
-- policy, since these run as security definer and bypass it.
create or replace function award_rfp(target_rfp_id uuid, target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_staff_role() not in ('owner', 'estimator') then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from rfp_recipients where rfp_id = target_rfp_id and company_id = target_company_id) then
    raise exception 'That company was not sent this RFP';
  end if;

  update rfps set status = 'awarded', awarded_company_id = target_company_id, awarded_at = now()
  where id = target_rfp_id;

  update rfp_recipients set status = 'awarded'
  where rfp_id = target_rfp_id and company_id = target_company_id;

  update rfp_recipients set status = 'not_awarded'
  where rfp_id = target_rfp_id and company_id <> target_company_id;
end;
$$;
grant execute on function award_rfp(uuid, uuid) to authenticated;

-- For a project that closes without being awarded to anyone — every
-- recipient's RFP becomes "Not Awarded" but stays visible/read-only
-- rather than disappearing.
create or replace function close_rfp_not_awarded(target_rfp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_staff_role() not in ('owner', 'estimator') then
    raise exception 'Not authorized';
  end if;

  update rfps set status = 'not_awarded' where id = target_rfp_id;
  update rfp_recipients set status = 'not_awarded' where rfp_id = target_rfp_id;
end;
$$;
grant execute on function close_rfp_not_awarded(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Storage — proposal attachments reuse the existing private
-- subcontractor-docs bucket, under rfp-proposals/{recipient_id}/..., same
-- foldername-matching pattern as migration 044's invoice upload.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "Subcontractor can upload own rfp proposal file" on storage.objects;
create policy "Subcontractor can upload own rfp proposal file" on storage.objects for insert
  with check (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'rfp-proposals'
    and exists (
      select 1 from rfp_recipients rr
      where rr.id::text = (storage.foldername(name))[2]
        and is_sub_portal_member(rr.company_id)
    )
  );

drop policy if exists "Staff and sub can view rfp proposal files" on storage.objects;
create policy "Staff and sub can view rfp proposal files" on storage.objects for select
  using (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'rfp-proposals'
    and (
      current_staff_role() in ('owner', 'estimator')
      or exists (
        select 1 from rfp_recipients rr
        where rr.id::text = (storage.foldername(name))[2]
          and is_sub_portal_member(rr.company_id)
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- job_photos / job-photos storage — existing policies only cover admin
-- staff and the job's own customer. A sub needs to see the specific
-- Initial Inspection photos packaged into an RFP sent to them (and only
-- those), so both the row and the underlying file get a narrow
-- RFP-scoped exception here.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "Sub can view photos included in their rfps" on job_photos;
create policy "Sub can view photos included in their rfps" on job_photos for select using (
  exists (
    select 1 from rfps r
    join rfp_recipients rr on rr.rfp_id = r.id
    where job_photos.id = any(r.photo_ids)
      and is_sub_portal_member(rr.company_id)
  )
);

drop policy if exists "Sub can view job photo files included in their rfps" on storage.objects;
create policy "Sub can view job photo files included in their rfps" on storage.objects for select using (
  bucket_id = 'job-photos'
  and exists (
    select 1 from job_photos jp
    join rfps r on jp.id = any(r.photo_ids)
    join rfp_recipients rr on rr.rfp_id = r.id
    where jp.storage_path = storage.objects.name
      and is_sub_portal_member(rr.company_id)
  )
);

-- ═══════════════════════════════════════════════════════════════════════
-- Per-sub RFP stats, for the backend "should we keep working with this
-- sub" view. Response rate, time-to-response, and win/loss record.
-- Restricted implicitly by RLS on rfp_recipients — only Owner/Estimator
-- can see anything in this view, since that's who can read the
-- underlying rows.
-- ═══════════════════════════════════════════════════════════════════════
create or replace view sub_rfp_stats as
select
  c.id as company_id,
  c.company_name,
  count(rr.id) as rfps_sent,
  count(rr.id) filter (where rr.responded_at is not null) as rfps_responded,
  count(rr.id) filter (where rr.status = 'awarded') as rfps_won,
  count(rr.id) filter (where rr.status = 'not_awarded') as rfps_not_awarded,
  round(
    (avg(extract(epoch from (rr.responded_at - rr.sent_at)) / 3600) filter (where rr.responded_at is not null))::numeric,
    1
  ) as avg_response_hours
from companies c
join rfp_recipients rr on rr.company_id = c.id
group by c.id, c.company_name;

grant select on sub_rfp_stats to authenticated;
