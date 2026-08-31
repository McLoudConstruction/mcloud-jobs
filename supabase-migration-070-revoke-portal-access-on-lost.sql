-- Run in Supabase SQL Editor after migration 069. Safe to re-run.
--
-- Closing an opportunity as lost should actually revoke the customer's
-- portal access to it, not just change a badge. Every customer-facing RLS
-- policy in this app already funnels through has_job_portal_access() —
-- jobs, job_updates, material_selections, change_orders, job_portal_access
-- itself, the mark_*_viewed functions, all of it — so adding one guard
-- here is a real, comprehensive revoke rather than something that has to
-- be repeated per table and can be forgotten somewhere.
--
-- Important: this checks CURRENT job.stage on every query, dynamically —
-- it doesn't need a separate "access revoked" flag. Reopening a lost job
-- (see app/jobs/[id]/page.js) restores portal access immediately, with
-- nothing extra to re-grant.

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
          and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
      )
      or exists (
        select 1 from job_portal_access jpa
        where jpa.job_id = target_job_id
          and jpa.email = auth.jwt()->>'email'
          and jpa.portal_access = true
      )
    );
$$;

grant execute on function has_job_portal_access(uuid) to authenticated;
