-- Run in Supabase SQL Editor after migration 075. Safe to re-run.
--
-- Height/width/depth as free-text fields (like color), not numeric +
-- unit columns, since captured values arrive as retailer-formatted
-- strings ("24 in.", "60 cm") and manual entries won't always agree
-- on a single unit.

alter table material_selection_options
  add column if not exists height text,
  add column if not exists width text,
  add column if not exists depth text;
