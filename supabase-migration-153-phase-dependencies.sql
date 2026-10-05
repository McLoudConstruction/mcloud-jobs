-- Run in Supabase SQL Editor after migration 152. Safe to re-run.
--
-- Phase links, for "move the following phases too" scheduling.
--
-- job_phases.depends_on points at the phase this one waits on (a simple
-- finish-to-start link). It does NOT move anything by itself. When a phase
-- is delayed, dragged or lengthened, the app looks at the phases linked
-- after it, offers them as a checklist (linked ones ticked by default) and
-- shifts only the ones you leave ticked. Unlinked phases are never touched
-- unless you tick them yourself.
--
-- If a phase is deleted, anything that waited on it simply becomes
-- unlinked (set null) rather than being deleted with it.

alter table job_phases
  add column if not exists depends_on uuid references job_phases(id) on delete set null;

create index if not exists job_phases_depends_on_idx on job_phases (depends_on);

-- Backfill: link each phase to the one immediately before it in the job's
-- schedule, but only where it truly follows on (the earlier phase ends
-- before this one starts). Phases that run side by side stay unlinked.
with ordered as (
  select
    id,
    job_id,
    start_date,
    lag(id) over w as prev_id,
    lag(end_date) over w as prev_end
  from job_phases
  where status = 'published' and depends_on is null
  window w as (partition by job_id order by sort_order, start_date, created_at)
)
update job_phases jp
set depends_on = o.prev_id
from ordered o
where jp.id = o.id
  and o.prev_id is not null
  and o.prev_end < o.start_date;
