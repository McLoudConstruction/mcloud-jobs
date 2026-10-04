-- Run in Supabase SQL Editor after migration 150. Safe to re-run.
--
-- Lead attribution: records where a website lead came from, so the funnel
-- (migration to follow) can show leads, wins and average job size by source
-- and by industry.
--
--   source         existing column (migration 146). Website consultation
--                  requests now write 'website'; site requests from Drive
--                  Mode already write 'drive_mode'.
--   lead_vertical  the industry page the visitor was last looking at, using
--                  the keys in lib/verticals.js (multi_family, hotel_lodging,
--                  office, retail, recreational, church, residential).
--   utm_*          campaign tags on the link they arrived through (outreach
--                  emails and any ads will use these).
--   landing_path   the first page they landed on in that visit.
--   referrer       the external site they came from, when the browser says.
--
-- All columns are optional. Leads entered by hand in Sales leave them empty.

alter table opportunities add column if not exists lead_vertical text;
alter table opportunities add column if not exists utm_source text;
alter table opportunities add column if not exists utm_medium text;
alter table opportunities add column if not exists utm_campaign text;
alter table opportunities add column if not exists landing_path text;
alter table opportunities add column if not exists referrer text;

create index if not exists opportunities_lead_vertical_idx on opportunities (lead_vertical) where lead_vertical is not null;
create index if not exists opportunities_source_idx on opportunities (source) where source is not null;
