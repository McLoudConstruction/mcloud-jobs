-- Run in Supabase SQL Editor after migration 082. Safe to re-run.
--
-- Optional free-text area tag on a trade breakdown action (e.g.
-- "Bathroom 1", "Kitchen", "Primary suite"). Null/blank means the action
-- applies to the whole job, which is the existing behavior for every job
-- that isn't stepped across multiple areas — this is purely additive.
--
-- Kept as free text rather than a foreign key to a new "areas" table on
-- purpose: areas are job-specific labels a contractor types once
-- ("Bathroom 1"), not a shared reference list like trades are.

alter table job_scope_actions add column if not exists area text;
