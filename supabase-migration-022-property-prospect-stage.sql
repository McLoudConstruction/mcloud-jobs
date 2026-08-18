-- Run in Supabase SQL Editor after migration 021. Safe to re-run.

alter table properties add column if not exists prospect_stage text not null default 'prospecting'
  check (prospect_stage in ('prospecting','contacted','proposal','won','lost'));
-- Existing rows default to 'prospecting' — worth a quick manual pass to
-- update any that are actually further along or already lost.

alter table contacts add column if not exists property_id uuid references properties(id) on delete set null;
alter table contacts add column if not exists role text; -- e.g. 'Property Contact', 'Influencer'
