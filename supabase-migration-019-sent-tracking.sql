-- Run in Supabase SQL Editor after migration 018. Safe to re-run.

alter table jobs add column if not exists proposal_sent_at timestamptz;
alter table jobs add column if not exists contract_sent_at timestamptz;
-- Invoice already has invoice_status ('not_sent'/'sent'/'paid'), which
-- already serves as its "has this been sent" signal — no new column needed.

alter table job_updates add column if not exists sent_at timestamptz;

-- Belt-and-suspenders: customers can only ever see updates that have
-- actually been sent, enforced at the database level, not just hidden
-- in the portal UI.
drop policy if exists "Customers can view updates on their own jobs" on job_updates;
create policy "Customers can view updates on their own jobs"
  on job_updates for select
  using (
    not is_admin()
    and sent_at is not null
    and exists (
      select 1 from jobs j
      where j.id = job_updates.job_id
      and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
    )
  );
