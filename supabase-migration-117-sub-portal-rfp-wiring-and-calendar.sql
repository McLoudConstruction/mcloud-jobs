-- Run in Supabase SQL Editor after migration 116. Safe to re-run.
--
-- Two things:
-- 1. Fixes the Sub Portal's RFP pages showing blank Customer/Job #/
--    Address — see the comment above sub_visible_rfps for why.
-- 2. Adds a Sub Portal calendar: awarded job phases, schedule events a
--    company has been invited to, and a way for a sub to request a
--    schedule event (goes in as a pending request, not straight onto
--    the calendar).

-- ═══════════════════════════════════════════════════════════════════════
-- 1. RFP job data wiring
-- ═══════════════════════════════════════════════════════════════════════
-- The RFP pages were querying `rfp_recipients(*, rfps(*, jobs(...)))` —
-- a nested embed straight through to the `jobs` table. `rfps` itself has
-- a policy letting an invited sub select it, but `jobs` only has
-- policies for staff (is_admin()) and customers with portal access
-- (has_job_portal_access) — nothing for the sub portal. PostgREST's
-- nested embed silently returns null for a row RLS blocks rather than
-- erroring, so every job field came back blank. This is the same
-- problem sub_visible_jobs already solves for the dashboard — but that
-- view only includes jobs with a work order, and an RFP is sent out
-- *before* one exists. This is the RFP-shaped equivalent: one row per
-- rfp_recipient, job fields flattened in, filtered to the sub's own
-- company via is_sub_portal_member (evaluated as the view owner, same
-- as sub_visible_jobs, so it reads through jobs' RLS instead of being
-- blocked by it).
create or replace view sub_visible_rfps as
select
  rr.id, rr.company_id, rr.rfp_id, rr.status, rr.sent_at, rr.first_viewed_at, rr.responded_at,
  rr.proposal_amount, rr.proposal_duration, rr.proposal_exclusions, rr.proposal_text, rr.proposal_files,
  r.title, r.description, r.job_id, r.photo_ids,
  j.job_number, j.estimate_number, j.customer_name, j.job_type, j.stage, j.project_address
from rfp_recipients rr
join rfps r on r.id = rr.rfp_id
left join jobs j on j.id = r.job_id
where is_sub_portal_member(rr.company_id);
grant select on sub_visible_rfps to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Sub Portal calendar
-- ═══════════════════════════════════════════════════════════════════════

-- schedule_events previously had "any authenticated user can do
-- everything" (migration 108) — nobody had built anything sub-facing
-- against it yet, so it was never tightened the way jobs/notifications/
-- etc. were in migration 009. Now that the sub portal reads from it,
-- lock it to staff (is_admin(), same convention job_phases already
-- uses) and add invited_company_ids so an event can name which sub
-- companies should see it on their own calendar — same shape as
-- assigned_staff_ids.
alter table schedule_events add column if not exists invited_company_ids uuid[] not null default '{}';

drop policy if exists "Authenticated can do everything on schedule_events" on schedule_events;
drop policy if exists "Admin can do everything on schedule_events" on schedule_events;
create policy "Admin can do everything on schedule_events" on schedule_events for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Sub can view events they're invited to" on schedule_events;
create policy "Sub can view events they're invited to" on schedule_events for select using (
  exists (
    select 1 from unnest(invited_company_ids) as cid where is_sub_portal_member(cid)
  )
);

-- Phases on a job the sub has actually been awarded — a job_phases row
-- counts once the sub has an accepted (or further along) work order on
-- that job, matched by trade so a drywall sub doesn't see the roofing
-- phase; a phase with no trade (inspections, punch list — synthetic,
-- multi-trade milestones) is shown to everyone awarded anything on the
-- job, same reasoning as sub_visible_jobs showing the whole job rather
-- than trying to scope address/dates per trade.
create or replace view sub_visible_phases as
select distinct jp.id, jp.job_id, jp.phase_key, jp.label, jp.trade,
  jp.start_date, jp.end_date, jp.duration_days, jp.sort_order
