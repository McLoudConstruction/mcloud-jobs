-- Run in Supabase SQL Editor after migration 145. Safe to re-run.
--
-- "Site requests": while on a sales route, a customer asks you to look at
-- something on the spot. That is more than a cold lead (a person asked for
-- you) but not yet an Opportunity (no job/estimate exists). It lives in
-- the same opportunities table as a new stage, 'site_request', so it
-- reuses everything leads already have: the Sales list, the contact
-- fields, photos (opportunity_photos, migration 124) and Convert to
-- Opportunity.
--
-- Field mapping for a site request:
--   project        = short project description
--   contact_*      = project contact name, email, phone
--   notes          = pertinent details (also carries into the job
--                    description on conversion)
--   property_id    = the Drive Mode stop it was created from
--   site_address   = one-line address snapshot at the time of the request
--   source         = 'drive_mode'
--
-- The nightly follow-up automation only targets 'prospecting' and
-- 'contacted', so a site request never gets an automated follow-up email.

alter table opportunities add column if not exists property_id uuid references properties(id) on delete set null;
alter table opportunities add column if not exists site_address text;
alter table opportunities add column if not exists source text;

create index if not exists opportunities_property_id_idx on opportunities (property_id) where property_id is not null;

alter table opportunities drop constraint if exists opportunities_stage_check;
alter table opportunities add constraint opportunities_stage_check
  check (stage in ('prospecting','contacted','site_request','proposal','won','lost','converted'));
