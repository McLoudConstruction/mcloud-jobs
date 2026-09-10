-- Run in Supabase SQL Editor after migration 080. Safe to re-run.
--
-- Stores the confirmed AI-generated (or manually built) project schedule
-- for a job — one row per phase. phase_key matches a key in
-- lib/scheduleTemplate.js's PHASE_STAGES for AI-generated phases, or is
-- 'custom' for anything added by hand afterward.
--
-- A job "has a schedule" simply means it has rows here — there's no
-- separate status flag for that. schedule_stale_at on jobs tracks when
-- the trade breakdown changed after a schedule was already confirmed, so
-- the UI can show a banner and drop a notification without re-dating
-- anything automatically (see TradeBreakdownCard.js).

create table if not exists job_phases (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  phase_key text not null default 'custom',
  label text not null,
  trade text, -- null for multi-trade or synthetic phases (inspections, punch list)
  start_date date not null,
  end_date date not null,
  duration_days integer not null,
  sort_order integer not null default 0,
  source text not null default 'ai' check (source in ('ai', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_phases_job_id_idx on job_phases (job_id);

alter table job_phases enable row level security;
drop policy if exists "Admin full access to job_phases" on job_phases;
create policy "Admin full access to job_phases" on job_phases for all
  using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_phases'
  ) then
    alter publication supabase_realtime add table job_phases;
  end if;
end $$;

-- Set when job_scope_actions changes on a job that already has confirmed
-- phases; cleared when the schedule is regenerated or manually
-- acknowledged. Timestamp (not just a boolean) so the banner/notification
-- can say how long it's been out of date.
alter table jobs add column if not exists schedule_stale_at timestamptz;
