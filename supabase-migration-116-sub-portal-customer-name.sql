-- Run in Supabase SQL Editor after migration 115. Safe to re-run.
--
-- Sub Portal redesign: job cards are now named "Lastname — Job #204"
-- instead of leading with the address, so subs need customer_name
-- exposed through the safe view they already read jobs from. Also
-- carries estimate_number and job_type through so the portal can build
-- the same "Job #/Estimate #" label the staff side uses (see
-- projectNumber()/projectNumberLabel() in lib/constants.js) without a
-- second round trip.
--
-- Postgres' CREATE OR REPLACE VIEW only allows appending new columns
-- at the end of the column list — inserting estimate_number/job_type
-- ahead of the existing project_address column errors with "cannot
-- change name of view column". Drop and recreate instead.

drop view if exists sub_visible_jobs;

create view sub_visible_jobs as
select distinct j.id, j.job_number, j.estimate_number, j.customer_name, j.job_type,
  j.project_address, j.stage, j.expected_close_date, j.scheduled_start_date
from jobs j
where exists (
  select 1 from work_orders wo
  where wo.job_id = j.id and is_sub_portal_member(wo.company_id)
);
grant select on sub_visible_jobs to authenticated;