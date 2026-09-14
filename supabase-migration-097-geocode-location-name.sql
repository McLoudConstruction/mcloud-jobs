-- Run in Supabase SQL Editor after migration 096. Safe to re-run.
--
-- Backs the location label on the dashboard weather ribbon (e.g.
-- "Raytown, MO"). geocode_cache already stores lat/lng per city/zip —
-- this just keeps the human-readable name alongside it instead of
-- needing a second lookup for display purposes.

alter table geocode_cache add column if not exists name text;
