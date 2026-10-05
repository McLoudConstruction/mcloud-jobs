-- Run in Supabase SQL Editor after migration 151. Safe to re-run.
--
-- Outreach safeguards, so a new sending history builds slowly and a
-- deliverability problem stops itself before it hurts the mailbox.
--
-- 1. Warm-up. The daily cap starts at outreach_warmup_start (15) and rises by
--    outreach_warmup_step (5) for every full week since the first outreach
--    email was sent, never past outreach_daily_limit. Turn it off to send at
--    exactly outreach_daily_limit from day one.
--
-- 2. Bounce auto-pause. Looking at the last 14 days, if at least 2 addresses
--    bounced AND the bounce rate is above outreach_bounce_pause_pct (2%), and
--    at least 10 emails have gone out, sending pauses and the reason is saved.
--    A single bounce never pauses on its own. Task steps and reply handling
--    keep working while paused; only emails stop. Resuming (owner, in
--    Outreach settings) restarts the count from that moment, so the same old
--    bounces cannot pause it again.
--
-- 3. Time budget. The daily run has about a minute to work. When it runs out
--    of time, release_outreach_claim() hands the unsent emails back so they go
--    out first on the next run instead of waiting out their 6 hour lease.
--
-- claim_outreach_sends() is redefined below with the same signature and
-- behavior as migration 140, plus the warm-up cap and the pause check.

-- ─── 1. Settings ────────────────────────────────────────────────────────
alter table app_settings add column if not exists outreach_warmup_enabled boolean not null default true;
alter table app_settings add column if not exists outreach_warmup_start integer not null default 15;
alter table app_settings add column if not exists outreach_warmup_step integer not null default 5;
alter table app_settings add column if not exists outreach_bounce_pause_pct numeric not null default 2;
alter table app_settings add column if not exists outreach_paused_at timestamptz;
alter table app_settings add column if not exists outreach_paused_reason text;
alter table app_settings add column if not exists outreach_bounce_checked_from timestamptz;

-- ─── 2. Today's cap ─────────────────────────────────────────────────────
create or replace function outreach_effective_cap()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s app_settings%rowtype;
  first_sent timestamptz;
  weeks integer;
  cap integer;
begin
  if not _outreach_caller_ok() then raise exception 'Not allowed'; end if;
  select * into s from app_settings where id = 1;
  cap := coalesce(s.outreach_daily_limit, 20);
  if coalesce(s.outreach_warmup_enabled, true) then
    select min(ev.created_at) into first_sent from outreach_events ev where ev.event_type = 'sent';
    weeks := case when first_sent is null then 0 else floor(extract(epoch from (now() - first_sent)) / 604800)::integer end;
    cap := least(cap, greatest(coalesce(s.outreach_warmup_start, 15), 1) + greatest(coalesce(s.outreach_warmup_step, 5), 0) * weeks);
  end if;
  return greatest(cap, 0);
end;
$$;

-- ─── 3. Bounce check ────────────────────────────────────────────────────
-- Pauses sending when the recent bounce rate is too high. Returns true when
-- sending is paused (already, or as a result of this check).
create or replace function _outreach_check_bounces()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s app_settings%rowtype;
  window_start timestamptz;
  sent_n integer;
  bounce_n integer;
  rate numeric;
begin
  select * into s from app_settings where id = 1;
  if s.outreach_paused_at is not null then return true; end if;

  window_start := greatest(now() - interval '14 days', coalesce(s.outreach_bounce_checked_from, '-infinity'::timestamptz));
  select count(*) into sent_n from outreach_events ev where ev.event_type = 'sent' and ev.created_at > window_start;
  select count(distinct ev.enrollment_id) into bounce_n from outreach_events ev where ev.event_type = 'bounced' and ev.created_at > window_start;
  if sent_n < 10 or bounce_n < 2 then return false; end if;

  rate := bounce_n * 100.0 / sent_n;
  if rate > coalesce(s.outreach_bounce_pause_pct, 2) then
    update app_settings
      set outreach_paused_at = now(),
          outreach_paused_reason = format(
            '%s of the last %s emails bounced (%s%%, limit %s%%). Check the addresses on your list, then resume.',
            bounce_n, sent_n, round(rate, 1), coalesce(s.outreach_bounce_pause_pct, 2))
      where id = 1 and outreach_paused_at is null;
    return true;
  end if;
  return false;
