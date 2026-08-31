-- Run in Supabase SQL Editor after migration 068. Safe to re-run.
--
-- Adds "Closed Lost" as a real stage a job can sit in, for opportunities
-- that didn't convert (customer went elsewhere, project fell through,
-- etc.) before ever reaching Approved. Only usable pre-Approval — once a
-- job has a real Job Number and is underway, "lost" no longer applies.
--
-- stage_before_lost remembers what stage the opportunity was in the
-- moment it was closed, so "Reopen" (see app/jobs/[id]/page.js) can
-- restore it exactly rather than dumping every reopened opportunity back
-- to New.

alter table jobs drop constraint if exists jobs_stage_check;
alter table jobs add constraint jobs_stage_check
  check (stage in ('new','inspected','proposal_delivered','approved','scheduled','active','completed','invoiced','paid','lost'));

alter table jobs add column if not exists lost_at timestamptz;
alter table jobs add column if not exists loss_reason text;
alter table jobs add column if not exists stage_before_lost text;
