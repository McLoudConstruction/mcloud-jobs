-- Run in Supabase SQL Editor after migration 107. Safe to re-run.
--
-- Backs the new "New Event" flow on the Calendar page (app/jobs/calendar):
-- a manually-created event, optionally tied to a lead/opportunity or a
-- job, with a type, description, one or more assigned staff, and a
-- date/time. Distinct from calendar_sync_events (migration 087/107),
-- which is the outbound push-sync record to a connected personal
-- calendar — this is the source data those pushes will eventually read
-- from, not a replacement for it.

create table if not exists schedule_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null default 'meeting',
  description text,
  event_date date not null,
  event_time time,
  opportunity_id uuid references opportunities(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  assigned_staff_ids uuid[] not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint schedule_events_single_project check (
    opportunity_id is null or job_id is null
  )
);

create index if not exists schedule_events_date_idx on schedule_events (event_date);
create index if not exists schedule_events_opportunity_idx on schedule_events (opportunity_id);
create index if not exists schedule_events_job_idx on schedule_events (job_id);

alter table schedule_events enable row level security;

drop policy if exists "Authenticated can do everything on schedule_events" on schedule_events;
create policy "Authenticated can do everything on schedule_events"
  on schedule_events for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter publication supabase_realtime add table schedule_events;
