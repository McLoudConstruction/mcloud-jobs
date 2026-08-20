-- Run in Supabase SQL Editor after migration 032. Safe to re-run.

-- The exhaustive, contractor-side action list behind a job's scope — each
-- row is one distinct action, already counted and trade-tagged at
-- generation time (not fuzzy-grouped after the fact). The flat list and
-- the trade-grouped rollup are just two different ways of displaying
-- these same rows.
create table if not exists job_scope_actions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  description text not null,
  trade text, -- matches the same trade list used on Subcontractors (services_offered)
  unit_label text,
  quantity numeric not null default 1,
  created_at timestamptz not null default now()
);

alter table job_scope_actions enable row level security;
drop policy if exists "Admin full access to job_scope_actions" on job_scope_actions;
create policy "Admin full access to job_scope_actions" on job_scope_actions for all
  using (is_admin()) with check (is_admin());
