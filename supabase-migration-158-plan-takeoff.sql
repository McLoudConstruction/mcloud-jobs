-- Run in Supabase SQL Editor after migration 157. Safe to re-run.
--
-- AI plan takeoff (Sell > Plans > Upload Plans).
--
-- A takeoff run is one upload of plan PDFs for a job. The PDFs live in a
-- private storage bucket. Preparing a run splits them into small chunks
-- (also stored in the bucket, removed when the run finishes) and the app
-- analyzes one chunk per request, so a big plan set never depends on one long
-- request. Progress is stored here, so a run can be stopped, resumed, or
-- continued after a refresh.
--
-- Results land in the existing Scope tables:
--   jobs.scope_items         customer facing sentences (unchanged)
--   job_scope_actions        quantities by trade (new columns below say which rows
--                            came from plans and which need verification)
-- No prices are ever generated.

create table if not exists job_plan_takeoffs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  -- Intake answers that steer the AI
  building_type text,
  building_use text,
  work_type text,            -- new | renovation | repair | replacement
  notes text,

  -- draft -> ready (prepared) -> processing -> done | stopped | failed
  status text not null default 'draft',
  files jsonb not null default '[]',    -- [{name, path, size, pages, error}]
  chunks jsonb not null default '[]',   -- [{id, file, path, pages[], priority, status, attempts, tokens, items, error}]
  skipped jsonb not null default '[]',  -- [{file, page, reason}]

  est_tokens integer,
  tokens_used integer not null default 0,   -- weighted total, counts toward the job cap
  items_added integer not null default 0,
  items_flagged integer not null default 0,
  message text,                              -- last status or stop reason shown to staff
  finalized_at timestamptz,
  lock_until timestamptz,                    -- stops two tabs from processing the same run
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_plan_takeoffs_job on job_plan_takeoffs (job_id, created_at desc);

alter table job_plan_takeoffs enable row level security;
drop policy if exists "Admin full access to job_plan_takeoffs" on job_plan_takeoffs;
create policy "Admin full access to job_plan_takeoffs" on job_plan_takeoffs for all
  using (is_admin()) with check (is_admin());
drop policy if exists "PM full access to job_plan_takeoffs" on job_plan_takeoffs;
create policy "PM full access to job_plan_takeoffs" on job_plan_takeoffs for all
  using (is_pm()) with check (is_pm());

-- Per job token cap override. A job with no row uses the default in
-- lib/planTakeoff.js (DEFAULT_JOB_TOKEN_CAP). Only owners raise it (enforced in the API route).
create table if not exists job_plan_budget (
  job_id uuid primary key references jobs(id) on delete cascade,
  token_cap integer not null check (token_cap between 100000 and 20000000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table job_plan_budget enable row level security;
drop policy if exists "Admin full access to job_plan_budget" on job_plan_budget;
create policy "Admin full access to job_plan_budget" on job_plan_budget for all
  using (is_admin()) with check (is_admin());
drop policy if exists "PM can read job_plan_budget" on job_plan_budget;
create policy "PM can read job_plan_budget" on job_plan_budget for select using (is_pm());

-- Which trade breakdown rows came from plans, and which need a human check.
-- All additive. Existing rows keep null / false.
alter table job_scope_actions add column if not exists source text;                 -- 'plan_ai' for rows from a takeoff
alter table job_scope_actions add column if not exists needs_verification boolean not null default false;
alter table job_scope_actions add column if not exists verify_note text;
alter table job_scope_actions add column if not exists sheet_ref text;              -- e.g. "Plans.pdf p.12 (A-101)"
alter table job_scope_actions add column if not exists plan_takeoff_id uuid references job_plan_takeoffs(id) on delete set null;

create index if not exists job_scope_actions_takeoff on job_scope_actions (plan_takeoff_id) where plan_takeoff_id is not null;

-- Private bucket for the plan PDFs. Files are stored as {job_id}/{takeoff_id}/...
-- 50 MB per file matches the usual Supabase upload limit. Bigger sets should be
-- uploaded as several PDFs (architects usually export by discipline anyway).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-plans', 'job-plans', false, 52428800, array['application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Staff can manage job plan files" on storage.objects;
create policy "Staff can manage job plan files"
  on storage.objects for all
  using (bucket_id = 'job-plans' and (is_admin() or is_pm()))
  with check (bucket_id = 'job-plans' and (is_admin() or is_pm()));
