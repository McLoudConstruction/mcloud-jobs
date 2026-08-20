-- Run in Supabase SQL Editor after migration 035. Safe to re-run.
--
-- Everything here is deliberately isolated from the rest of the schema —
-- new tables only, no changes to existing ones except one new column on
-- jobs for the margin. If this experiment doesn't work out, dropping
-- these two tables and that one column is a clean, contained removal.

-- Your own running price memory — never auto-applied anywhere, purely a
-- prefill convenience when adding a line item you've priced before.
create table if not exists material_prices (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  unit_label text,
  unit_price numeric not null,
  updated_at timestamptz not null default now()
);
create unique index if not exists material_prices_item_name_idx on material_prices (lower(item_name));

alter table material_prices enable row level security;
drop policy if exists "Admin full access to material_prices" on material_prices;
create policy "Admin full access to material_prices" on material_prices for all
  using (is_admin()) with check (is_admin());

-- Line items on a job's estimate. status distinguishes AI-suggested
-- starting points from manually-added rows, purely for a visual tag —
-- both are equally editable and equally non-binding until you say so.
create table if not exists job_estimate_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_label text,
  unit_price numeric not null default 0,
  source text not null default 'manual' check (source in ('manual', 'suggested')),
  buffer_note text, -- e.g. "Framing lumber — consider buying extra for waste/cuts"
  created_at timestamptz not null default now()
);

alter table job_estimate_items enable row level security;
drop policy if exists "Admin full access to job_estimate_items" on job_estimate_items;
create policy "Admin full access to job_estimate_items" on job_estimate_items for all
  using (is_admin()) with check (is_admin());

alter table jobs add column if not exists estimate_margin_percent numeric;
