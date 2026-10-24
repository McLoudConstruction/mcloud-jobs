-- Migration 165: log a touch on a person with no property.
--
-- Before: every touch needed a property (outreach_touches.property_id was NOT
-- NULL), so a contact that was not linked to a property could not be logged.
-- Now: a touch may belong to a property, a person, or both.
--   Person with a linked property: stored on both, so the property's
--     timeline and last contacted update too (as before).
--   Person with no property: stored on the person only. The Person timeline
--     shows it, and nothing on any property changes.
-- Needs 163 and 164 first. The touch feed, roll up and last contacted sync
-- already work on a null property, so only the column and this function change.

alter table outreach_touches alter column property_id drop not null;

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

  -- A touch belongs to a property, a person, or both. A person with no linked
  -- property is fine: the touch is recorded on the person only.
  if v_pid is null and p_contact_id is null then
    raise exception 'Pick the property or person this touch belongs to.';
  end if;
  if v_pid is not null then
    perform 1 from properties p where p.id = v_pid;
    if not found then raise exception 'That property no longer exists.'; end if;
  end if;
  if p_next_action_at is not null and v_pid is null then
    raise exception 'A next step needs a property. This person is not linked to one.';
  end if;

  select s.full_name into v_staff from staff_users s where s.id = auth.uid();

  insert into outreach_touches (property_id, contact_id, to_email, channel, direction, outcome, note, sent_at, staff_id, staff_name)
  values (v_pid, p_contact_id, v_email, v_channel, v_direction, v_outcome, v_note, v_at, auth.uid(), v_staff)
  returning id into v_touch_id;

  -- Same rules as a bot touch: a real contact updates last contacted and moves
  -- a new prospect to Contacted. A plain note or a miss changes nothing.
  v_counts := v_outcome in ('sent', 'connected', 'voicemail', 'replied', 'interested', 'not_interested', 'unsubscribed', 'meeting_set');
  if v_counts and v_pid is not null then
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

revoke all on function crm_log_touch(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function crm_log_touch(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
