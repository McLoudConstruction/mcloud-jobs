-- Run in Supabase SQL Editor after migration 051. Safe to re-run.
-- Lets the office invite a prospective subcontractor (someone who isn't a
-- company record yet) to submit their own company info, W9, and COI
-- through a public link — separate from the sub-portal, which is only for
-- subs the office has already onboarded and issued work orders to.

create table if not exists subcontractor_applications (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid() unique,
  invited_email text not null,
  invited_company_hint text,
  invited_by text,
  status text not null default 'invited' check (status in ('invited', 'submitted', 'approved', 'declined')),
  company_name text,
  contact_name text,
  contact_phone text,
  contact_email text,
  street text,
  unit text,
  city text,
  state text,
  zip text,
  services_offered text[],
  notes text,
  w9_storage_path text,
  coi_storage_path text,
  coi_expires_at date,
  invited_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_company_id uuid references companies(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table subcontractor_applications enable row level security;

-- Admin-only from the client side — the public application page never
-- talks to Supabase directly, it goes through service-role API routes,
-- so there is no public RLS policy on this table at all.
drop policy if exists "Admin can do everything on subcontractor_applications" on subcontractor_applications;
create policy "Admin can do everything on subcontractor_applications"
  on subcontractor_applications for all using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subcontractor_applications'
  ) then
    alter publication supabase_realtime add table subcontractor_applications;
  end if;
end $$;
