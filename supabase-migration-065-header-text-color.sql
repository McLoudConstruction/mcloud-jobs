-- Run in Supabase SQL Editor after migration 064. Safe to re-run.
--
-- The brand_color setting (migration 038) only ever drives button/accent
-- colors — the header text color has been hardcoded (#f0ede8) since the
-- header itself is fixed dark chrome in both light and dark mode by
-- design. This adds a separate, optional color for header text/logo
-- specifically. Null means "use the current hardcoded default," so
-- nobody's header changes until they actually pick a color.
alter table app_settings add column if not exists header_text_color text;
