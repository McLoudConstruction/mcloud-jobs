-- Migration 136 — Scheduling: sub availability, delay log, conflict support
--
-- Adds two things on top of the existing job_phases / schedule_events /
-- schedule_requests tables (nothing there is replaced):
--
--   • company_unavailability — dates a subcontractor has told us they can't
--     work (vacation, another commitment, a crew out). Subs add/remove their
--     own from the Sub Portal calendar (through RPCs, same "no direct write"
--     pattern as the rest of the sub portal); staff can edit any of them. The
--     new cross-job Schedule Board flags any phase that lands on one.
--
--   • schedule_delays — a log of every "the schedule moved" event on a job:
--     how many working days, why (a category plus a private note), and what
--     was said to the customer/subs. The shifting itself happens in the app
--     (it has to respect weekend rules per phase); log_schedule_delay() then
--     records it and sends the notifications in one step. Doubles as the
--     evidence trail if a delay is ever disputed.
--
-- A sub is "on" a phase the same way sub_visible_phases (migration 117)
-- decides it: they hold an issued/accepted work order on the job for that
-- phase's trade.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Sub availability
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists company_unavailability (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_by_email text,
  created_at timestamptz not null default now(),
  constraint company_unavailability_range check (end_date >= start_date and end_date - start_date <= 366)
);
create index if not exists company_unavailability_company_idx on company_unavailability (company_id, start_date);

alter table company_unavailability enable row level security;

drop policy if exists "Admin can do everything on company_unavailability" on company_unavailability;
create policy "Admin can do everything on company_unavailability" on company_unavailability
  for all using (is_admin()) with check (is_admin());

drop policy if exists "Sub can view own unavailability" on company_unavailability;
create policy "Sub can view own unavailability" on company_unavailability
  for select using (is_sub_portal_member(company_id));

