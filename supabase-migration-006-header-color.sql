-- Run in Supabase SQL Editor after migration 005.
alter table app_settings add column if not exists color_header text not null default '#d3d0b5';
