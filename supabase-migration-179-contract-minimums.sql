-- Run in Supabase SQL Editor after migration 178.
-- Safe to run more than once.
--
-- Contract minimums: one for residential, one for commercial (Settings > Automation).
-- A job whose contract price is under its minimum cannot move to Approved until an owner
-- records an override on the job. Blank / 0 = no minimum.

alter table app_settings add column if not exists contract_min_residential numeric;
alter table app_settings add column if not exists contract_min_commercial numeric;

-- Override record on the job. Only an owner can write these (enforced by the trigger below).
alter table jobs add column if not exists min_override_at timestamptz;
alter table jobs add column if not exists min_override_by text;      -- owner's name at the time
alter table jobs add column if not exists min_override_price numeric; -- the (under-minimum) price that was approved
alter table jobs add column if not exists min_override_note text;
-- Set when a customer-signed contract came in under the minimum and was held back from Approved.
alter table jobs add column if not exists below_minimum_flagged_at timestamptz;

create or replace function enforce_contract_minimum()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
  v_is_staff boolean;
  v_min numeric;
  v_price numeric;
begin
  v_is_owner := exists (select 1 from staff_users s where s.id = auth.uid() and s.role = 'owner' and s.status = 'active');
  v_is_staff := exists (select 1 from staff_users s where s.id = auth.uid() and s.status = 'active');

  -- Only an owner may set, change or clear the override. (No signed-in user = SQL Editor / service role: allowed.)
  if tg_op = 'UPDATE' and auth.uid() is not null and not v_is_owner and (
       new.min_override_at    is distinct from old.min_override_at
    or new.min_override_by    is distinct from old.min_override_by
    or new.min_override_price is distinct from old.min_override_price
    or new.min_override_note  is distinct from old.min_override_note
  ) then
    raise exception 'Only an owner can override the contract minimum.';
  end if;

  if tg_op = 'UPDATE'
     and new.stage = 'approved'
     and old.stage in ('new', 'inspected', 'proposal_delivered', 'lost') then

    select case when new.project_type = 'commercial' then s.contract_min_commercial else s.contract_min_residential end
      into v_min from app_settings s where s.id = 1;
    select f.contract_price into v_price from job_financials f where f.job_id = new.id;

    if coalesce(v_min, 0) > 0 and coalesce(v_price, 0) < v_min
       and not (new.min_override_at is not null and coalesce(v_price, 0) >= coalesce(new.min_override_price, 0)) then
      if v_is_staff then
        raise exception 'BELOW_MINIMUM: this % contract ($%) is under the $% minimum. An owner must override it before it can be approved.',
          case when new.project_type = 'commercial' then 'commercial' else 'residential' end,
          coalesce(v_price, 0), v_min;
      else
        -- A customer signing: let the signature stand, but hold the job at its current stage and flag it.
        new.stage := old.stage;
        new.approved_at := old.approved_at;
        new.below_minimum_flagged_at := now();
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists jobs_enforce_contract_minimum on jobs;
create trigger jobs_enforce_contract_minimum
  before update on jobs
  for each row execute function enforce_contract_minimum();
