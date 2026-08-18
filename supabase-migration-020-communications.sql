-- Run in Supabase SQL Editor after migration 019. Safe to re-run.

alter table jobs add column if not exists portal_last_viewed_at timestamptz;
alter table change_orders add column if not exists sent_at timestamptz;

-- Customers can't UPDATE the jobs table at all today (only admin can), and
-- we don't want to open that up broadly just for one timestamp. This
-- function lets a customer update *only* their own job's last-viewed time,
-- nothing else — it runs with elevated privileges internally but checks
-- the caller's email matches the job before touching anything.
create or replace function mark_portal_viewed(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update jobs
  set portal_last_viewed_at = now()
  where id = target_job_id
  and (customer_email = auth.jwt()->>'email' or billing_email = auth.jwt()->>'email');
end;
$$;

grant execute on function mark_portal_viewed(uuid) to authenticated;
