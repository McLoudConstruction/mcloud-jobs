-- Run in Supabase SQL Editor after migration 037. Safe to re-run.
--
-- Replaces the old scheme of picking every individual color by hand
-- (page bg, header bg, sidebar bg/text, headings, accent — 9 separate
-- fields) with one brand color that the app derives light-mode-safe and
-- dark-mode-safe accent variants from automatically. The old color_*
-- columns are left in place (harmless, unused) rather than dropped, in
-- case any of that data is ever wanted back.
alter table app_settings add column if not exists brand_color text;
