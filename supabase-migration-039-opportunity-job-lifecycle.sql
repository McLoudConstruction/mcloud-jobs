-- Run in Supabase SQL Editor after migration 038. Safe to re-run.
--
-- Moves the line in the sand: a project is an Opportunity (Estimate #)
-- from creation through pricing, and only becomes a Job (Job #) once the
-- contract is signed and it's Approved. job_number is no longer assigned
-- at creation — it's assigned the moment a project first reaches
-- Approved. Existing jobs keep whatever job_number they already have;
-- this only changes behavior going forward.

alter table jobs add column if not exists estimate_number text;

-- job_number was NOT NULL UNIQUE — now optional (null until Approved),
-- with uniqueness enforced only among the rows that do have one.
alter table jobs alter column job_number drop not null;
alter table jobs drop constraint if exists jobs_job_number_key;
create unique index if not exists jobs_job_number_unique_idx on jobs (job_number) where job_number is not null;
create unique index if not exists jobs_estimate_number_unique_idx on jobs (estimate_number) where estimate_number is not null;

-- Backfill: any existing job with a job_number but no estimate_number
-- gets one derived from its job_number, purely so old records display
-- sensibly anywhere an estimate number is expected before approval
-- (in practice this only matters for jobs that were never approved).
update jobs set estimate_number = job_number where estimate_number is null and job_number is not null;
