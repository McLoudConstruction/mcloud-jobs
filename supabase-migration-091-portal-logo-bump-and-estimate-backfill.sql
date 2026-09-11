-- Run in Supabase SQL Editor after migration 090. Safe to re-run.

-- ─── Bigger portal logo default ──────────────────────────────────────────
-- 64/48 (from migration 090) still read small next to a full-width portal
-- header. Bumping the column default, and updating any row still sitting
-- at the old auto-assigned default (i.e. never manually resized) up to
-- the new one. A row where you've already dragged the slider to something
-- else is left alone.
alter table app_settings alter column portal_logo_size_desktop set default 96;
alter table app_settings alter column portal_logo_size_mobile set default 64;

update app_settings set portal_logo_size_desktop = 96 where portal_logo_size_desktop = 64;
update app_settings set portal_logo_size_mobile = 64 where portal_logo_size_mobile = 48;

-- ─── Backfill missing estimate numbers ───────────────────────────────────
-- Migration 039 backfilled estimate_number from job_number for jobs that
-- already had a job_number. It never covered the opposite case: a job
-- with NEITHER number set — which happens for rows created outside the
-- normal "New Job" flow (an old test row, a manual insert, an import).
-- Those render as "Estimate #—" instead of a real number, which reads as
-- the number being missing rather than just not-yet-assigned. This
-- assigns each one the next real EST-YYYY-NNN number in its creation
-- year, using the same numeric-max approach the app itself uses.
do $$
declare
  r record;
  yr text;
  next_num int;
  candidate text;
begin
  for r in
    select id, created_at from jobs
    where estimate_number is null and job_number is null
    order by created_at
  loop
    yr := to_char(coalesce(r.created_at, now()), 'YYYY');
    select coalesce(max((regexp_match(estimate_number, '^EST-' || yr || '-(\d+)$'))[1]::int), 0) + 1
      into next_num
      from jobs
      where estimate_number like 'EST-' || yr || '-%';
    candidate := 'EST-' || yr || '-' || lpad(next_num::text, 3, '0');
    update jobs set estimate_number = candidate where id = r.id;
  end loop;
end $$;
