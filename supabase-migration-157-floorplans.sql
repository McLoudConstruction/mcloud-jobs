-- Run in Supabase SQL Editor after migration 156. Safe to re-run.
-- Floorplan sketch + takeoff, one plan per job. Staff only (admin + PM).
-- Self-contained: dropping this table removes the feature cleanly.
create table if not exists job_floorplans (
  job_id uuid primary key references jobs(id) on delete cascade,
  plan jsonb not null default '{}',      -- walls, openings, fixtures, finishes, typed prices
  takeoff jsonb,                         -- last computed takeoff lines (snapshot)
  updated_at timestamptz not null default now()
);

alter table job_floorplans enable row level security;
drop policy if exists "Admin full access to job_floorplans" on job_floorplans;
create policy "Admin full access to job_floorplans" on job_floorplans for all
  using (is_admin()) with check (is_admin());
drop policy if exists "PM full access to job_floorplans" on job_floorplans;
create policy "PM full access to job_floorplans" on job_floorplans for all
  using (is_pm()) with check (is_pm());
