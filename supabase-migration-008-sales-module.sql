-- Run in Supabase SQL Editor after migration 007.

-- ─── Contact Database: property-type categorization ─────────────────────
alter table contacts add column if not exists contact_type text;
-- Expected values (kept as free text so you can adjust later without a migration):
-- Multi-Family, Commercial - Office, Commercial - Retail, Commercial - Industrial,
-- Hospitality, Senior Living, Education, Religious - Churches, Government,
-- Residential - Homeowner, Residential - Investor

-- ─── Property Database ───────────────────────────────────────────────────
create table properties (
  id uuid primary key default gen_random_uuid(),
  property_name text not null,
  property_type text,
  property_street text,
  property_unit text,
  property_city text,
  property_state text,
  property_zip text,
  management_company text,
  contact_name text,
  contact_phone text,
  contact_email text,
  year_built text,
  sq_ft text,
  target_value numeric,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

alter table properties enable row level security;

create policy "Authenticated can do everything on properties"
  on properties for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter publication supabase_realtime add table properties;

-- ─── Sales Dashboard: opportunities pipeline ─────────────────────────────
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  company text,
  project text,
  contact_name text,
  anticipated_timeline text,
  date_taken date default current_date,
  stage text not null default 'prospecting'
    check (stage in ('prospecting','contacted','proposal','won','lost')),
  loss_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at_opportunities()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger opportunities_set_updated_at
before update on opportunities
for each row execute function set_updated_at_opportunities();

alter table opportunities enable row level security;

create policy "Authenticated can do everything on opportunities"
  on opportunities for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter publication supabase_realtime add table opportunities;
