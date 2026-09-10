-- Run in Supabase SQL Editor after migration 078. Safe to re-run.
--
-- Adds internal staff accounts with roles (owner, general_manager,
-- project_manager, bookkeeper). Every internal page previously checked
-- a single flat auth.users.app_metadata.role === 'admin' flag with no
-- distinction between staff — this table + role replaces that.
--
-- Role/status live in this table rather than in JWT custom claims so
-- that a role change (or disabling an account) takes effect on the next
-- page load instead of waiting on the JWT to expire and refresh.

create table if not exists staff_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('owner', 'general_manager', 'project_manager', 'bookkeeper')),
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table staff_users enable row level security;

-- Security definer function, same pattern as migration 057's
-- is_sub_portal_member: a policy on staff_users that queries
-- staff_users to check "is the caller an owner" recurses into itself
-- under RLS. This function runs with owner privileges internally,
-- bypassing RLS on its own lookup, so it's safe to call from inside a
-- staff_users policy.
create or replace function is_staff_owner(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from staff_users
    where id = uid and role = 'owner' and status = 'active'
  );
$$;
grant execute on function is_staff_owner(uuid) to authenticated;

-- General-purpose helper for RLS policies elsewhere that want to key off
-- the caller's staff role (e.g. restricting a financials table to
-- owner/general_manager/bookkeeper down the road). Returns null if the
-- caller has no active staff_users row.
create or replace function current_staff_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from staff_users where id = auth.uid() and status = 'active';
$$;
grant execute on function current_staff_role() to authenticated;

drop policy if exists "Staff can view own row" on staff_users;
create policy "Staff can view own row" on staff_users for select using (
  auth.uid() = id or is_staff_owner(auth.uid())
);

drop policy if exists "Owner can insert staff" on staff_users;
create policy "Owner can insert staff" on staff_users for insert with check (
  is_staff_owner(auth.uid())
);

drop policy if exists "Owner can update staff" on staff_users;
create policy "Owner can update staff" on staff_users for update using (
  is_staff_owner(auth.uid())
);

drop policy if exists "Owner can delete staff" on staff_users;
create policy "Owner can delete staff" on staff_users for delete using (
  is_staff_owner(auth.uid())
);

-- ============================================================
-- REQUIRED MANUAL STEP before running this migration:
-- Replace the placeholder emails below with the real login email(s)
-- for the account(s) that should become Owner. This backfills your
-- existing admin account(s) into staff_users so nobody is locked out
-- once role enforcement goes live. Add more rows to the `in (...)`
-- list if there are more than two.
-- ============================================================
insert into staff_users (id, email, full_name, role, status)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', u.email), 'owner', 'active'
from auth.users u
where u.email in ('REPLACE_WITH_OWNER_EMAIL_1', 'REPLACE_WITH_OWNER_EMAIL_2')
on conflict (id) do update set role = 'owner', status = 'active';
