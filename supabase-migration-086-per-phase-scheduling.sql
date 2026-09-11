-- Run in Supabase SQL Editor after migration 085. Safe to re-run.
--
-- Replaces two earlier fields that turned out to be the wrong shape:
--
-- 1. jobs.schedule_weekend_work (one flag for the whole job) becomes
--    job_phases.allow_weekend_work (one flag per phase) — real jobs have
--    some phases that are fine on a weekend and others that aren't, not
--    one answer for the whole schedule.
--
-- 2. job_phases.prefer_monday_start (boolean, Monday only) becomes
--    job_phases.preferred_start_day (text: 'sunday'..'saturday', or
--    null for no preference) — the "start fresh on a Monday" idea
--    generalizes to any day of the week, not just Monday.

alter table job_phases add column if not exists allow_weekend_work boolean not null default false;
alter table job_phases add column if not exists preferred_start_day text;

alter table jobs drop column if exists schedule_weekend_work;
alter table job_phases drop column if exists prefer_monday_start;
