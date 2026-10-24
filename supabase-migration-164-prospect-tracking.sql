-- Migration 164: prospect tracking you can trust.
--
-- Run after 163. Safe to run twice.
--
-- 1. Last contacted stays right. properties.last_contacted_at was a typed-in
--    date that only some paths updated. It is now recalculated from the touch
--    history (staff and bot touches, plus platform sequence sends and replies)
--    every time a touch is added, changed or removed. A stale form save can no
--    longer move it backwards.
-- 2. A prospect_activity view: touch count, last touch, last real contact and
--    last reply for every property, from that same history. Mailbox mail is
--    not included, so it never slows list screens.
-- 3. Stage tracking: when the stage last changed (set by the database, a form
--    save cannot rewrite it), why a prospect was lost, and when to try again.
-- 4. crm_follow_up(): one call that returns the Sales page lists (overdue next
--    steps, active prospects with no next step, stalled prospects, lost ones
--    due to try again) and a small scorecard by vertical and by source.
--
-- last_visited_at is left alone. The Route Builder still sets it.

-- ─── 1. New columns ─────────────────────────────────────────────────────
alter table properties add column if not exists stage_changed_at timestamptz;
alter table properties add column if not exists lost_reason text;
alter table properties add column if not exists reengage_at date;

update properties set stage_changed_at = coalesce(last_contacted_at, created_at, now()) where stage_changed_at is null;

-- ─── 2. What counts as real contact ─────────────────────────────────────
-- The same list the bot log and the staff log use. A miss (no answer, wrong
-- contact, bounce) and a plain note are attempts or notes, not contact.
create or replace function _touch_counts(p_outcome text)
returns boolean
language sql
immutable
as $$
  select p_outcome in ('sent', 'connected', 'voicemail', 'replied', 'interested', 'not_interested', 'unsubscribed', 'meeting_set');
$$;

