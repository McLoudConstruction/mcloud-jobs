-- Migration 160 — Job visits and walks, and what the customer portal shows next
--
-- Run in the Supabase SQL Editor BEFORE deploying this release. Safe to re-run.
--
-- Staff can now log a visit, walk, inspection or any other event straight onto
-- a job (Quick actions > Add schedule item, or the Schedule tab). Each one can
-- optionally be shared with the customer, which is what lets the customer
-- portal's "Next Scheduled Visit" card show something real.
--
-- 1. schedule_events.show_to_customer — off unless staff turn it on.
-- 2. customer_job_events(job) — the ONLY way a customer reads schedule_events.
--
-- Why a function and not a customer SELECT policy: RLS is row-level, not
-- column-level. A policy would let a customer's browser pull every column of
-- a shared row, including the internal description and the staff and sub
-- company ids. This function hands back only the event type, date and time.
-- schedule_events itself stays staff-only (plus invited subs), unchanged.

alter table schedule_events add column if not exists show_to_customer boolean not null default false;

create or replace function customer_job_events(target_job_id uuid)
returns table (id uuid, event_type text, event_date date, event_time time)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;
  -- One day of slack so a customer west of the server's UTC date still gets
  -- today's event; the portal does the exact "today" comparison itself.
  return query
    select e.id, e.event_type, e.event_date, e.event_time
    from schedule_events e
    where e.job_id = target_job_id
      and e.show_to_customer = true
      and e.event_date >= current_date - 1
    order by e.event_date, e.event_time nulls last
    limit 50;
end;
$$;

grant execute on function customer_job_events(uuid) to authenticated;
