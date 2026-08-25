-- Run in Supabase SQL Editor after migration 058. Safe to re-run.
alter table jobs add column if not exists referral_name text;
alter table opportunities add column if not exists referral_name text;
