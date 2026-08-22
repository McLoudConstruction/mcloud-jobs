-- Run in Supabase SQL Editor after migration 047. Safe to re-run.
alter table jobs add column if not exists scheduled_end_date date;
