-- Run in Supabase SQL Editor after migration 028. Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════
-- Subcontractor profile — W9/COI on file, services offered, and COI
-- expiration so it's actually useful (COIs lapse) rather than just a blob.
-- ═══════════════════════════════════════════════════════════════════════
alter table companies add column if not exists w9_storage_path text;
alter table companies add column if not exists coi_storage_path text;
alter table companies add column if not exists coi_expires_at date;
alter table companies add column if not exists services_offered text[];

-- Private bucket for W9/COI documents, same pattern as the receipts bucket.
insert into storage.buckets (id, name, public)
values ('subcontractor-docs', 'subcontractor-docs', false)
on conflict (id) do nothing;

drop policy if exists "Admin full access to subcontractor-docs" on storage.objects;
create policy "Admin full access to subcontractor-docs" on storage.objects for all
  using (bucket_id = 'subcontractor-docs' and is_admin())
  with check (bucket_id = 'subcontractor-docs' and is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- Jobs — approved_at (drives sales-booked tracking, separate from the
-- existing cash-basis paid-invoice revenue) and projected_cost (the
-- budgeted cost set at pricing time, to compare against actual costs
-- as the job runs).
-- ═══════════════════════════════════════════════════════════════════════
alter table jobs add column if not exists approved_at timestamptz;
alter table jobs add column if not exists projected_cost numeric;
