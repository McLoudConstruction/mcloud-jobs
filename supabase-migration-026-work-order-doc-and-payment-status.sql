-- Run in Supabase SQL Editor after migration 025. Safe to re-run.

-- Work orders now snapshot which specific scope-of-work items apply to
-- that subcontractor, as actual text (not indices) so it stays correct
-- even if the job's scope list is edited later.
alter table work_orders add column if not exists included_scope_items jsonb default '[]'::jsonb;
alter table work_orders add column if not exists sent_at timestamptz;

-- A receipt or business expense may already be paid (e.g. a Home Depot
-- run charged to a card) even though the card statement isn't due yet —
-- separate from work orders, which track their own status already.
alter table receipts add column if not exists payment_status text not null default 'paid'
  check (payment_status in ('paid','unpaid'));
alter table business_expenses add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('paid','unpaid'));
