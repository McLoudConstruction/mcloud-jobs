-- Run in Supabase SQL Editor after migration 003.

-- ─── New job fields ──────────────────────────────────────────────────────
alter table jobs add column if not exists expected_close_date date;
alter table jobs add column if not exists job_type text;

-- ─── Contacts (Customer Info page) ──────────────────────────────────────
create table contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  management_company text,
  contact_phone text,
  contact_email text,
  property text,
  notes text,
  created_at timestamptz not null default now()
);

alter table contacts enable row level security;

create policy "Authenticated can do everything on contacts"
  on contacts for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter publication supabase_realtime add table contacts;

-- ─── Expanded settings: logo sizing, extra color, font, sign-out button ─
alter table app_settings add column if not exists logo_size_desktop int not null default 180;
alter table app_settings add column if not exists logo_size_mobile int not null default 120;
alter table app_settings add column if not exists color_panel text not null default '#d3d0b5';
alter table app_settings add column if not exists font_choice text not null default 'system';
alter table app_settings add column if not exists signout_bg text not null default 'transparent';
alter table app_settings add column if not exists signout_text text not null default '#49402a';
