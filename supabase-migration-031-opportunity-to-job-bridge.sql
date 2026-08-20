-- Run in Supabase SQL Editor after migration 030. Safe to re-run.

-- Opportunities never captured email/phone, which meant "converting" one
-- to a job couldn't actually carry contact info forward — only name.
alter table opportunities add column if not exists contact_email text;
alter table opportunities add column if not exists contact_phone text;

-- Tracks which job an opportunity became, once converted. Kept nullable
-- and on delete set null — deleting a job should never take out its
-- pipeline history.
alter table opportunities add column if not exists job_id uuid references jobs(id) on delete set null;
