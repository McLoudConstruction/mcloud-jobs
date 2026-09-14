-- Run in Supabase SQL Editor after migration 098. Safe to re-run.
--
-- Backs three requests on the manual Sales Route builder: (1) a route
-- survives your phone screen going off mid-drive — it's saved server-side
-- and resumes where you left off, not held only in page state; (2) a log
-- of past routes; (3) a straight-line-distance stop-ordering ESTIMATE
-- (property_lat/lng). Real driving-distance optimization would need
-- Google's paid Routes API — deliberately skipped for now (see chat) in
-- favor of a free nearest-neighbor approximation computed client-side.

alter table properties add column if not exists property_lat numeric;
alter table properties add column if not exists property_lng numeric;

create table if not exists sales_routes (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'canceled')),

  start_label text,
  start_lat numeric,
  start_lng numeric,
  end_label text,
  end_lat numeric,
  end_lng numeric,
  auto_ordered boolean not null default false,

  -- Ordered array of stops: [{property_id, property_name, property_street,
  -- property_city, property_state, property_zip, property_lat, property_lng,
  -- visited_at}, ...]. Kept as a snapshot rather than a join table — a
  -- route is a record of what you actually drove, so it shouldn't
  -- silently change later if the underlying property gets edited or
  -- deleted.
  stops jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table sales_routes enable row level security;

drop policy if exists "Admin can do everything on sales_routes" on sales_routes;
create policy "Admin can do everything on sales_routes"
  on sales_routes for all using (is_admin()) with check (is_admin());

create index if not exists sales_routes_staff_status_idx on sales_routes (staff_id, status);