create or replace function add_sub_unavailability(target_company_id uuid, start_in date, end_in date, reason_in text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt() ->> 'email';
  new_id uuid;
  cname text;
  hits integer;
  detail text;
begin
  if not exists (
    select 1 from sub_portal_users where company_id = target_company_id and lower(email) = lower(caller_email) and role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;
  if start_in is null or end_in is null or end_in < start_in then
    raise exception 'Choose a valid date range';
  end if;
  if end_in - start_in > 366 then
    raise exception 'That range is too long — add it in smaller pieces';
  end if;

  insert into company_unavailability (company_id, start_date, end_date, reason, created_by_email)
  values (target_company_id, start_in, end_in, nullif(btrim(coalesce(reason_in, '')), ''), caller_email)
  returning id into new_id;

  select company_name into cname from companies where id = target_company_id;

  -- Tell the office, and say plainly if this collides with work already scheduled.
  select count(distinct jp.id) into hits
  from job_phases jp
  join work_orders wo on wo.job_id = jp.job_id
  where wo.company_id = target_company_id
    and wo.status in ('issued', 'accepted')
    and jp.status = 'published'
    and jp.trade is not null and jp.trade = wo.trade
    and jp.start_date <= end_in and jp.end_date >= start_in;

  detail := case when hits > 0
    then ' — this overlaps ' || hits || ' scheduled phase' || case when hits = 1 then '' else 's' end || '. Check the Schedule Board.'
    else '.' end;

  insert into notifications (message)
  values (coalesce(cname, 'A subcontractor') || ' marked themselves unavailable ' || to_char(start_in, 'FMMon FMDD')
    || case when end_in <> start_in then ' – ' || to_char(end_in, 'FMMon FMDD') else '' end || detail);

  return new_id;
end;
$$;
grant execute on function add_sub_unavailability(uuid, date, date, text) to authenticated;

create or replace function remove_sub_unavailability(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row_company uuid;
begin
  select company_id into row_company from company_unavailability where id = target_id;
  if row_company is null then
    raise exception 'Not found';
  end if;
  if not exists (
    select 1 from sub_portal_users where company_id = row_company and lower(email) = lower(auth.jwt() ->> 'email') and role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;
  delete from company_unavailability where id = target_id;
end;
$$;
grant execute on function remove_sub_unavailability(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Delay log
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists schedule_delays (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  from_date date not null,
  workdays_shifted integer not null check (workdays_shifted between 1 and 365),
  phases_shifted integer not null default 0,
  reason_category text not null default 'other'
    check (reason_category in ('weather', 'material_delay', 'sub_delay', 'customer_change', 'inspection_permit', 'other')),
  internal_note text,
  customer_note text,
  customer_notified boolean not null default false,
  subs_notified integer not null default 0,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists schedule_delays_job_idx on schedule_delays (job_id, created_at desc);

alter table schedule_delays enable row level security;
drop policy if exists "Admin can do everything on schedule_delays" on schedule_delays;
create policy "Admin can do everything on schedule_delays" on schedule_delays
  for all using (is_admin()) with check (is_admin());

create or replace function _delay_category_label(c text)
returns text
language sql
immutable
as $$
  select case c
    when 'weather' then 'weather'
    when 'material_delay' then 'a material delay'
    when 'sub_delay' then 'a scheduling change on the trade side'
    when 'customer_change' then 'a change requested on the project'
    when 'inspection_permit' then 'an inspection or permit timing'
    else 'a schedule adjustment' end;
$$;

-- Records a delay that the app has already applied to job_phases, and sends
-- the notifications. Staff only.
create or replace function log_schedule_delay(
  target_job_id uuid,
  from_date_in date,
  workdays_in integer,
  phases_shifted_in integer,
  category_in text,
  internal_note_in text,
  customer_note_in text,
  notify_customer boolean,
  notify_subs boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  addr text;
  jnum text;
  sub_count integer := 0;
  cust_msg text;
  rec record;
begin
  if not (coalesce(is_admin(), false)) then
    raise exception 'Not authorized';
  end if;
  select project_address, coalesce(job_number, estimate_number) into addr, jnum from jobs where id = target_job_id;
  if not found then
    raise exception 'Job not found';
  end if;

  insert into schedule_delays (job_id, from_date, workdays_shifted, phases_shifted, reason_category, internal_note, customer_note, customer_notified, created_by_email)
  values (target_job_id, from_date_in, workdays_in, coalesce(phases_shifted_in, 0), coalesce(category_in, 'other'),
          nullif(btrim(coalesce(internal_note_in, '')), ''), nullif(btrim(coalesce(customer_note_in, '')), ''),
          coalesce(notify_customer, false), auth.jwt() ->> 'email')
  returning id into new_id;

  if coalesce(notify_customer, false) then
    cust_msg := 'The schedule for your project' || coalesce(' at ' || addr, '') || ' has been updated: remaining work now runs about '
      || workdays_in || ' working day' || case when workdays_in = 1 then '' else 's' end || ' later than planned, due to '
      || _delay_category_label(coalesce(category_in, 'other')) || '.'
      || case when nullif(btrim(coalesce(customer_note_in, '')), '') is not null then ' ' || btrim(customer_note_in) else '' end
      || ' You can see the updated dates in your portal.';
    insert into portal_notifications (recipient_kind, job_id, category, message, link_path, source_id)
    values ('customer', target_job_id, 'schedule_change', cust_msg, '/customerportal/schedule', new_id);
  end if;

  if coalesce(notify_subs, false) then
    for rec in
      select distinct wo.company_id
      from work_orders wo
      where wo.job_id = target_job_id and wo.company_id is not null and wo.status in ('issued', 'accepted')
    loop
      insert into portal_notifications (recipient_kind, company_id, job_id, category, message, link_path, source_id)
      values ('subcontractor', rec.company_id, target_job_id, 'schedule_change',
        'The schedule for' || coalesce(' job #' || jnum, ' a job') || coalesce(' (' || addr || ')', '') || ' moved about '
          || workdays_in || ' working day' || case when workdays_in = 1 then '' else 's' end
          || ' later. Please check your calendar for your new dates.',
        '/sub-portal/calendar', new_id);
      sub_count := sub_count + 1;
    end loop;
    update schedule_delays set subs_notified = sub_count where id = new_id;
  end if;

  return new_id;
end;
$$;
grant execute on function log_schedule_delay(uuid, date, integer, integer, text, text, text, boolean, boolean) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['company_unavailability', 'schedule_delays'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
