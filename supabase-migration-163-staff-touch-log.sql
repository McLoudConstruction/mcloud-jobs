-- Migration 163: staff can log a touch, and bots get an easier way to log one.
--
-- Run after 162. Safe to run twice.
--
-- 1. Staff touches. A "Log a touch" button on Person, Property and Company
--    writes to the same outreach_touches table the bots use, through
--    crm_log_touch(), so there is one history. The row records which staff
--    member logged it.
-- 2. New values everyone can use: channel "visit", outcomes "connected" and
--    "note". "connected" means you actually spoke with someone. "note" is a
--    plain note on the record and changes nothing else.
-- 3. Bots: channel defaults to email and outcome to sent, so the shortest
--    valid call is just {"email": "pat@example.com"}. Everything else is
--    unchanged. The bot function is replaced whole, with those lines changed.
-- 4. The shared touch feed shows staff touches with their own label. Bots
--    can see that a staff touch happened (so nobody is contacted twice) but
--    never the note.

alter table outreach_touches add column if not exists staff_id uuid references staff_users(id) on delete set null;
alter table outreach_touches add column if not exists staff_name text;   -- kept so history reads right if the account is removed

-- ─── Allowed values ─────────────────────────────────────────────────────
create or replace function _bot_enums()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'channels', jsonb_build_array('email', 'call', 'text', 'mail', 'visit', 'other'),
    'directions', jsonb_build_array('outbound', 'inbound'),
    'outcomes', jsonb_build_array('sent', 'replied', 'bounced', 'interested', 'not_interested', 'unsubscribed', 'no_answer', 'voicemail', 'meeting_set', 'wrong_contact', 'connected', 'note'),
    'lead_stages', jsonb_build_array('prospecting', 'contacted', 'site_request', 'proposal', 'won', 'lost', 'converted'),
    'prospect_stages', jsonb_build_array('prospecting', 'contacted', 'proposal', 'won', 'lost'),
    'tiers', jsonb_build_array('A', 'B', 'C'),
    'known_verticals', jsonb_build_array('multi_family', 'hotel_lodging', 'office', 'retail', 'recreational', 'church', 'residential')
  );
$$;

