-- Run in Supabase SQL Editor after migration 139. Safe to re-run.
--
-- Outbound prospecting: turns the Properties database (which already has
-- prospect_stage, contact info, last_visited_at and the Sales Route builder)
-- into a working prospect list, and adds multi-step email/task sequences on
-- top of it.
--
-- Design notes
--   * No separate "prospects" table. properties + contacts already are the
--     prospect database; this migration only adds the missing tracking fields
--     (vertical, source, tier, last contacted, next action, do-not-contact).
--   * A sequence is an ordered list of steps. A step is either an email or a
--     task ("call them", "drop by"). delay_days is measured from the previous
--     step. Task steps surface on the property as next_action_at/next_action_note
--     so a "who do I contact today" view is just a query on properties.
--   * Sending is driven by the existing daily-automations cron (Hobby-plan
--     Vercel allows only two daily crons, both already used), so sequences
--     advance in whole days. claim_outreach_sends() hands the cron the emails
--     that are due (respecting the daily cap); finish_outreach_send() records
--     the result and schedules the next step. Same claim/finish pattern as
--     migration 138 (reviews).
--   * Global suppression list (outreach_suppressions) is checked before every
--     send, in addition to contacts.automated_emails_opt_out and
--     properties.do_not_contact. Unsubscribes and bounces land there.
--   * Sender identity (from name/address, reply-to) is configured in
--     app_settings, not hardcoded, and outreach_enabled defaults to OFF.
--   * All tables are staff-only via is_admin(), same as sales_routes (099).
--     Server routes use the service role. The only anonymous entry point is
--     outreach_unsubscribe(token), which takes an unguessable per-enrollment
--     token and can do nothing except unsubscribe that address.

-- ─── 1. Prospect tracking fields on properties ──────────────────────────
alter table properties add column if not exists prospect_vertical text;        -- e.g. church, property_management, restoration, investor
alter table properties add column if not exists prospect_source text;          -- e.g. church-list-2026-09, manual, permit-feed
alter table properties add column if not exists prospect_tier text check (prospect_tier in ('A', 'B', 'C'));
alter table properties add column if not exists last_contacted_at timestamptz;
alter table properties add column if not exists next_action_at timestamptz;
alter table properties add column if not exists next_action_note text;
alter table properties add column if not exists do_not_contact boolean not null default false;

create index if not exists properties_next_action_idx on properties (next_action_at) where next_action_at is not null;
create index if not exists properties_vertical_idx on properties (prospect_vertical) where prospect_vertical is not null;

-- ─── 2. Outreach settings ───────────────────────────────────────────────
alter table app_settings add column if not exists outreach_enabled boolean not null default false;
alter table app_settings add column if not exists outreach_from_name text;
alter table app_settings add column if not exists outreach_from_email text;    -- must be on a Resend-verified domain
alter table app_settings add column if not exists outreach_reply_to text;      -- where replies land (your inbox)
alter table app_settings add column if not exists outreach_daily_limit integer not null default 20;
alter table app_settings add column if not exists outreach_postal_address text; -- required in the footer of commercial email (CAN-SPAM)

-- ─── 3. Tables ──────────────────────────────────────────────────────────
create table if not exists outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vertical text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at_outreach_sequences()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists outreach_sequences_set_updated_at on outreach_sequences;
create trigger outreach_sequences_set_updated_at
before update on outreach_sequences
for each row execute function set_updated_at_outreach_sequences();

create table if not exists outreach_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references outreach_sequences(id) on delete cascade,
  step_number integer not null check (step_number >= 1),
  step_type text not null default 'email' check (step_type in ('email', 'task')),
  delay_days integer not null default 0 check (delay_days >= 0),  -- days after the previous step (after enrollment, for step 1)
  subject text,
  body_text text,   -- merge tags: {{first_name}}, {{property_name}}, {{sender_name}}
  task_note text,
  unique (sequence_id, step_number),
  check (
    (step_type = 'email' and subject is not null and body_text is not null)
    or (step_type = 'task' and task_note is not null)
  )
);

