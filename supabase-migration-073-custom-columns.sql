-- Run in Supabase SQL Editor after migration 072. Safe to re-run.
--
-- Generic "add a column" support for the three list views that are each a
-- single real table of records — Companies, Customers (contacts), and
-- Properties. Financials, Invoices, and Estimating are deliberately left
-- out: those views are assembled from several different underlying
-- tables (jobs, job_costs, work_orders, receipts, business_expenses),
-- so there's no single row a custom field could attach to.
--
-- custom_columns holds the column DEFINITIONS — one row per named column
-- per table. The actual per-record values live in that record's own
-- custom_fields jsonb, keyed by column_key. Because the Subcontractors
-- screen is just the companies table filtered to
-- company_type = 'Subcontractor', a column added from either the
-- Companies or Subcontractors screen lives on the same companies row and
-- shows up on both — that's a feature of sharing one real table, not a
-- bug.

create table if not exists custom_columns (
  id uuid primary key default gen_random_uuid(),
  table_name text not null check (table_name in ('companies', 'contacts', 'properties')),
  column_key text not null,
  label text not null,
  field_type text not null default 'text' check (field_type in ('text', 'number', 'date', 'dropdown')),
  options jsonb not null default '[]', -- dropdown choices only; ignored for other types
  created_at timestamptz not null default now(),
  unique (table_name, column_key)
);

alter table custom_columns enable row level security;

drop policy if exists "Admin can do everything on custom_columns" on custom_columns;
create policy "Admin can do everything on custom_columns"
  on custom_columns for all using (is_admin()) with check (is_admin());

alter table companies add column if not exists custom_fields jsonb not null default '{}';
alter table contacts add column if not exists custom_fields jsonb not null default '{}';
alter table properties add column if not exists custom_fields jsonb not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'custom_columns'
  ) then
    alter publication supabase_realtime add table custom_columns;
  end if;
end $$;
