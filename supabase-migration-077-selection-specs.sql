-- Run in Supabase SQL Editor after migration 076. Safe to re-run.
--
-- Holds whatever extra spec rows the retailer's page provides beyond the
-- dedicated color/height/width/depth columns (door handing, heating
-- type, frame material, etc.) — deliberately open-ended rather than a
-- fixed per-category schema, since the set of fields differs by product
-- type and the retailer's own page already has them labeled.

alter table material_selection_options
  add column if not exists specs jsonb not null default '{}'::jsonb;