-- ─── 3. Last contacted, recalculated from history ───────────────────────
create or replace function _prospect_sync_contact(p_property uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v timestamptz;
begin
  if p_property is null then return; end if;
  select max(x.at) into v from (
    select t.sent_at as at
    from outreach_touches t
    where t.property_id = p_property and _touch_counts(t.outcome)
    union all
    select e.created_at
    from outreach_events e
    join outreach_enrollments en on en.id = e.enrollment_id
    where en.property_id = p_property and e.event_type in ('sent', 'replied')
  ) x;
  update properties set last_contacted_at = v
  where id = p_property and last_contacted_at is distinct from v;
end;
$$;

create or replace function _outreach_touches_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform _prospect_sync_contact(old.property_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform _prospect_sync_contact(new.property_id); end if;
  return null;
end;
$$;

drop trigger if exists outreach_touches_sync on outreach_touches;
create trigger outreach_touches_sync
  after insert or update or delete on outreach_touches
  for each row execute function _outreach_touches_sync();

-- ─── 4. Stage change date, and protection from stale saves ──────────────
create or replace function _properties_stage_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_changed_at := coalesce(new.stage_changed_at, now());
    return new;
  end if;

  if new.prospect_stage is distinct from old.prospect_stage then
    new.stage_changed_at := now();
    -- A reason and a try again date only make sense while the prospect is lost.
    if new.prospect_stage <> 'lost' then
      new.lost_reason := null;
      new.reengage_at := null;
    end if;
  else
    -- A form save sends back every column it loaded. It cannot rewrite this one.
    new.stage_changed_at := old.stage_changed_at;
  end if;

  -- Same reason: a form that was open while a touch was logged must not move
  -- last contacted backwards. A recalculation from the touch history (which
  -- runs inside another trigger) is allowed to lower it, for example after a
  -- touch is removed.
  if pg_trigger_depth() <= 1
     and old.last_contacted_at is not null
     and (new.last_contacted_at is null or new.last_contacted_at < old.last_contacted_at) then
    new.last_contacted_at := old.last_contacted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists properties_stage_guard on properties;
create trigger properties_stage_guard
  before insert or update on properties
  for each row execute function _properties_stage_guard();

-- ─── 5. Backfill last contacted from history ────────────────────────────
-- Only where history exists, so a value that is already set is never blanked.
update properties p
   set last_contacted_at = h.at
  from (
    select x.property_id, max(x.at) as at from (
      select t.property_id, t.sent_at as at from outreach_touches t where _touch_counts(t.outcome)
      union all
      select en.property_id, e.created_at
      from outreach_events e join outreach_enrollments en on en.id = e.enrollment_id
      where en.property_id is not null and e.event_type in ('sent', 'replied')
    ) x
    group by x.property_id
  ) h
 where p.id = h.property_id and p.last_contacted_at is distinct from h.at;

-- ─── 6. The activity view ───────────────────────────────────────────────
-- security_invoker makes the view obey the caller's own access to the
-- tables underneath, so signed in staff see it and the public does not.
create or replace view prospect_activity
with (security_invoker = true)
as
with events as (
  select t.property_id, t.sent_at as at,
         (t.outcome <> 'note') as is_touch,
         _touch_counts(t.outcome) as is_contact,
         (t.direction = 'inbound' or t.outcome in ('replied', 'interested', 'meeting_set')) as is_reply
  from outreach_touches t
  union all
  select en.property_id, e.created_at,
         true,
         e.event_type in ('sent', 'replied'),
         e.event_type = 'replied'
  from outreach_events e
  join outreach_enrollments en on en.id = e.enrollment_id
  where en.property_id is not null and e.event_type in ('sent', 'replied', 'bounced', 'unsubscribed')
)
select
  property_id,
  count(*) filter (where is_touch) as touch_count,
  max(at) filter (where is_touch) as last_touch_at,
  max(at) filter (where is_contact) as last_contact_at,
  max(at) filter (where is_reply) as last_reply_at
from events
group by property_id;

revoke all on prospect_activity from public, anon;
grant select on prospect_activity to authenticated;

-- ─── 7. Sales page: follow up lists and scorecard ───────────────────────
create or replace function crm_follow_up(p_limit integer default 25, p_stalled_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_days integer := least(greatest(coalesce(p_stalled_days, 14), 1), 365);
  r jsonb;
begin
  if not (coalesce(is_admin(), false) or _is_trusted_context()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  with all_p as (
    select p.id, p.property_name as name, p.prospect_stage as stage,
           nullif(btrim(p.prospect_vertical), '') as vertical, nullif(btrim(p.prospect_source), '') as source,
           p.next_action_at, p.next_action_note, p.stage_changed_at, p.reengage_at, p.lost_reason,
           coalesce(a.last_contact_at, p.last_contacted_at) as last_contact_at,
           a.last_touch_at, a.last_reply_at, coalesce(a.touch_count, 0) as touch_count,
           (coalesce(p.active, true) and not coalesce(p.do_not_contact, false)) as live
    from properties p
    left join prospect_activity a on a.property_id = p.id
  ),
  live as (select * from all_p where live),
  overdue as (
    select * from live
    where stage in ('prospecting', 'contacted', 'proposal') and next_action_at is not null and next_action_at < now()
  ),
  no_next as (
    select * from live where stage in ('contacted', 'proposal') and next_action_at is null
  ),
  stalled as (
    select * from live
    where (stage = 'contacted' and coalesce(last_touch_at, stage_changed_at) < now() - make_interval(days => v_days))
       or (stage = 'proposal' and stage_changed_at < now() - make_interval(days => v_days)
           and (last_touch_at is null or last_touch_at < now() - make_interval(days => v_days / 2)))
  ),
  try_again as (
    select * from live where stage = 'lost' and reengage_at is not null and reengage_at <= current_date
  )
  select jsonb_build_object(
    'overdue', jsonb_build_object(
      'count', (select count(*) from overdue),
      'items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.next_action_at), '[]'::jsonb) from (
        select id, name, stage, next_action_at, next_action_note, last_contact_at from overdue order by next_action_at limit v_limit) x)),
    'no_next_step', jsonb_build_object(
      'count', (select count(*) from no_next),
      'items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.last_contact_at nulls first), '[]'::jsonb) from (
        select id, name, stage, last_contact_at, stage_changed_at from no_next order by last_contact_at nulls first, name limit v_limit) x)),
    'stalled', jsonb_build_object(
      'count', (select count(*) from stalled),
      'items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.quiet_since), '[]'::jsonb) from (
        select id, name, stage, next_action_at, next_action_note, last_contact_at,
               coalesce(last_touch_at, stage_changed_at) as quiet_since,
               floor(extract(epoch from now() - coalesce(last_touch_at, stage_changed_at)) / 86400)::integer as quiet_days
        from stalled order by coalesce(last_touch_at, stage_changed_at) limit v_limit) x)),
    'try_again', jsonb_build_object(
      'count', (select count(*) from try_again),
      'items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.reengage_at), '[]'::jsonb) from (
        select id, name, reengage_at, lost_reason from try_again order by reengage_at limit v_limit) x)),
    'scorecard', jsonb_build_object(
      'overall', (select to_jsonb(s) from (
        select 'All prospects'::text as label,
               count(*) as prospects,
               count(*) filter (where stage <> 'prospecting' or touch_count > 0) as reached,
               count(*) filter (where last_reply_at is not null) as replied,
               count(*) filter (where stage in ('proposal', 'won')) as estimates,
               count(*) filter (where stage = 'won') as won
        from all_p) s),
      'by_vertical', (select coalesce(jsonb_agg(to_jsonb(s) order by s.prospects desc, s.label), '[]'::jsonb) from (
        select coalesce(vertical, 'Not set') as label,
               count(*) as prospects,
               count(*) filter (where stage <> 'prospecting' or touch_count > 0) as reached,
               count(*) filter (where last_reply_at is not null) as replied,
               count(*) filter (where stage in ('proposal', 'won')) as estimates,
               count(*) filter (where stage = 'won') as won
        from all_p group by 1 order by count(*) desc, 1 limit 12) s),
      'by_source', (select coalesce(jsonb_agg(to_jsonb(s) order by s.prospects desc, s.label), '[]'::jsonb) from (
        select coalesce(source, 'Not set') as label,
               count(*) as prospects,
               count(*) filter (where stage <> 'prospecting' or touch_count > 0) as reached,
               count(*) filter (where last_reply_at is not null) as replied,
               count(*) filter (where stage in ('proposal', 'won')) as estimates,
               count(*) filter (where stage = 'won') as won
        from all_p group by 1 order by count(*) desc, 1 limit 12) s)
    ),
    'stalled_days', v_days
  ) into r;
  return r;
end;
$$;

-- ─── Who can run what ───────────────────────────────────────────────────
-- _touch_counts stays callable: the prospect_activity view runs as the signed in user and uses it.
revoke all on function _prospect_sync_contact(uuid) from public, anon, authenticated;
revoke all on function _outreach_touches_sync() from public, anon, authenticated;
revoke all on function _properties_stage_guard() from public, anon, authenticated;
revoke all on function crm_follow_up(integer, integer) from public, anon;
grant execute on function crm_follow_up(integer, integer) to authenticated;

notify pgrst, 'reload schema';
