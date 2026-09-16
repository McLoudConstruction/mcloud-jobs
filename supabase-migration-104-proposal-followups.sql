-- Run in Supabase SQL Editor after migration 103. Safe to re-run.
--
-- Automatic proposal follow-up emails, alongside the existing
-- opportunity follow-up (2d/4d after date_taken) and schedule reminder
-- automations already run by /api/cron/daily-automations. This one
-- fires while a job's proposal has been sent (proposal_sent_at) but the
-- job hasn't been won or lost yet, up to a configurable count and
-- interval — both editable on the Settings page rather than hardcoded.

alter table app_settings add column if not exists proposal_followup_count integer not null default 3;
alter table app_settings add column if not exists proposal_followup_interval_days integer not null default 4;

alter table jobs add column if not exists proposal_followups_sent_count integer not null default 0;
alter table jobs add column if not exists proposal_followup_last_sent_at timestamptz;
