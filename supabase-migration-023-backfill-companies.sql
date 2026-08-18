-- Run in Supabase SQL Editor after migration 022.
-- This is a ONE-TIME data backfill, not a schema change — safe to re-run,
-- but only does work the first time (uses NOT EXISTS checks throughout).

-- Step 1: create a Company for every distinct management_company value on
-- existing properties that doesn't already have a matching company
-- (case-insensitive, whitespace-trimmed match).
insert into companies (company_name, company_type)
select distinct on (lower(trim(p.management_company))) trim(p.management_company), 'Management Company'
from properties p
where p.management_company is not null
  and trim(p.management_company) <> ''
  and not exists (
    select 1 from companies c
    where lower(trim(c.company_name)) = lower(trim(p.management_company))
  )
order by lower(trim(p.management_company)), p.management_company;

-- Step 2: link every property back to its matching company, for any
-- property that doesn't already have company_id set.
update properties p
set company_id = c.id
from companies c
where lower(trim(c.company_name)) = lower(trim(p.management_company))
  and p.company_id is null
  and p.management_company is not null
  and trim(p.management_company) <> '';

-- Quick check afterward — run this separately to see the result:
-- select property_name, management_company, company_id from properties order by property_name;
