-- Run in Supabase SQL Editor after migration 006.

create table change_orders (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  description text,
  amount numeric,
  co_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table change_orders enable row level security;

create policy "Authenticated can do everything on change_orders"
  on change_orders for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter publication supabase_realtime add table change_orders;
