-- Run in Supabase SQL Editor after migration 074. Safe to re-run.
--
-- Adds columns so material_selection_options can hold items captured
-- from a retailer's product page (Home Depot, Lowe's, etc.) via the
-- browser bookmarklet, alongside the existing manually-added options.
-- photo_external_url is separate from photo_storage_path: captured
-- photos are hotlinked from the retailer's CDN rather than uploaded to
-- our private bucket, since the bookmarklet only has a URL, not a file.

alter table material_selection_options
  add column if not exists source_url text,
  add column if not exists price_cents integer,
  add column if not exists photo_external_url text,
  add column if not exists captured_via text;
