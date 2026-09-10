-- Run in Supabase SQL Editor after migration 083. Safe to re-run.
--
-- Per-phase preference that it should start on a Monday regardless of
-- where the sequential schedule would otherwise land it — e.g. punch
-- list walks and repairs, where starting mid-week doesn't make sense,
-- versus painting, which can start any day without issue.
--
-- This actually drives date computation (see recomputeSequentialDates in
-- lib/scheduleDates.js), not just a display flag — checking it snaps
-- that phase's start forward to the next Monday during generation,
-- regeneration, and any cascading duration edit.

alter table job_phases add column if not exists prefer_monday_start boolean not null default false;
