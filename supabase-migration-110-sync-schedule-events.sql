-- Run in Supabase SQL Editor after migration 109. Safe to re-run.
--
-- Extends calendar_sync_events to also link to schedule_events (migration
-- 108's "New Event" popup on the Calendar page). schedule_events' own
-- comment already flagged this: "this is the source data those pushes
-- will eventually read from, not a replacement for it" — lib/integrations/
-- calendarSync.js was never actually updated to read it, so any event
-- created through "New Event" (not a job's scheduled_start_date, not a
-- lead's bid_walk_scheduled_at) never got pushed to Google/Microsoft
-- Calendar on sync. Same job_id/opportunity_id pattern as migration 107.

alter table calendar_sync_events add column if not exists schedule_event_id uuid references schedule_events(id) on delete cascade;

create unique index if not exists calendar_sync_events_schedule_event_unique
  on calendar_sync_events (connection_id, schedule_event_id)
  where schedule_event_id is not null;

alter table calendar_sync_events drop constraint if exists calendar_sync_events_target_check;
alter table calendar_sync_events add constraint calendar_sync_events_target_check check (
  (job_id is not null and opportunity_id is null and schedule_event_id is null) or
  (job_id is null and opportunity_id is not null and schedule_event_id is null) or
  (job_id is null and opportunity_id is null and schedule_event_id is not null)
);
