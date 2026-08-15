-- Run this in Supabase SQL Editor after migration 002.
-- Adds app-wide settings (logo + color theme) and a storage bucket for the logo file.

-- ─── Settings (single row) ──────────────────────────────────────────────
create table app_settings (
  id int primary key default 1,
  logo_url text,
  color_bg text not null default '#dbd8bf',
  color_heading text not null default '#49402a',
  color_accent text not null default '#8a3d14',
  updated_at timestamptz not null default now()
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

alter table app_settings enable row level security;

create policy "Authenticated can read settings"
  on app_settings for select
  using (auth.role() = 'authenticated');

create policy "Authenticated can update settings"
  on app_settings for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter publication supabase_realtime add table app_settings;

-- ─── Storage bucket for the logo file ───────────────────────────────────
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

create policy "Public read of branding assets"
  on storage.objects for select
  using (bucket_id = 'branding');

create policy "Authenticated can upload branding assets"
  on storage.objects for insert
  with check (bucket_id = 'branding' and auth.role() = 'authenticated');

create policy "Authenticated can update branding assets"
  on storage.objects for update
  using (bucket_id = 'branding' and auth.role() = 'authenticated');

create policy "Authenticated can delete branding assets"
  on storage.objects for delete
  using (bucket_id = 'branding' and auth.role() = 'authenticated');