end;
$$;

-- Owner action: clear the pause. The bounce count restarts from now.
create or replace function outreach_resume()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _outreach_caller_ok() then raise exception 'Not allowed'; end if;
  update app_settings
    set outreach_paused_at = null, outreach_paused_reason = null, outreach_bounce_checked_from = now()
    where id = 1;
end;
$$;

-- Hands a claimed but unsent enrollment back so the next run picks it up first.
create or replace function release_outreach_claim(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _outreach_caller_ok() then raise exception 'Not allowed'; end if;
  update outreach_enrollments
    set next_send_at = now(), claimed_at = null
    where id = p_enrollment_id and status = 'active';
end;
$$;

-- ─── 4. claim_outreach_sends with warm-up and pause ─────────────────────
create or replace function claim_outreach_sends(max_n integer default null)
returns table (
  enrollment_id uuid,
  step_number integer,
  to_email text,
  to_name text,
  subject text,
  body_text text,
  unsubscribe_token uuid,
  property_name text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  s app_settings%rowtype;
  e outreach_enrollments%rowtype;
  st outreach_sequence_steps%rowtype;
  nxt outreach_sequence_steps%rowtype;
  blocked text;
  cap integer;
  sent_recent integer;
  claimed integer := 0;
  prop_name text;
begin
  if not _outreach_caller_ok() then raise exception 'Not allowed'; end if;
  select * into s from app_settings where id = 1;
  if not coalesce(s.outreach_enabled, false) then return; end if;

  select count(*) into sent_recent
  from outreach_events ev
  where ev.event_type = 'sent' and ev.created_at > now() - interval '24 hours';

  -- Paused (now or earlier): no emails go out, but task steps and
  -- bookkeeping below still run, so calls and reply follow-ups are not lost.
  if _outreach_check_bounces() then
    cap := 0;
  else
    cap := greatest(outreach_effective_cap() - sent_recent, 0);
  end if;
  if max_n is not null then cap := least(cap, greatest(max_n, 0)); end if;

  for e in
    select x.* from outreach_enrollments x
    where x.status = 'active' and x.next_send_at is not null and x.next_send_at <= now()
    order by x.next_send_at
    for update skip locked
  loop
    select t.* into st from outreach_sequence_steps t
    where t.sequence_id = e.sequence_id and t.step_number = e.steps_done + 1;
    if not found then
      update outreach_enrollments set status = 'completed', completed_at = now(), next_send_at = null where id = e.id;
      continue;
    end if;

    blocked := _outreach_blocked_reason(e.to_email, e.property_id);
    if blocked is not null then
      update outreach_enrollments set status = 'stopped', stop_reason = blocked, next_send_at = null where id = e.id;
      insert into outreach_events (enrollment_id, step_number, event_type, detail)
      values (e.id, st.step_number, 'skipped', blocked);
      continue;
    end if;

    if st.step_type = 'task' then
      if e.property_id is not null then
        update properties set next_action_at = now(), next_action_note = st.task_note where id = e.property_id;
      end if;
      insert into outreach_events (enrollment_id, step_number, event_type, detail)
      values (e.id, st.step_number, 'task_created', st.task_note);
      select t.* into nxt from outreach_sequence_steps t
      where t.sequence_id = e.sequence_id and t.step_number = st.step_number + 1;
      if found then
        update outreach_enrollments
          set steps_done = st.step_number, next_send_at = now() + make_interval(days => nxt.delay_days)
          where id = e.id;
      else
        update outreach_enrollments
          set steps_done = st.step_number, status = 'completed', completed_at = now(), next_send_at = null
          where id = e.id;
      end if;
      continue;
    end if;

    exit when claimed >= cap;  -- daily cap reached (or paused); the rest wait for the next run

    update outreach_enrollments set next_send_at = now() + interval '6 hours', claimed_at = now() where id = e.id;
    claimed := claimed + 1;
    select p.property_name into prop_name from properties p where p.id = e.property_id;
    return query select e.id, st.step_number, e.to_email, e.to_name, st.subject, st.body_text, e.unsubscribe_token, prop_name;
  end loop;
end;
$$;

-- The bounce check is internal; the claim function and the owner actions above are the entry points.
revoke all on function _outreach_check_bounces() from public, anon, authenticated;
