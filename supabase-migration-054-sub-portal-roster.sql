-- Run in Supabase SQL Editor after migration 053. Safe to re-run.
-- Replaces the old "one admin login + one crew login" model (companies.
-- contact_email / companies.crew_email) with a real roster so a sub can
-- have any number of logins, each with its own role. Old columns are left
-- in place (still shown/edited from the office side) and backfilled in
-- here, but RLS/auth now runs off this table going forward.

create table if not exists sub_portal_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'crew')), -- 'admin' = Owner/Manager (can accept/decline & sign work orders, manage the roster); 'crew' = view only
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

alter table sub_portal_users enable row level security;

drop policy if exists "Admin can do everything on sub_portal_users" on sub_portal_users;
create policy "Admin can do everything on sub_portal_users" on sub_portal_users
  for all using (is_admin()) with check (is_admin());

-- A sub-portal user can see the rest of their own company's roster (so an
-- Owner/Manager can see who else has a login). Reads only — inserts and
-- removals go through the secure functions below so a crew login can
-- never grant itself admin or touch another company's roster.
drop policy if exists "Sub user can view own company roster" on sub_portal_users;
create policy "Sub user can view own company roster" on sub_portal_users for select using (
  exists (
    select 1 from sub_portal_users me
    where me.email = auth.jwt()->>'email' and me.company_id = sub_portal_users.company_id
  )
);

-- Backfill from the legacy two columns.
insert into sub_portal_users (company_id, email, role, invited_at)
select id, contact_email, 'admin', portal_invited_at from companies
where contact_email is not null and contact_email <> ''
on conflict (company_id, email) do nothing;

insert into sub_portal_users (company_id, email, role, invited_at)
select id, crew_email, 'crew', portal_invited_at from companies
where crew_email is not null and crew_email <> ''
on conflict (company_id, email) do update set role = 'crew' where sub_portal_users.role is distinct from 'crew';

-- ═══════════════════════════════════════════════════════════════════════
-- Re-point the sub-portal auth surface at the new roster table.
-- ═══════════════════════════════════════════════════════════════════════
create or replace view sub_visible_jobs as
select distinct j.id, j.job_number, j.project_address, j.job_type, j.stage, j.expected_close_date
from jobs j
where exists (
  select 1 from work_orders wo
  join sub_portal_users spu on spu.company_id = wo.company_id
  where wo.job_id = j.id and spu.email = auth.jwt()->>'email'
);

drop policy if exists "Sub can view own company" on companies;
create policy "Sub can view own company" on companies for select using (
  exists (select 1 from sub_portal_users spu where spu.company_id = companies.id and spu.email = auth.jwt()->>'email')
);

drop policy if exists "Sub company can view own work orders" on work_orders;
create policy "Sub company can view own work orders" on work_orders for select using (
  exists (
    select 1 from sub_portal_users spu
    where spu.company_id = work_orders.company_id and spu.email = auth.jwt()->>'email'
  )
);

create or replace function accept_work_order(target_work_order_id uuid, signature_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  wo_company_id uuid;
begin
  select company_id into wo_company_id from work_orders where id = target_work_order_id;
  if wo_company_id is null then
    raise exception 'Work order not found';
  end if;
  if not exists (select 1 from sub_portal_users where company_id = wo_company_id and email = caller_email and role = 'admin') then
    raise exception 'Not authorized to accept this work order';
  end if;
  update work_orders
  set status = 'accepted', accepted_at = now(), sub_signature = signature_payload, declined_at = null, decline_reason = null
  where id = target_work_order_id;
end;
$$;
grant execute on function accept_work_order(uuid, jsonb) to authenticated;

create or replace function decline_work_order(target_work_order_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  wo_company_id uuid;
begin
  select company_id into wo_company_id from work_orders where id = target_work_order_id;
  if wo_company_id is null then
    raise exception 'Work order not found';
  end if;
  if not exists (select 1 from sub_portal_users where company_id = wo_company_id and email = caller_email and role = 'admin') then
    raise exception 'Not authorized to decline this work order';
  end if;
  update work_orders
  set status = 'declined', declined_at = now(), decline_reason = reason, accepted_at = null, sub_signature = null
  where id = target_work_order_id;
end;
$$;
grant execute on function decline_work_order(uuid, text) to authenticated;

create or replace function mark_sub_portal_viewed(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
begin
  if not exists (select 1 from sub_portal_users where company_id = target_company_id and email = caller_email) then
    raise exception 'Not authorized';
  end if;
  update companies set portal_last_viewed_at = now() where id = target_company_id;
end;
$$;
grant execute on function mark_sub_portal_viewed(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Roster management — callable by an existing 'admin' (Owner/Manager) at
-- the company, so a sub can add/remove their own team's logins without
-- needing the office to do it. add_sub_portal_user upserts (so re-adding
-- an existing email just updates their role). remove_sub_portal_user
-- blocks removing the last admin, so a company can never lock itself out.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function add_sub_portal_user(target_company_id uuid, new_email text, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
begin
  if new_role not in ('admin', 'crew') then
    raise exception 'Invalid role';
  end if;
  if not exists (select 1 from sub_portal_users where company_id = target_company_id and email = caller_email and role = 'admin') then
    raise exception 'Not authorized to manage this roster';
  end if;
  insert into sub_portal_users (company_id, email, role, invited_at)
  values (target_company_id, lower(trim(new_email)), new_role, now())
  on conflict (company_id, email) do update set role = excluded.role, invited_at = coalesce(sub_portal_users.invited_at, excluded.invited_at);
end;
$$;
grant execute on function add_sub_portal_user(uuid, text, text) to authenticated;

create or replace function remove_sub_portal_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  target_company_id uuid;
  target_role text;
  admin_count int;
begin
  select company_id, role into target_company_id, target_role from sub_portal_users where id = target_id;
  if target_company_id is null then
    raise exception 'User not found';
  end if;
  if not exists (select 1 from sub_portal_users where company_id = target_company_id and email = caller_email and role = 'admin') then
    raise exception 'Not authorized to manage this roster';
  end if;
  if target_role = 'admin' then
    select count(*) into admin_count from sub_portal_users where company_id = target_company_id and role = 'admin';
    if admin_count <= 1 then
      raise exception 'Every subcontractor needs at least one Owner/Manager login — add another before removing this one.';
    end if;
  end if;
  delete from sub_portal_users where id = target_id;
end;
$$;
grant execute on function remove_sub_portal_user(uuid) to authenticated;
