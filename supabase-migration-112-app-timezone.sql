-- Run in Supabase SQL Editor after migration 111. Safe to re-run.
--
-- Makes the business's timezone a real setting instead of a hardcoded
-- constant in lib/integrations/calendarSync.js (BUSINESS_TIMEZONE,
-- added in migration 110's follow-up fix) — needed once there's more
-- than one install of this app, or the business itself is ever based
-- somewhere other than Central time.

alter table app_settings add column if not exists timezone text;
update app_settings set timezone = 'America/Chicago' where id = 1 and timezone is null;
