-- Run in Supabase SQL Editor after migration 092. Safe to re-run.
--
-- has_job_portal_access() is the single gate behind every customer-facing
-- RLS policy in this app (jobs, invoices, change orders, job_photos,
-- payments authorization via /api/payments/create-intent, all of it). Until
-- now it matched emails with exact `=`, which is case-sensitive in Postgres.
-- Staff type customer emails freely in several places (job creation, the
-- Customer tab, Portal Access card) with no normalization, so a casing
-- difference between what staff typed and what the customer signs in with
-- silently produced "No active project" — indistinguishable from having no
-- access at all, including for the ability to view or pay an invoice.
--
-- This makes the match case-insensitive and trims whitespace on both sides.
-- Purely widening: it can only grant access in cases that previously failed
-- to match, never remove access that worked before. No data changes needed
-- — the comparison happens dynamically on every query.

create or replace function has_job_portal_access(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from jobs where id = target_job_id and stage <> 'lost')
    and (
      exists (
        select 1 from jobs j
        where j.id = target_job_id
          and (
            lower(trim(j.customer_email)) = lower(trim(auth.jwt()->>'email'))
            or lower(trim(j.billing_email)) = lower(trim(auth.jwt()->>'email'))
          )
      )
      or exists (
        select 1 from job_portal_access jpa
        where jpa.job_id = target_job_id
          and lower(trim(jpa.email)) = lower(trim(auth.jwt()->>'email'))
          and jpa.portal_access = true
      )
    );
$$;

grant execute on function has_job_portal_access(uuid) to authenticated;
