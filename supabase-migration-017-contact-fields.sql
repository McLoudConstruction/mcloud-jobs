-- Run in Supabase SQL Editor after migration 016. Safe to re-run.

alter table contacts add column if not exists first_name text;
alter table contacts add column if not exists last_name text;
-- `name` is kept as a combined display/search field, auto-set by the app
-- whenever first/last name are saved, so existing search/autofill code
-- keeps working unchanged.

alter table contacts add column if not exists address_street text;
alter table contacts add column if not exists address_unit text;
alter table contacts add column if not exists address_city text;
alter table contacts add column if not exists address_state text;
alter table contacts add column if not exists address_zip text;
-- This is the general/property address. billing_street etc (already on
-- the table) remains the separate billing address for non-homeowner types.
