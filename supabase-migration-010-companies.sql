-- Run in Supabase SQL Editor after migration 009.
-- Safe to run more than once — every step below skips anything already in place.

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  company_type text, -- Management Company, Ownership Group, REIT, Developer, Other
  street text,
  unit text,
  city text,
  state text,
  zip text,
  contact_name text,
  contact_phone text,
  contact_email text,
  notes text,
  created_at timestamptz not null default now()
);

alter table companies enable row level security;

drop policy if exists "Admin can do everything on companies" on companies;
create policy "Admin can do everything on companies"
  on companies for all using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'companies'
  ) then
    alter publication supabase_realtime add table companies;
  end if;
end $$;

-- Optional links from Contacts/Properties to the company they belong to
alter table contacts add column if not exists company_id uuid references companies(id) on delete set null;
alter table properties add column if not exists company_id uuid references companies(id) on delete set null;