create table if not exists outreach_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references outreach_sequences(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  to_email text not null,
  to_name text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'replied', 'completed', 'unsubscribed', 'bounced', 'stopped')),
  steps_done integer not null default 0,
  next_send_at timestamptz,
  claimed_at timestamptz,
  last_sent_at timestamptz,
  completed_at timestamptz,
  stop_reason text,
  fail_count integer not null default 0,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  enrolled_by uuid references staff_users(id) on delete set null,
  enrolled_at timestamptz not null default now()
);

-- One open enrollment per address per sequence; finished ones don't block a re-enroll later.
create unique index if not exists outreach_enrollments_one_open
  on outreach_enrollments (sequence_id, lower(to_email)) where status in ('active', 'paused');
create index if not exists outreach_enrollments_due_idx
  on outreach_enrollments (next_send_at) where status = 'active';
create index if not exists outreach_enrollments_property_idx on outreach_enrollments (property_id);
create index if not exists outreach_enrollments_email_idx on outreach_enrollments (lower(to_email));

create table if not exists outreach_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references outreach_enrollments(id) on delete cascade,
  step_number integer,
  event_type text not null
    check (event_type in ('sent', 'failed', 'skipped', 'task_created', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed', 'stopped')),
  detail text,
  provider_message_id text,
  created_at timestamptz not null default now()
);
create index if not exists outreach_events_enrollment_idx on outreach_events (enrollment_id, created_at);
create index if not exists outreach_events_sent_idx on outreach_events (created_at) where event_type = 'sent';

create table if not exists outreach_suppressions (
  email text primary key check (email = lower(email)),
  reason text not null check (reason in ('unsubscribed', 'bounced', 'complained', 'manual')),
  source_enrollment_id uuid references outreach_enrollments(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─── 4. Row-level security (staff only) ─────────────────────────────────
alter table outreach_sequences enable row level security;
alter table outreach_sequence_steps enable row level security;
alter table outreach_enrollments enable row level security;
alter table outreach_events enable row level security;
alter table outreach_suppressions enable row level security;

drop policy if exists "Admin can do everything on outreach_sequences" on outreach_sequences;
create policy "Admin can do everything on outreach_sequences"
  on outreach_sequences for all using (is_admin()) with check (is_admin());

drop policy if exists "Admin can do everything on outreach_sequence_steps" on outreach_sequence_steps;
create policy "Admin can do everything on outreach_sequence_steps"
  on outreach_sequence_steps for all using (is_admin()) with check (is_admin());

drop policy if exists "Admin can do everything on outreach_enrollments" on outreach_enrollments;
create policy "Admin can do everything on outreach_enrollments"
  on outreach_enrollments for all using (is_admin()) with check (is_admin());

drop policy if exists "Admin can do everything on outreach_events" on outreach_events;
create policy "Admin can do everything on outreach_events"
  on outreach_events for all using (is_admin()) with check (is_admin());

drop policy if exists "Admin can do everything on outreach_suppressions" on outreach_suppressions;
create policy "Admin can do everything on outreach_suppressions"
  on outreach_suppressions for all using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'outreach_enrollments'
  ) then
    alter publication supabase_realtime add table outreach_enrollments;
  end if;
end $$;

-- ─── 5. Functions ───────────────────────────────────────────────────────
create or replace function _outreach_caller_ok()
returns boolean
language sql
stable
as $$ select coalesce(is_admin(), false) or _is_trusted_context(); $$;

-- Why an address can't be emailed right now, or null if it can.
create or replace function _outreach_blocked_reason(p_email text, p_property_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  addr text := lower(btrim(coalesce(p_email, '')));
begin
  if addr = '' then return 'no_email'; end if;
  if exists (select 1 from outreach_suppressions s where s.email = addr) then return 'suppressed'; end if;
  if exists (select 1 from contacts c where lower(c.contact_email) = addr and c.automated_emails_opt_out) then return 'opted_out'; end if;
  if p_property_id is not null and exists (select 1 from properties p where p.id = p_property_id and p.do_not_contact) then return 'do_not_contact'; end if;
  return null;
end;
$$;

-- Enroll one address in a sequence. Raises with a readable reason if blocked.
create or replace function outreach_enroll(
  p_sequence_id uuid,
  p_property_id uuid,
  p_contact_id uuid,
  p_to_email text,
  p_to_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  seq outreach_sequences%rowtype;
  first_step outreach_sequence_steps%rowtype;
  blocked text;
  addr text := lower(btrim(coalesce(p_to_email, '')));
  new_id uuid;
begin
  if not _outreach_caller_ok() then raise exception 'Not allowed'; end if;
  select * into seq from outreach_sequences where id = p_sequence_id;
  if not found or not seq.active then raise exception 'Sequence not found or inactive'; end if;
  select * into first_step from outreach_sequence_steps where sequence_id = p_sequence_id and step_number = 1;
  if not found then raise exception 'Sequence has no steps'; end if;
  blocked := _outreach_blocked_reason(addr, p_property_id);
  if blocked is not null then raise exception 'Cannot enroll: %', blocked; end if;

  insert into outreach_enrollments (sequence_id, property_id, contact_id, to_email, to_name, next_send_at, enrolled_by)
  values (
    p_sequence_id, p_property_id, p_contact_id, addr,
    nullif(btrim(coalesce(p_to_name, '')), ''),
    now() + make_interval(days => first_step.delay_days),
    auth.uid()
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- Enroll many properties at once using each property's own contact_email /
-- contact_name. Skips (and counts) anything without an email, anything
-- blocked, and anything already enrolled.
create or replace function outreach_enroll_properties(p_sequence_id uuid, p_property_ids uuid[])
returns table (enrolled integer, skipped_no_email integer, skipped_blocked integer, skipped_duplicate integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  pr record;
begin
  if not _outreach_caller_ok() then raise exception 'Not allowed'; end if;
  enrolled := 0; skipped_no_email := 0; skipped_blocked := 0; skipped_duplicate := 0;
  for pr in select p.id, p.contact_email, p.contact_name from properties p where p.id = any(p_property_ids)
  loop
    if pr.contact_email is null or btrim(pr.contact_email) = '' then
      skipped_no_email := skipped_no_email + 1;
    elsif _outreach_blocked_reason(pr.contact_email, pr.id) is not null then
      skipped_blocked := skipped_blocked + 1;
    else
      begin
        perform outreach_enroll(p_sequence_id, pr.id, null, pr.contact_email, pr.contact_name);
        enrolled := enrolled + 1;
      exception when unique_violation then
        skipped_duplicate := skipped_duplicate + 1;
      end;
    end if;
  end loop;
  return next;
end;
$$;

-- Called by the daily cron. Returns the emails that are due (up to the daily
-- cap), and handles everything that doesn't need an email itself: task steps
-- become the property's next action, blocked/finished enrollments are closed.
-- Each returned enrollment is leased for 6 hours so an overlapping run can't
-- send it twice; the cron must call finish_outreach_send() for each one.
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
  cap := greatest(coalesce(s.outreach_daily_limit, 20) - sent_recent, 0);
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

    exit when claimed >= cap;  -- daily cap reached; the rest wait for tomorrow's run

    update outreach_enrollments set next_send_at = now() + interval '6 hours', claimed_at = now() where id = e.id;
    claimed := claimed + 1;
    select p.property_name into prop_name from properties p where p.id = e.property_id;
    return query select e.id, st.step_number, e.to_email, e.to_name, st.subject, st.body_text, e.unsubscribe_token, prop_name;
  end loop;
end;
$$;

-- Records the outcome of one claimed email and schedules what comes next.
-- Three consecutive failures stop the enrollment.
create or replace function finish_outreach_send(
  p_enrollment_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  e outreach_enrollments%rowtype;
  st outreach_sequence_steps%rowtype;
  nxt outreach_sequence_steps%rowtype;
begin
  if not _outreach_caller_ok() then raise exception 'Not allowed'; end if;
  select * into e from outreach_enrollments where id = p_enrollment_id for update;
  if not found then return; end if;
  select t.* into st from outreach_sequence_steps t
  where t.sequence_id = e.sequence_id and t.step_number = e.steps_done + 1;
  if not found then return; end if;

  if p_ok then
    insert into outreach_events (enrollment_id, step_number, event_type, detail, provider_message_id)
    values (e.id, st.step_number, 'sent', st.subject, p_provider_message_id);
    -- Replied/unsubscribed while the email was in flight: the send is on the
    -- record, but the enrollment stays closed.
    if e.status <> 'active' then return; end if;

    if e.property_id is not null then
      update properties
        set last_contacted_at = now(),
            prospect_stage = case when prospect_stage = 'prospecting' then 'contacted' else prospect_stage end
        where id = e.property_id;
    end if;

    select t.* into nxt from outreach_sequence_steps t
    where t.sequence_id = e.sequence_id and t.step_number = st.step_number + 1;
    if found then
      update outreach_enrollments
        set steps_done = st.step_number, last_sent_at = now(), fail_count = 0,
            next_send_at = now() + make_interval(days => nxt.delay_days)
        where id = e.id;
    else
      update outreach_enrollments
        set steps_done = st.step_number, last_sent_at = now(), fail_count = 0,
            status = 'completed', completed_at = now(), next_send_at = null
        where id = e.id;
    end if;
  else
    insert into outreach_events (enrollment_id, step_number, event_type, detail)
    values (e.id, st.step_number, 'failed', left(coalesce(p_error, 'unknown error'), 500));
    if e.status <> 'active' then return; end if;
    if e.fail_count + 1 >= 3 then
      update outreach_enrollments
        set fail_count = e.fail_count + 1, status = 'stopped', stop_reason = 'send_failed', next_send_at = null
        where id = e.id;
    else
      update outreach_enrollments
        set fail_count = e.fail_count + 1, next_send_at = now() + interval '1 day'
        where id = e.id;
    end if;
  end if;
end;
$$;

-- Internal: stop every open enrollment for an address. Unsubscribes, bounces
-- and complaints also go on the global suppression list. A reply puts the
-- property on the next-action list so it can't be missed.
create or replace function _outreach_stop(p_email text, p_reason text, p_enrollment_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  addr text := lower(btrim(coalesce(p_email, '')));
  n integer := 0;
  r record;
begin
  if addr = '' then return 0; end if;
  if p_reason in ('unsubscribed', 'bounced', 'complained') then
    insert into outreach_suppressions (email, reason, source_enrollment_id)
    values (addr, p_reason, p_enrollment_id)
    on conflict (email) do nothing;
  end if;

  for r in
    select x.id, x.property_id from outreach_enrollments x
    where lower(x.to_email) = addr and x.status in ('active', 'paused')
    for update
  loop
    update outreach_enrollments
      set status = case p_reason
                     when 'replied' then 'replied'
                     when 'bounced' then 'bounced'
                     when 'unsubscribed' then 'unsubscribed'
                     else 'stopped'
                   end,
          stop_reason = p_reason,
          next_send_at = null
      where id = r.id;
    insert into outreach_events (enrollment_id, event_type, detail)
    values (
      r.id,
      case p_reason when 'replied' then 'replied' when 'bounced' then 'bounced' when 'unsubscribed' then 'unsubscribed' else 'stopped' end,
      p_reason
    );
    if p_reason = 'replied' and r.property_id is not null then
      update properties
        set next_action_at = now(), next_action_note = 'Replied to outreach. Follow up.'
        where id = r.property_id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Staff / server entry point: mark an address as replied, bounced, complained, or manually stopped.
create or replace function stop_outreach(p_email text, p_reason text default 'replied')
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _outreach_caller_ok() then raise exception 'Not allowed'; end if;
  if p_reason not in ('replied', 'bounced', 'complained', 'manual') then raise exception 'Unknown reason'; end if;
  return _outreach_stop(p_email, p_reason, null);
end;
$$;

-- Public unsubscribe link target. The token is a random UUID unique to one
-- enrollment; it can only unsubscribe that one address.
create or replace function outreach_unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  enr record;
begin
  select x.id, x.to_email into enr from outreach_enrollments x where x.unsubscribe_token = p_token;
  if not found then return false; end if;
  perform _outreach_stop(enr.to_email, 'unsubscribed', enr.id);
  return true;
end;
$$;

-- Internal helpers are not callable from the browser; the wrappers above are.
revoke all on function _outreach_stop(text, text, uuid) from public, anon, authenticated;
revoke all on function _outreach_blocked_reason(text, uuid) from public, anon, authenticated;
grant execute on function outreach_unsubscribe(uuid) to anon, authenticated;
