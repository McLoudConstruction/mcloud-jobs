-- Run in Supabase SQL Editor after migration 146. Safe to re-run.
--
-- Adds a 'saved' status to sales_routes: a route that is built but not
-- being driven. Any number can be saved at once; only one route is ever
-- 'active'. Starting a saved route makes it active (and sets the current
-- active one aside as saved).
--
-- The status check is dropped by looking it up rather than by name, since
-- the original was an unnamed inline constraint (migration 099).

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'sales_routes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table sales_routes drop constraint %I', c);
  end loop;
end $$;

alter table sales_routes add constraint sales_routes_status_check
  check (status in ('active', 'saved', 'completed', 'canceled'));
