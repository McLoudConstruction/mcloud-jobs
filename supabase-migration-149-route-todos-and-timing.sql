-- Run in Supabase SQL Editor after migration 148. Safe to re-run.
--
-- Backs the Route Builder and Drive Mode upgrades:
--
-- 1. sales_todos: quick to-do items and dated events captured while on a
--    route (Send COI, Send Intro Email, follow-up email, inspection...).
--    Each one has a day, can be checked off, and shows on the Dashboard.
--    kind = 'todo' is a checklist item, kind = 'event' is a dated event
--    that can carry a time of day.
--
-- 2. sales_routes timing columns:
--    default_dwell_minutes  planned time at each stop (a stop can override
--                           it with its own dwell_minutes inside the stops
--                           jsonb, the same way visited_at lives there)
--    depart_time            planned leave time, used for arrival estimates
--    est_meters / est_drive_seconds
--                           last known road distance and drive time, saved
--                           with the route so the Dashboard can show a
--                           total without calling Mapbox for every card
--
-- A skipped stop is stored inside the stops jsonb as skipped_at (like
-- visited_at), so no column is needed for it.

create table if not exists sales_todos (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_users(id) on delete cascade,
  kind text not null default 'todo' check (kind in ('todo', 'event')),
  title text not null,
  note text,
  due_date date not null,
  due_time time,
  property_id uuid references properties(id) on delete set null,
  property_name text,
  route_id uuid references sales_routes(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table sales_todos enable row level security;

drop policy if exists "Admin can do everything on sales_todos" on sales_todos;
create policy "Admin can do everything on sales_todos"
  on sales_todos for all using (is_admin()) with check (is_admin());

create index if not exists sales_todos_staff_due_idx on sales_todos (staff_id, due_date) where completed_at is null;
create index if not exists sales_todos_property_idx on sales_todos (property_id) where property_id is not null;

alter table sales_routes add column if not exists default_dwell_minutes integer not null default 15;
alter table sales_routes add column if not exists depart_time time;
alter table sales_routes add column if not exists est_meters numeric;
alter table sales_routes add column if not exists est_drive_seconds numeric;

-- Realtime is opt-in per table. The app refreshes explicitly after every
-- write, so this is only a bonus for a second open tab.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales_todos'
  ) then
    alter publication supabase_realtime add table sales_todos;
  end if;
end $$;
