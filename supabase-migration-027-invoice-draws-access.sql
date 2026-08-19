-- Run in Supabase SQL Editor after migration 026. Safe to re-run.

-- Customers need to be able to see their own job's draws in the portal,
-- same email-matching pattern used for jobs/change_orders/job_updates.
drop policy if exists "Customer can view own invoices" on invoices;
create policy "Customer can view own invoices" on invoices for select using (
  exists (
    select 1 from jobs j
    where j.id = invoices.job_id
      and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
  )
);
