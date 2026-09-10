-- Run in Supabase SQL Editor after migration 079. Safe to re-run.
-- Lets a Project Manager flag a job as ready to invoice without needing
-- to change its stage (which they can already do) or having Financials
-- access (which they don't) — a lightweight signal to the office,
-- separate from the Completed/Invoiced stage transitions.

alter table jobs add column if not exists ready_to_invoice boolean not null default false;
alter table jobs add column if not exists ready_to_invoice_at timestamptz;
alter table jobs add column if not exists ready_to_invoice_by uuid references auth.users(id);
