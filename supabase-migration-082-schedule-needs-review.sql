-- Run in Supabase SQL Editor after migration 081. Safe to re-run.
--
-- When a schedule is regenerated, any phase whose duration was manually
-- edited (source = 'manual') keeps that duration rather than being
-- overwritten by the fresh AI estimate — but its dates may still shift if
-- an earlier phase's duration changed. needs_review flags that case so
-- the UI can recolor the row rather than silently trusting a duration
-- that was set under different surrounding circumstances.

alter table job_phases add column if not exists needs_review boolean not null default false;
