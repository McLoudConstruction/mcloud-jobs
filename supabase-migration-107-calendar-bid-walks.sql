-- Run in Supabase SQL Editor after migration 106. Safe to re-run.
--
-- Extends the existing job-calendar push sync to also push scheduled bid
-- walks/inspections (opportunities.bid_walk_scheduled_at) as calendar
-- events. calendar_sync_events was job-only; this makes job_id optional
-- and adds an opportunity_id alternative — a row links to exactly one or
-- the other. The original (connection_id, job_id) unique constraint is
-- untouched and still works fine since Postgres never treats two NULLs
-- as a duplicate, so it doesn't conflict with opportunity-linked rows.

alter table calendar_sync_events alter column job_id drop not null;
alter table calendar_sync_events add column if not exists opportunity_id uuid references opportunities(id) on delete cascade;

create unique index if not exists calendar_sync_events_opp_unique
  on calendar_sync_events (connection_id, opportunity_id)
  where opportunity_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calendar_sync_events_target_check'
  ) then
    alter table calendar_sync_events add constraint calendar_sync_events_target_check check (
      (job_id is not null and opportunity_id is null) or (job_id is null and opportunity_id is not null)
    );
  end if;
end $$;
