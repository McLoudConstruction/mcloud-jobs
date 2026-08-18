-- Run in Supabase SQL Editor after migration 023. Safe to re-run.
alter table contacts add column if not exists position text;
