-- Run in Supabase SQL Editor after migration 011.
-- This changes the stage values every job uses. Existing jobs are mapped
-- forward automatically — nothing is lost, but double check a job or two
-- after running to confirm the mapping looks right to you.

-- Old stages -> new stages:
--   proposal  -> proposal_delivered
--   contract  -> approved
--   active    -> active
--   invoice   -> invoiced
--   complete  -> paid

-- Step 1: drop the old constraint so we can write the new values in.
alter table jobs drop constraint if exists jobs_stage_check;

-- Step 2: migrate existing data.
update jobs set stage = 'proposal_delivered' where stage = 'proposal';
update jobs set stage = 'approved' where stage = 'contract';
update jobs set stage = 'invoiced' where stage = 'invoice';
update jobs set stage = 'paid' where stage = 'complete';
-- 'active' stays 'active' — already a valid name in both systems.

-- Step 3: apply the new, wider constraint.
alter table jobs add constraint jobs_stage_check
  check (stage in ('new','inspected','proposal_delivered','approved','scheduled','active','completed','invoiced','paid'));

alter table jobs alter column stage set default 'new';
