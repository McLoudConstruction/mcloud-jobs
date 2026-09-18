-- Run in Supabase SQL Editor after migration 108. Safe to re-run.
--
-- opportunities.stage's check constraint (migration 008) has never allowed
-- 'converted', but app/jobs/new/page.js has been setting stage='converted'
-- on every "Convert to Opportunity" ever since job_id was added (migration
-- 031) — that update has been silently failing the constraint the whole
-- time (its error isn't checked), so a converted lead never actually left
-- the active pipeline. 'proposal' and 'won' are kept even though nothing
-- in the app writes them anymore — old rows may still hold them, and
-- dropping allowed values a constraint already has is never safe to do
-- blind.

alter table opportunities drop constraint if exists opportunities_stage_check;
alter table opportunities add constraint opportunities_stage_check
  check (stage in ('prospecting','contacted','proposal','won','lost','converted'));

-- Backfill: any lead that already has a job_id (so it clearly WAS
-- converted) but is stuck in its old stage because that earlier update
-- silently failed.
update opportunities set stage = 'converted' where job_id is not null and stage <> 'converted';