from job_phases jp
join work_orders wo on wo.job_id = jp.job_id
where wo.status in ('accepted', 'completed', 'invoiced', 'paid')
  and is_sub_portal_member(wo.company_id)
  and (jp.trade is null or jp.trade = wo.trade);
grant select on sub_visible_phases to authenticated;

-- schedule_requests — a sub asking for something to go on the calendar
-- (e.g. "need a walkthrough Tuesday"). Never lands directly on
-- schedule_events; sits here as 'pending' until staff resolves it via
-- resolve_schedule_request, same "no direct write" pattern as every
-- other sub-side action in this app.
create table if not exists schedule_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  event_type text not null default 'meeting',
  description text,
  requested_date date not null,
  requested_time time,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_by_email text,
  staff_note text,
  resolved_at timestamptz,
  schedule_event_id uuid references schedule_events(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table schedule_requests enable row level security;

drop policy if exists "Admin can do everything on schedule_requests" on schedule_requests;
create policy "Admin can do everything on schedule_requests" on schedule_requests for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Sub can view own schedule requests" on schedule_requests;
create policy "Sub can view own schedule requests" on schedule_requests for select using (
  is_sub_portal_member(company_id)
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedule_requests'
  ) then
    alter publication supabase_realtime add table schedule_requests;
  end if;
end $$;

create or replace function request_schedule_event(
  target_company_id uuid,
  target_job_id uuid,
  event_type_in text,
  description_in text,
  requested_date_in date,
  requested_time_in time default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  new_id uuid;
  company_name_text text;
  event_label text;
begin
  if not is_sub_portal_member(target_company_id) then
    raise exception 'Not authorized';
  end if;
  if target_job_id is null or not exists (select 1 from sub_visible_jobs where id = target_job_id) then
    raise exception 'That job is not visible to this company';
  end if;
  if requested_date_in is null then
    raise exception 'Pick a date';
  end if;

  insert into schedule_requests (company_id, job_id, event_type, description, requested_date, requested_time, requested_by_email)
  values (target_company_id, target_job_id, coalesce(nullif(trim(event_type_in), ''), 'meeting'), nullif(trim(description_in), ''), requested_date_in, requested_time_in, caller_email)
  returning id into new_id;

  select company_name into company_name_text from companies where id = target_company_id;
  event_label := coalesce(nullif(trim(description_in), ''), initcap(replace(coalesce(nullif(trim(event_type_in), ''), 'meeting'), '_', ' ')));
  insert into notifications (message, job_id)
  values (coalesce(company_name_text, 'A subcontractor') || ' requested a schedule event for ' || to_char(requested_date_in, 'Mon DD') || ': ' || left(event_label, 100), target_job_id);

  return new_id;
end;
$$;
grant execute on function request_schedule_event(uuid, uuid, text, text, date, time) to authenticated;

-- Staff-side resolution — approving creates the real schedule_events row
-- (invited back to the requesting company so it also shows on their
-- calendar), declining just closes the request out. No dedicated staff
-- UI ships with this migration; call this from the SQL editor or wire a
-- button to it later — it's the full round trip either way.
create or replace function resolve_schedule_request(target_request_id uuid, approve boolean, staff_note_in text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  new_event_id uuid;
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;
  select * into req from schedule_requests where id = target_request_id;
  if req is null then
    raise exception 'Request not found';
  end if;
  if req.status != 'pending' then
    raise exception 'Request already resolved';
  end if;

  if approve then
    insert into schedule_events (event_type, description, event_date, event_time, job_id, invited_company_ids)
    values (req.event_type, req.description, req.requested_date, req.requested_time, req.job_id, array[req.company_id])
    returning id into new_event_id;
  end if;

  update schedule_requests
  set status = case when approve then 'approved' else 'declined' end,
      staff_note = nullif(trim(staff_note_in), ''),
      resolved_at = now(),
      schedule_event_id = new_event_id
  where id = target_request_id;
end;
$$;
grant execute on function resolve_schedule_request(uuid, boolean, text) to authenticated;
