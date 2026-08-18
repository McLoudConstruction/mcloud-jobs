-- Run in Supabase SQL Editor after migration 017. Safe to re-run.
alter table jobs add column if not exists contract_finalized_at timestamptz;
-- Once set, the contract document becomes a locked, read-only, signed record.
