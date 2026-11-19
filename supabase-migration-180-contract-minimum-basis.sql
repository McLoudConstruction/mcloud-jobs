-- Run in Supabase SQL Editor after migration 179.
-- Safe to run more than once.
--
-- Adds the choice of what the contract minimum is measured against:
--   'base'            = the contract price only (default)
--   'contract_value'  = contract price + accepted change orders (signed by both sides)

alter table app_settings add column if not exists contract_min_basis text not null default 'base';
alter table app_settings drop constraint if exists app_settings_contract_min_basis_check;
alter table app_settings add constraint app_settings_contract_min_basis_check check (contract_min_basis in ('base', 'contract_value'));

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
  v_basis text;
  v_price numeric;
begin
  v_is_owner := exists (select 1 from staff_users s where s.id = auth.uid() and s.role = 'owner' and s.status = 'active');
  v_is_staff := exists (select 1 from staff_users s where s.id = auth.uid() and s.status = 'active');

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

    select case when new.project_type = 'commercial' then s.contract_min_commercial else s.contract_min_residential end,
           s.contract_min_basis
      into v_min, v_basis from app_settings s where s.id = 1;
    select coalesce(f.contract_price, 0) into v_price from job_financials f where f.job_id = new.id;
    v_price := coalesce(v_price, 0);

    if v_basis = 'contract_value' then
      v_price := v_price + coalesce((
        select sum(coalesce(c.amount, 0)) from change_orders c
        where c.job_id = new.id
          and nullif(c.co_signatures->>'contractor', '') is not null
          and nullif(c.co_signatures->>'owner', '') is not null
      ), 0);
    end if;

    if coalesce(v_min, 0) > 0 and v_price < v_min
       and not (new.min_override_at is not null and v_price >= coalesce(new.min_override_price, 0)) then
      if v_is_staff then
        raise exception 'BELOW_MINIMUM: this % contract ($%) is under the $% minimum. An owner must override it before it can be approved.',
          case when new.project_type = 'commercial' then 'commercial' else 'residential' end,
          v_price, v_min;
      else
        new.stage := old.stage;
        new.approved_at := old.approved_at;
        new.below_minimum_flagged_at := now();
      end if;
    end if;
  end if;

  return new;
end;
$$;
