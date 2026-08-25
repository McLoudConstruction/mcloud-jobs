-- Run in Supabase SQL Editor after migration 054. Safe to re-run.
alter table subcontractor_applications add column if not exists decline_reason text;
alter table subcontractor_applications add column if not exists photo_storage_paths text[];
