-- Run in Supabase SQL Editor after migration 015. Safe to re-run.
alter table app_settings add column if not exists watermark_logo_url text;
-- Falls back to the main logo_url if this is left empty.
