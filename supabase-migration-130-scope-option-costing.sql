-- Run in Supabase SQL Editor after migration 129. Safe to re-run.
--
-- Lets each scope option (migration 129, multi-option estimates) get its
-- price the same way the job's single scope always has: a full
-- materials/subcontractor cost build-up plus a margin, on the Cost tab —
-- not a manually typed number. The Cost (and Pricing) tab grows an
-- option switcher when the job is in multi-option mode, so each option's
-- cost items, margin and sales tax stay independent of the others.

-- job_estimate_items rows belong to the job as a whole (single-scope
-- jobs, and multi-option jobs' shared items, if any) unless tagged to a
-- specific scope option. Existing rows are untouched (option_id stays
-- null = the job's own base cost build).
alter table job_estimate_items add column if not exists option_id uuid references estimate_scope_options(id) on delete cascade;
create index if not exists job_estimate_items_option_id_idx on job_estimate_items (option_id);

-- Same margin/tax/cost-total fields jobs already carries (estimate_margin_percent,
-- estimate_sales_tax_percent, projected_cost), one set per option. `price`
-- already exists on estimate_scope_options (migration 129) and is reused
-- as the option's computed sale price — the Cost tab's "Save" now writes
-- here instead of job_financials.contract_price when the job is multi-option.
alter table estimate_scope_options add column if not exists estimate_margin_percent numeric;
alter table estimate_scope_options add column if not exists estimate_sales_tax_percent numeric;
alter table estimate_scope_options add column if not exists projected_cost numeric;

-- Realtime — job_estimate_items should already be published from when it
-- was first introduced, but this is idempotent and harmless if so.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_estimate_items'
  ) then
    alter publication supabase_realtime add table job_estimate_items;
  end if;
end $$;
