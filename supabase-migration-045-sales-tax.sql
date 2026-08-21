-- Run in Supabase SQL Editor after migration 044. Safe to re-run.
alter table jobs add column if not exists estimate_sales_tax_percent numeric;
