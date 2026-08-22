-- Run in Supabase SQL Editor after migration 046. Safe to re-run.
--
-- Budget baseline is jobs.projected_cost — already pushed there by the
-- "Use as this Job's Contract Price" button on the Estimate tab, so the
-- generation step already exists. What's new here is actually watching
-- for it being crossed.

alter table jobs add column if not exists over_budget_notified boolean not null default false;

create or replace function check_job_over_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_job_id uuid := coalesce(NEW.job_id, OLD.job_id);
  v_budget numeric;
  v_total numeric;
  v_already_notified boolean;
  v_job_number text;
  v_customer_name text;
begin
  select projected_cost, over_budget_notified, job_number, customer_name
  into v_budget, v_already_notified, v_job_number, v_customer_name
  from jobs where id = affected_job_id;

  if v_budget is null or v_budget <= 0 then
    return coalesce(NEW, OLD);
  end if;

  select coalesce(sum(amount), 0) into v_total from job_costs where job_id = affected_job_id;

  if v_total > v_budget and not v_already_notified then
    insert into notifications (job_id, message)
    values (
      affected_job_id,
      format('Over budget: Job %s is now %s over its %s budget (%s spent/committed vs %s budgeted).',
        coalesce(v_job_number, v_customer_name, ''),
        to_char(v_total - v_budget, 'FM$999,999,990.00'),
        to_char(v_budget, 'FM$999,999,990.00'),
        to_char(v_total, 'FM$999,999,990.00'),
        to_char(v_budget, 'FM$999,999,990.00')
      )
    );
    update jobs set over_budget_notified = true where id = affected_job_id;
  elsif v_total <= v_budget and v_already_notified then
    -- Fell back under budget (e.g. an incorrect cost got removed) —
    -- reset so a future overage notifies again instead of staying silent.
    update jobs set over_budget_notified = false where id = affected_job_id;
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists job_costs_budget_check on job_costs;
create trigger job_costs_budget_check
  after insert or update or delete on job_costs
  for each row execute function check_job_over_budget();
