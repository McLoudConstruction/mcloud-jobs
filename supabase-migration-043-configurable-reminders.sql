-- Run in Supabase SQL Editor after migration 042. Safe to re-run.
--
-- The old schedule_reminder_7d_sent_at / schedule_reminder_1d_sent_at
-- columns hardcoded the timing into the column names themselves — there
-- was no way to make "7 and 1 days before" configurable without a real
-- schema change. This replaces that with a genuinely flexible list.
alter table jobs add column if not exists schedule_reminder_days integer[] not null default '{7,1}';
alter table jobs add column if not exists schedule_reminders_sent integer[] not null default '{}';

-- Backfill: a job that already got its old-style reminders shouldn't
-- get duplicates once the cron switches to reading the new columns.
update jobs set schedule_reminders_sent = array_append(schedule_reminders_sent, 7)
  where schedule_reminder_7d_sent_at is not null and not (7 = any(schedule_reminders_sent));
update jobs set schedule_reminders_sent = array_append(schedule_reminders_sent, 1)
  where schedule_reminder_1d_sent_at is not null and not (1 = any(schedule_reminders_sent));
