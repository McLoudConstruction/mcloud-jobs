-- Run in Supabase SQL Editor after migration 010. Safe to re-run.
alter table change_orders add column if not exists co_signatures jsonb not null default '{}';
-- Shape once filled in, same pattern as contracts:
-- { "contractor": {name,title,signature,date}, "owner": {name,title,signature,date} }
