-- Run in Supabase SQL Editor after migration 144. Safe to re-run.
--
-- A per-person home address for the Route Builder ("Use home" fills the
-- Starting location). Stored as plain text; the map looks it up when used.
-- staff_users can only be updated by the owner, so each person sets their
-- own through a small function that touches only their own row.

alter table staff_users add column if not exists home_address text;

create or replace function set_my_home_address(new_address text)
returns void
language sql
security definer
set search_path = public
as $$
  update staff_users
     set home_address = nullif(btrim(new_address), '')
   where id = auth.uid();
$$;

revoke all on function set_my_home_address(text) from public;
grant execute on function set_my_home_address(text) to authenticated;
