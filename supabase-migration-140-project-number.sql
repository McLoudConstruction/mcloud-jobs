-- Run in Supabase SQL Editor after migration 139. Safe to re-run.
--
-- Collapses the two-number system (Estimate # while an Opportunity,
-- Job # once Approved) into a single Project Number, assigned once at
-- creation, that stays with the project for its entire lifecycle.
--
-- Format: MC{YY}{NNN}{C|R}  e.g. MC26014C (Commercial), MC26014R
-- (Residential). NNN is ONE shared counter per calendar year across
-- both project types (not a separate counter per type).
--
-- job_number and estimate_number are NOT dropped here. They're kept as
-- a read-only mirror (kept in sync by trigger below) so any existing
-- SQL function or view that still reads one of them keeps returning
-- the right value. The application no longer writes to job_number or
-- estimate_number directly, and every screen now reads project_number.
-- A follow-up cleanup migration can drop the two old columns once
-- everything (including the notification-trigger functions listed in
-- the chat writeup) has been moved over to project_number directly.

alter table jobs add column if not exists project_number text;

-- Backfill: assign every existing job a fresh project_number, in
-- creation order, with the year taken from created_at and the
-- sequence restarting at 001 each year — one running counter per
-- year, shared across Commercial and Residential.
do $$
declare
  r record;
  yr text;
  seq int;
  last_yr text := null;
begin
  for r in
    select id, project_type, created_at
    from jobs
    order by created_at asc
  loop
    yr := to_char(r.created_at, 'YY');
    if yr is distinct from last_yr then
      seq := 0;
      last_yr := yr;
    end if;
    seq := seq + 1;
    update jobs
      set project_number = 'MC' || yr || lpad(seq::text, 3, '0') ||
        (case when r.project_type = 'commercial' then 'C' else 'R' end)
      where id = r.id;
  end loop;
end $$;

create unique index if not exists jobs_project_number_unique_idx on jobs (project_number) where project_number is not null;

-- Safety net: mirror project_number onto the legacy job_number /
-- estimate_number columns on every insert/update, so anything not yet
-- migrated off those columns (a handful of notification-trigger
-- functions from migrations 047/125/134/136/137/138 — see chat) keeps
-- displaying the correct number under its old name until it's moved
-- over.
create or replace function sync_legacy_project_number_columns()
returns trigger as $$
begin
  if new.project_number is not null then
    new.job_number := new.project_number;
    new.estimate_number := new.project_number;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_legacy_project_number on jobs;
create trigger trg_sync_legacy_project_number
  before insert or update on jobs
  for each row execute function sync_legacy_project_number_columns();

-- The backfill loop above wrote project_number directly (not through
-- an insert/update that would have fired the trigger with NEW already
-- set on the same statement in every edge case) — mirror it explicitly
-- now so job_number/estimate_number are guaranteed to match.
update jobs set job_number = project_number, estimate_number = project_number where project_number is not null;
