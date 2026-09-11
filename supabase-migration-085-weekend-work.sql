-- Run in Supabase SQL Editor after migration 084. Safe to re-run.
--
-- Job-level toggle: when false (default), schedule generation and
-- editing skip weekends the way they already do today. When true, every
-- calendar day is treated as workable — durations and cascading edits no
-- longer jump over Saturday/Sunday.
--
-- Lives on jobs rather than job_phases since it's a setting for the
-- whole schedule, not a per-phase thing like prefer_monday_start.

alter table jobs add column if not exists schedule_weekend_work boolean not null default false;
