-- Run in Supabase SQL Editor after migration 039. Safe to re-run.
--
-- job_estimate_items has only ever represented materials. Adding a
-- category so the same table can also hold subcontractor/labor cost
-- lines — same RLS, same realtime subscription, just rendered in a
-- separate section on the Estimate tab and summed together for the
-- cost subtotal.
alter table job_estimate_items add column if not exists category text not null default 'material'
  check (category in ('material', 'labor'));
