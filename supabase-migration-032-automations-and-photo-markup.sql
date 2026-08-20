-- Run in Supabase SQL Editor after migration 031. Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════
-- Opportunity follow-ups — sent-at timestamps double as the "don't send
-- twice" guard for the daily cron job.
-- ═══════════════════════════════════════════════════════════════════════
alter table opportunities add column if not exists followup_2d_sent_at timestamptz;
alter table opportunities add column if not exists followup_4d_sent_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════
-- Scheduled-start reminders — jobs never had a real scheduled start date
-- field (expected_close_date is completion, not start).
-- ═══════════════════════════════════════════════════════════════════════
alter table jobs add column if not exists scheduled_start_date date;
alter table jobs add column if not exists schedule_reminder_7d_sent_at timestamptz;
alter table jobs add column if not exists schedule_reminder_1d_sent_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════
-- Per-contact opt-out for automated emails (follow-ups + schedule
-- reminders both respect this before sending).
-- ═══════════════════════════════════════════════════════════════════════
alter table contacts add column if not exists automated_emails_opt_out boolean not null default false;

-- ═══════════════════════════════════════════════════════════════════════
-- Photo markup — a marked-up photo is saved as a new row derived from the
-- original, so the original is never destructively overwritten.
-- ═══════════════════════════════════════════════════════════════════════
alter table job_photos add column if not exists derived_from_photo_id uuid references job_photos(id) on delete set null;
