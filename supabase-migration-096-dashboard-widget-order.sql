-- Run in Supabase SQL Editor after migration 095. Safe to re-run.
--
-- Backs the drag-and-drop dashboard widget reordering in Settings →
-- Dashboard. Stored as a plain jsonb array of widget keys (see
-- lib/dashboardWidgets.js for the canonical key list) — an empty array
-- means "no custom order yet," and the app falls back to the default
-- order in that case rather than needing a special-cased null check
-- everywhere this is read.

alter table app_settings add column if not exists dashboard_widget_order jsonb not null default '[]'::jsonb;
