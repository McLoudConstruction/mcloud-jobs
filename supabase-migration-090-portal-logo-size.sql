-- Run in Supabase SQL Editor after migration 089. Safe to re-run.
--
-- Decouples the customer/subcontractor portal logo size from the main
-- app's logo_size_desktop/logo_size_mobile. Previously CustomerPortalShell
-- and SubPortalShell read the same two columns as the internal staff
-- AppShell sidebar — so a size picked to fit the compact staff sidebar
-- was forced onto the much roomier customer- and subcontractor-facing
-- portal headers too, making that logo look tiny there.

alter table app_settings
  add column if not exists portal_logo_size_desktop integer not null default 64;

alter table app_settings
  add column if not exists portal_logo_size_mobile integer not null default 48;