-- ─── Staff: log a touch ─────────────────────────────────────────────────
create or replace function crm_log_touch(
  p_property_id uuid,
  p_contact_id uuid default null,
  p_channel text default 'call',
  p_outcome text default 'connected',
  p_direction text default null,
  p_note text default null,
  p_happened_at timestamptz default null,
  p_next_action_at timestamptz default null,
  p_next_action_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid := p_property_id;
  v_contact contacts%rowtype;
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_direction text := lower(btrim(coalesce(p_direction, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_at timestamptz := coalesce(p_happened_at, now());
  v_email text;
  v_staff text;
  v_touch_id uuid;
  v_effects text[] := '{}';
  v_counts boolean;
begin
  if not (coalesce(is_admin(), false) or _is_trusted_context()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  if not ((_bot_enums() -> 'channels') ? v_channel) then
    raise exception 'Pick a type: call, visit, text, email, mail or other.';
  end if;
  if not ((_bot_enums() -> 'outcomes') ? v_outcome) then
    raise exception 'Pick what happened.';
  end if;
  if v_direction = '' then
    v_direction := case when v_outcome = 'replied' then 'inbound' else 'outbound' end;
  end if;
  if not ((_bot_enums() -> 'directions') ? v_direction) then
    raise exception 'Direction must be outbound or inbound.';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'That note is too long (max 2000 characters).';
  end if;
  if v_at > now() + interval '5 minutes' then
    raise exception 'That time is in the future.';
  end if;
  if v_at < now() - interval '5 years' then
    raise exception 'That time is more than 5 years ago.';
  end if;

  if p_contact_id is not null then
    select * into v_contact from contacts c where c.id = p_contact_id;
    if not found then raise exception 'That person no longer exists.'; end if;
    if v_pid is null then v_pid := v_contact.property_id; end if;
    if v_contact.property_id is not null and v_pid is not null and v_pid <> v_contact.property_id then
      raise exception 'That person is linked to a different property.';
    end if;
    v_email := nullif(lower(btrim(coalesce(v_contact.contact_email, ''))), '');
  end if;

  if v_pid is null then
    raise exception 'Pick the property this touch belongs to.';
  end if;
  perform 1 from properties p where p.id = v_pid;
  if not found then raise exception 'That property no longer exists.'; end if;

  select s.full_name into v_staff from staff_users s where s.id = auth.uid();

  insert into outreach_touches (property_id, contact_id, to_email, channel, direction, outcome, note, sent_at, staff_id, staff_name)
  values (v_pid, p_contact_id, v_email, v_channel, v_direction, v_outcome, v_note, v_at, auth.uid(), v_staff)
  returning id into v_touch_id;

  -- Same rules as a bot touch: a real contact updates last contacted and moves
  -- a new prospect to Contacted. A plain note or a miss changes nothing.
  v_counts := v_outcome in ('sent', 'connected', 'voicemail', 'replied', 'interested', 'not_interested', 'unsubscribed', 'meeting_set');
  if v_counts then
    update properties
      set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'::timestamptz), v_at),
          prospect_stage = case when prospect_stage = 'prospecting' then 'contacted' else prospect_stage end
      where id = v_pid;
    v_effects := v_effects || 'last_contacted_updated'::text;
  end if;

  if v_outcome = 'bounced' and v_email is not null then
    perform _outreach_stop(v_email, 'bounced', null);
    v_effects := v_effects || 'address_suppressed'::text;
  elsif v_outcome = 'unsubscribed' and v_email is not null then
    perform _outreach_stop(v_email, 'unsubscribed', null);
    update contacts set automated_emails_opt_out = true where lower(btrim(contact_email)) = v_email and not automated_emails_opt_out;
    v_effects := v_effects || 'address_suppressed'::text || 'contact_opted_out'::text;
  end if;

  if p_next_action_at is not null then
    update properties
      set next_action_at = p_next_action_at,
          next_action_note = left(nullif(btrim(coalesce(p_next_action_note, '')), ''), 300)
      where id = v_pid;
    v_effects := v_effects || 'next_step_set'::text;
  end if;

  return jsonb_build_object('ok', true, 'touch_id', v_touch_id, 'property_id', v_pid, 'effects', to_jsonb(v_effects));
end;
$$;

-- ─── Shared feed: staff touches get their own label ─────────────────────
create or replace function _crm_touch_feed(
  p_all boolean, p_contact_ids uuid[], p_property_ids uuid[], p_addresses text[], p_domains text[], p_mail boolean
)
returns table (
  happened_at timestamptz, id uuid, source text, channel text, direction text, kind text,
  summary text, note text, actor text, email text,
  person_id uuid, person_name text, property_id uuid, property_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with touches as (
    select t.sent_at as happened_at, t.id,
           case when t.bot_key_id is null and t.bot_name is null then 'staff' else 'touch' end as source,
           t.channel, t.direction, t.outcome as kind,
           null::text as summary,
           case when t.bot_key_id is null and t.bot_name is null and not p_mail then null else t.note end as note,
           case when t.bot_key_id is null and t.bot_name is null then (case when p_mail then t.staff_name else 'Staff' end) else t.bot_name end as actor,
           t.to_email as email,
           t.contact_id as person_id, t.property_id
    from outreach_touches t
    where p_all
       or t.property_id = any(p_property_ids)
       or t.contact_id = any(p_contact_ids)
       or lower(t.to_email) = any(p_addresses)
  ), sequence_events as (
    select e.created_at as happened_at, e.id, 'sequence'::text as source, 'email'::text as channel,
           case when e.event_type = 'sent' then 'outbound' else 'inbound' end as direction,
           e.event_type as kind,
           e.detail as summary, null::text as note, s.name as actor, en.to_email as email,
           en.contact_id as person_id, en.property_id
    from outreach_events e
    join outreach_enrollments en on en.id = e.enrollment_id
    left join outreach_sequences s on s.id = en.sequence_id
    where e.event_type in ('sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed')
      and (p_all
           or en.property_id = any(p_property_ids)
           or en.contact_id = any(p_contact_ids)
           or lower(en.to_email) = any(p_addresses))
  ), mail as (
    select m.received_at as happened_at, m.id, 'email'::text as source, 'email'::text as channel, m.direction,
           case when m.direction = 'outbound' then 'sent' else 'received' end as kind,
           m.subject as summary, m.snippet as note, null::text as actor,
           case when m.direction = 'outbound' then m.to_email else m.from_email end as email,
           null::uuid as person_id, null::uuid as property_id
    from email_messages m
    where p_mail and not p_all
      and (m.participants && p_addresses or m.participant_domains && p_domains)
      -- A sequence email is already shown as a sequence event. The mailbox
      -- sync stores the same message, so it is left out here.
      and not exists (
        select 1 from outreach_events oe
        where oe.event_type = 'sent' and oe.provider_message_id is not null
          and m.provider_message_id is not null
          and split_part(oe.provider_message_id, ':', 1) = m.provider_message_id
      )
  ), everything as (
    select * from touches
    union all select * from sequence_events
    union all select * from mail
  )
  select a.happened_at, a.id, a.source, a.channel, a.direction, a.kind, a.summary, a.note, a.actor, a.email,
         coalesce(a.person_id, mp.id) as person_id,
         coalesce(pc.name, mp.name) as person_name,
         a.property_id,
         pr.property_name
  from everything a
  left join contacts pc on pc.id = a.person_id
  left join properties pr on pr.id = a.property_id
  left join lateral (
    -- For mail, find which person in scope the address belongs to.
    select c.id, c.name from contacts c
    where a.source = 'email' and c.id = any(p_contact_ids)
      and (_crm_emails(c.contact_email) || _crm_emails(c.billing_email)) && _crm_emails(a.email)
    limit 1
  ) mp on true;
$$;

-- ─── Bots: the log function, with defaults ──────────────────────────────

create or replace function bot_sales_outreach_log(p_key text, p_body jsonb, p_idem text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  b jsonb := p_body;
  allowed text[] := array['prospect_id', 'email', 'channel', 'direction', 'outcome', 'note', 'sent_at'];
  unknown text[];
  v_idem text := nullif(btrim(p_idem), '');
  v_hash text;
  v_prior record;
  v_msg text;

  v_pid uuid;
  v_email text;
  v_channel text;
  v_direction text;
  v_outcome text;
  v_note text;
  v_sent_at timestamptz;
  v_matches uuid[];
  v_contact_id uuid;
  v_before text;
  v_old_note text;
  v_touch_id uuid;
  v_dup uuid;
  v_effects text[] := '{}';
  v_n integer;
  v_counts boolean;
  v_resp jsonb;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if b is null or jsonb_typeof(b) <> 'object' then
    return _bot_reject(k, 'outreach.log', 422, 'invalid_body', 'Send a JSON object with prospect_id or email. channel defaults to email and outcome to sent.');
  end if;
  unknown := _bot_unknown_keys(b, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'outreach.log', 422, 'unknown_field', format('Unknown field: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  if v_idem is not null then
    if v_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
      return _bot_reject(k, 'outreach.log', 422, 'invalid_idempotency_key', 'Idempotency-Key must be 8 to 128 characters: letters, numbers, and _ . : -');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('bot_idem:' || k.id::text || ':' || v_idem, 0));
    v_hash := md5(b::text);
    select * into v_prior from bot_idempotency i where i.bot_key_id = k.id and i.idem_key = v_idem;
    if found then
      if v_prior.action <> 'outreach.log' or v_prior.request_hash <> v_hash then
        return _bot_reject(k, 'outreach.log', 422, 'idempotency_conflict', 'That Idempotency-Key was already used for a different request.');
      end if;
      perform _bot_log(k, 'outreach.log', 'ok', jsonb_build_object('replay', true));
      return v_prior.response || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  begin
    v_email := _bot_email(b, 'email');
    v_channel := coalesce(lower(_bot_text(b, 'channel', 20)), 'email');
    v_outcome := lower(_bot_text(b, 'outcome', 30));
    v_direction := lower(_bot_text(b, 'direction', 20));
    v_note := _bot_text(b, 'note', 2000);
    -- Most bot touches are "I emailed them", so an email, text or mailing with no outcome is a send.
    if v_outcome is null then
      if v_channel in ('email', 'text', 'mail') then
        v_outcome := 'sent';
      else
        raise exception 'outcome is required for % touches. Allowed: %.', v_channel, (select string_agg(x, ', ') from jsonb_array_elements_text(_bot_enums() -> 'outcomes') x) using errcode = 'BK422';
      end if;
    end if;
    if not ((_bot_enums() -> 'channels') ? v_channel) then
      raise exception 'Unknown channel "%". Allowed: %.', v_channel, (select string_agg(x, ', ') from jsonb_array_elements_text(_bot_enums() -> 'channels') x) using errcode = 'BK422';
    end if;
    if not ((_bot_enums() -> 'outcomes') ? v_outcome) then
      raise exception 'Unknown outcome "%". Allowed: %.', v_outcome, (select string_agg(x, ', ') from jsonb_array_elements_text(_bot_enums() -> 'outcomes') x) using errcode = 'BK422';
    end if;
    -- A reply comes from them. Everything else defaults to something we did.
    v_direction := coalesce(v_direction, case when v_outcome = 'replied' then 'inbound' else 'outbound' end);
    if not ((_bot_enums() -> 'directions') ? v_direction) then
      raise exception 'Unknown direction "%". Allowed: outbound, inbound.', v_direction using errcode = 'BK422';
    end if;

    if b ? 'prospect_id' and nullif(btrim(b ->> 'prospect_id'), '') is not null then
      begin
        v_pid := (b ->> 'prospect_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'prospect_id must be a UUID.' using errcode = 'BK422';
      end;
    end if;
    if v_pid is null and v_email is null then
      raise exception 'Send prospect_id, or the email address you contacted so the prospect can be found.' using errcode = 'BK422';
    end if;

    if b ? 'sent_at' and nullif(btrim(b ->> 'sent_at'), '') is not null then
      begin
        v_sent_at := (b ->> 'sent_at')::timestamptz;
      exception when others then
        raise exception 'sent_at must be an ISO 8601 timestamp, like 2026-10-23T14:30:00Z.' using errcode = 'BK422';
      end;
      if v_sent_at > now() + interval '5 minutes' then
        raise exception 'sent_at cannot be in the future.' using errcode = 'BK422';
      end if;
      if v_sent_at < now() - interval '400 days' then
        raise exception 'sent_at is more than 400 days ago.' using errcode = 'BK422';
      end if;
    end if;
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'outreach.log', 422, 'invalid_field', v_msg);
  end;
  v_sent_at := coalesce(v_sent_at, now());

  -- Find the prospect.
  if v_pid is not null then
    perform 1 from properties p where p.id = v_pid;
    if not found then
      return _bot_reject(k, 'outreach.log', 404, 'unknown_prospect', 'No prospect with that prospect_id.');
    end if;
  else
    select coalesce(array_agg(distinct m.pid), '{}'::uuid[]) into v_matches
    from (
      select p.id as pid from properties p where lower(btrim(p.contact_email)) = v_email
      union
      select c.property_id as pid from contacts c where lower(btrim(c.contact_email)) = v_email and c.property_id is not null
    ) m;
    if cardinality(v_matches) = 0 then
      return _bot_reject(k, 'outreach.log', 404, 'unknown_prospect', 'No prospect has that email address. Add it first with POST /api/bot/sales/prospects.');
    elsif cardinality(v_matches) > 1 then
      return _bot_reject(k, 'outreach.log', 409, 'ambiguous_prospect',
        'That email address belongs to more than one prospect. Send prospect_id to say which.',
        jsonb_build_object('prospect_ids', to_jsonb(v_matches[1:10])));
    end if;
    v_pid := v_matches[1];
  end if;

  -- The same touch sent twice (same bot, prospect, channel, direction, outcome and time) is one touch.
  select t.id into v_dup from outreach_touches t
  where t.property_id = v_pid and t.bot_key_id = k.id and t.channel = v_channel and t.direction = v_direction
    and t.outcome = v_outcome and t.sent_at = v_sent_at
  limit 1;
  if v_dup is not null then
    v_resp := jsonb_build_object('ok', true, 'status', 'duplicate', 'touch_id', v_dup, 'prospect_id', v_pid, 'effects', '[]'::jsonb);
    perform _bot_log(k, 'outreach.log', 'ok', jsonb_build_object('prospect_id', v_pid, 'status', 'duplicate'));
    return v_resp;
  end if;

  if v_email is not null then
    select c.id into v_contact_id from contacts c
    where c.property_id = v_pid and lower(btrim(c.contact_email)) = v_email
    limit 1;
  end if;

  insert into outreach_touches (property_id, contact_id, to_email, channel, direction, outcome, note, sent_at, bot_key_id, bot_name)
  values (v_pid, v_contact_id, v_email, v_channel, v_direction, v_outcome, v_note, v_sent_at, k.id, k.name)
  returning id into v_touch_id;

  -- Side effects, kept to what staff would otherwise have to do by hand.
  select p.prospect_stage, p.next_action_note into v_before, v_old_note from properties p where p.id = v_pid for update;

  v_counts := v_outcome in ('sent', 'connected', 'voicemail', 'replied', 'interested', 'not_interested', 'unsubscribed', 'meeting_set');
  if v_counts then
    update properties
      set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'::timestamptz), v_sent_at),
          prospect_stage = case when prospect_stage = 'prospecting' then 'contacted' else prospect_stage end
      where id = v_pid;
    v_effects := v_effects || 'last_contacted_updated'::text;
    if v_before = 'prospecting' then v_effects := v_effects || 'stage_set_contacted'::text; end if;
  end if;

  if v_outcome in ('replied', 'interested', 'meeting_set') then
    if v_email is not null then
      v_n := _outreach_stop(v_email, 'replied', null);
      if v_n > 0 then v_effects := v_effects || format('sequences_stopped:%s', v_n); end if;
    end if;
    update properties
      set next_action_at = now(),
          next_action_note = left(
            format('Bot %s: %s. Follow up.', k.name, replace(v_outcome, '_', ' '))
            || case when coalesce(v_old_note, '') <> '' and v_old_note not like 'Bot %' then ' (previous: ' || v_old_note || ')' else '' end,
            300)
      where id = v_pid;
    v_effects := v_effects || 'follow_up_flagged'::text;
  elsif v_outcome = 'bounced' and v_email is not null then
    v_n := _outreach_stop(v_email, 'bounced', null);
    v_effects := v_effects || 'address_suppressed'::text;
    if v_n > 0 then v_effects := v_effects || format('sequences_stopped:%s', v_n); end if;
  elsif v_outcome = 'unsubscribed' and v_email is not null then
    v_n := _outreach_stop(v_email, 'unsubscribed', null);
    update contacts set automated_emails_opt_out = true where lower(btrim(contact_email)) = v_email and not automated_emails_opt_out;
    v_effects := v_effects || 'address_suppressed'::text || 'contact_opted_out'::text;
    if v_n > 0 then v_effects := v_effects || format('sequences_stopped:%s', v_n); end if;
  elsif v_outcome = 'not_interested' and v_email is not null then
    v_n := _outreach_stop(v_email, 'manual', null);
    if v_n > 0 then v_effects := v_effects || format('sequences_stopped:%s', v_n); end if;
  end if;

  v_resp := jsonb_build_object('ok', true, 'status', 'logged', 'touch_id', v_touch_id, 'prospect_id', v_pid, 'effects', to_jsonb(v_effects));

  if v_idem is not null then
    insert into bot_idempotency (bot_key_id, idem_key, action, request_hash, response)
    values (k.id, v_idem, 'outreach.log', v_hash, v_resp)
    on conflict (bot_key_id, idem_key) do nothing;
  end if;

  perform _bot_log(k, 'outreach.log', 'ok', jsonb_build_object('prospect_id', v_pid, 'touch_id', v_touch_id, 'outcome', v_outcome));
  return v_resp;
end;
$$;

-- ─── Who can run what ───────────────────────────────────────────────────
revoke all on function crm_log_touch(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function crm_log_touch(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
