-- Run in Supabase SQL Editor after migration 056. Safe to re-run.
-- Fixes infinite RLS recursion introduced in migration 054. The
-- "Sub user can view own company roster" policy on sub_portal_users
-- checked membership by querying sub_portal_users from inside its own
-- policy — Postgres has to re-apply that same policy to evaluate the
-- subquery, which recurses forever. That recursion doesn't stay
-- contained to sub_portal_users either: companies' "Sub can view own
-- company" policy (and work_orders', and the sub_visible_jobs view)
-- all check membership the same way, so they inherited the same crash
-- (visible as companies queries returning 500).
--
-- Fix: move the membership check into a security definer function.
-- Security definer functions run with the privileges of their owner,
-- which bypasses RLS on the tables they query internally — so checking
-- "is this email a member of this company" from inside a policy no
-- longer re-triggers that same policy.

create or replace function is_sub_portal_member(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from sub_portal_users
    where company_id = target_company_id and email = auth.jwt()->>'email'
  );
$$;
grant execute on function is_sub_portal_member(uuid) to authenticated;

drop policy if exists "Sub user can view own company roster" on sub_portal_users;
create policy "Sub user can view own company roster" on sub_portal_users for select using (
  is_sub_portal_member(company_id)
);

drop policy if exists "Sub can view own company" on companies;
create policy "Sub can view own company" on companies for select using (
  is_sub_portal_member(id)
);

drop policy if exists "Sub company can view own work orders" on work_orders;
create policy "Sub company can view own work orders" on work_orders for select using (
  is_sub_portal_member(company_id)
);

create or replace view sub_visible_jobs as
select distinct j.id, j.job_number, j.project_address, j.job_type, j.stage, j.expected_close_date
from jobs j
where exists (
  select 1 from work_orders wo
  where wo.job_id = j.id and is_sub_portal_member(wo.company_id)
);

grant select on sub_visible_jobs to authenticated;
