-- Run in Supabase SQL Editor after migration 061. Safe to re-run.
--
-- Splits contract_price, invoice_amount, and invoice_status off the jobs
-- table into their own job_financials table. This exists so RLS can hide
-- financials from field crew entirely while still letting them see the
-- rest of a job — RLS is per-row, not per-column, so as long as these
-- fields lived on `jobs` there was no way to show a crew member the job
-- address without also exposing the contract price on the same row.
--
-- Deliberately NOT dropping the old columns from `jobs` yet. They're left
-- in place, unused by new code, until the app is redeployed against this
-- table and confirmed working — see migration 064 for the cleanup once
-- that's verified. Dropping them here would risk a window where deployed
-- code (including the Stripe webhook) still expects the old columns.

-- Placeholder role-check functions, defined FIRST — CREATE POLICY
-- validates its expression immediately, so the functions it references
-- have to exist before any policy below can be created. Both currently
-- just mean "admin," matching today's reality where only admin logins
-- exist. Once real pm/crew roles are added to app_metadata, these are
-- the only two functions that need to change — no RLS policy rewrites
-- required.
create or replace function is_staff()
returns boolean
language sql
stable
as $$
  select is_admin();
$$;

create or replace function is_pm()
returns boolean
language sql
stable
as $$
  select is_admin(); -- expand to: is_admin() or role = 'pm', once that role exists
$$;

create table if not exists job_financials (
  job_id uuid primary key references jobs(id) on delete cascade,

  contract_price numeric,
  invoice_amount numeric,
  invoice_status text default 'not_sent'
    check (invoice_status in ('not_sent','sent','paid')),

  updated_at timestamptz not null default now()
);

alter table job_financials enable row level security;

-- Admin: full access, including delete.
drop policy if exists "Admin can do everything on job_financials" on job_financials;
create policy "Admin can do everything on job_financials"
  on job_financials for all using (is_admin()) with check (is_admin());

-- PM: full financial visibility and edit rights, no delete.
drop policy if exists "PM can view and edit job_financials" on job_financials;
create policy "PM can view and edit job_financials"
  on job_financials for select using (is_pm());
drop policy if exists "PM can update job_financials" on job_financials;
create policy "PM can update job_financials"
  on job_financials for update using (is_pm()) with check (is_pm());
drop policy if exists "PM can insert job_financials" on job_financials;
create policy "PM can insert job_financials"
  on job_financials for insert with check (is_pm());

-- No policy for crew at all — default-deny means a crew session simply
-- gets zero rows back querying this table, full stop.

-- Customer: read-only, own job(s) only. This is required — the invoice
-- payment flow (app/api/payments/create-intent) reads invoice_amount and
-- invoice_status through the CUSTOMER's own session token as its actual
-- access check, not just a UI nicety. Without this policy, every
-- customer payment would break the moment this migration runs.
drop policy if exists "Customers can view financials on their own jobs" on job_financials;
create policy "Customers can view financials on their own jobs"
  on job_financials for select using (has_job_portal_access(job_id));

-- Backfill from the existing columns on jobs.
insert into job_financials (job_id, contract_price, invoice_amount, invoice_status)
select id, contract_price, invoice_amount, invoice_status
from jobs
on conflict (job_id) do update
  set contract_price = excluded.contract_price,
      invoice_amount = excluded.invoice_amount,
      invoice_status = excluded.invoice_status;

-- Keep updated_at current automatically.
drop trigger if exists set_job_financials_updated_at on job_financials;
create trigger set_job_financials_updated_at
  before update on job_financials
  for each row execute function set_updated_at();

-- Auto-create the matching job_financials row for every new job, so the
-- 1:1 relationship holds going forward without every job-creation call
-- site needing to remember to insert one manually.
create or replace function create_job_financials_row()
returns trigger
language plpgsql
as $$
begin
  insert into job_financials (job_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists create_job_financials_on_job_insert on jobs;
create trigger create_job_financials_on_job_insert
  after insert on jobs
  for each row execute function create_job_financials_row();

-- Real-time, matching the pattern used for jobs/job_updates/job_photos.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_financials'
  ) then
    alter publication supabase_realtime add table job_financials;
  end if;
end $$;

-- Also switch time_entries and checklist_items (migration 061) over to
-- is_staff() now that it exists, so crew can use those tables once the
-- real role work lands — today is_staff() still just means admin, so
-- this changes nothing about who has access right now.
drop policy if exists "Admin can do everything on time_entries" on time_entries;
create policy "Staff can do everything on time_entries"
  on time_entries for all using (is_staff()) with check (is_staff());

drop policy if exists "Admin can do everything on checklist_items" on checklist_items;
create policy "Staff can do everything on checklist_items"
  on checklist_items for all using (is_staff()) with check (is_staff());
