-- McLoud Construction Job Management System
-- Run this once in Supabase: Project > SQL Editor > New Query > paste all > Run

-- ─── JOBS ────────────────────────────────────────────────────────────────
create table jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text unique not null,
  stage text not null default 'proposal'
    check (stage in ('proposal','contract','active','invoice','complete')),

  customer_name text,
  customer_contact text,
  customer_email text,
  customer_phone text,
  billing_address text,
  project_address text,
  description text,

  scope_items jsonb not null default '[]',       -- [{ "text": "..." }, ...]
  additional_terms jsonb not null default '[]',   -- [{ "text": "..." }, ...]
  milestones jsonb not null default '[]',         -- [{ "desc": "...", "amount": "..." }, ...]

  contract_price numeric,
  governing_state text default 'Missouri',

  invoice_amount numeric,
  invoice_status text default 'not_sent'
    check (invoice_status in ('not_sent','sent','paid')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── DAILY / PROJECT UPDATES (one job has many) ────────────────────────
create table job_updates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  update_date date not null default current_date,
  work_completed text,
  upcoming_work text,
  issues_notes text,
  next_steps text,
  estimated_completion date,

  created_at timestamptz not null default now()
);

-- ─── Keep updated_at current automatically ─────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger jobs_set_updated_at
before update on jobs
for each row execute function set_updated_at();

-- ─── Security: only logged-in users (you) can read/write ───────────────
alter table jobs enable row level security;
alter table job_updates enable row level security;

create policy "Authenticated users can do everything on jobs"
  on jobs for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Authenticated users can do everything on job_updates"
  on job_updates for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Real-time updates (so open tabs/devices sync instantly) ───────────
alter publication supabase_realtime add table jobs;
alter publication supabase_realtime add table job_updates;
