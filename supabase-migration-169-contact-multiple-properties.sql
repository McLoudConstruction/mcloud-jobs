-- Migration 169: one person, several properties.
--
-- Run after 168. Safe to run twice.
--
-- Before: a person (contacts row) could be linked to one property, through contacts.property_id.
-- A property manager who looks after three buildings needed three copies of themselves.
--
-- Now: contact_properties lists every property a person is linked to. contacts.property_id stays
-- and keeps meaning "main property", so the Property field on the Person form, the bot API, the
-- Sales page lists and every older function behave exactly as before.
--
--   * The main property is always one of the links. A trigger keeps the two in step: setting or
--     changing contacts.property_id adds that link and drops the link to the property it replaces.
--     That is what the Property field has always done (changing it replaced the old property).
--   * Extra properties are added and removed on purpose, with crm_link_contact_property() and
--     crm_unlink_contact_property(). Neither one touches a person's other links.
--   * Removing the main property while other links remain promotes the oldest remaining one.
--   * Deleting a person or a property removes its links (cascade). The owner delete preview finds
--     this table by itself.
--
-- Also updated so the new links are honoured:
--   _crm_touch_scope   a property's and a company's Touches now include people linked through
--                      contact_properties, not only through contacts.property_id.
--   crm_log_touch      a touch about any of a person's linked properties is accepted. Before, it was
--                      refused unless the property matched contacts.property_id.
--
-- Not changed: the bot API (migrations 161, 166, 167, 168). A bot still sees a person at their main
-- property only. Widening it is a separate decision, see the notes at the bottom.

create table if not exists contact_properties (
  contact_id uuid not null references contacts(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, property_id)
);

create index if not exists contact_properties_property_idx on contact_properties (property_id);

alter table contact_properties enable row level security;
drop policy if exists "Admin full access to contact_properties" on contact_properties;
create policy "Admin full access to contact_properties" on contact_properties for all
  using (is_admin()) with check (is_admin());

-- Everyone already linked through the single column gets a row.
insert into contact_properties (contact_id, property_id)
select c.id, c.property_id from contacts c where c.property_id is not null
on conflict do nothing;

-- Keeps the main property (contacts.property_id) listed in contact_properties.
create or replace function _contacts_property_link_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.property_id is not distinct from old.property_id then return null; end if;
    if old.property_id is not null then
      delete from contact_properties where contact_id = new.id and property_id = old.property_id;
    end if;
  end if;
  if new.property_id is not null then
    insert into contact_properties (contact_id, property_id) values (new.id, new.property_id)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists contacts_property_link_sync on contacts;
create trigger contacts_property_link_sync
  after insert or update of property_id on contacts
  for each row execute function _contacts_property_link_sync();

-- Link a person to one more property. A person with no main property gets this one as main.
create or replace function crm_link_contact_property(p_contact_id uuid, p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact contacts%rowtype;
  v_prop properties%rowtype;
  v_already boolean;
begin
  if not (coalesce(is_admin(), false) or _is_trusted_context()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select * into v_contact from contacts where id = p_contact_id;
  if not found then raise exception 'That person no longer exists.'; end if;
  select * into v_prop from properties where id = p_property_id;
  if not found then raise exception 'That property no longer exists.'; end if;

  select exists (select 1 from contact_properties where contact_id = p_contact_id and property_id = p_property_id)
    into v_already;
  if v_already then
    return jsonb_build_object('ok', true, 'already', true,
      'main_property_id', v_contact.property_id,
      'main_property_name', (select p.property_name from properties p where p.id = v_contact.property_id));
  end if;

  if v_contact.property_id is null then
    -- First property: it becomes the main one. The trigger adds the link.
    update contacts set property_id = p_property_id, property = v_prop.property_name where id = p_contact_id;
    return jsonb_build_object('ok', true, 'already', false, 'became_main', true,
      'main_property_id', p_property_id, 'main_property_name', v_prop.property_name);
  end if;

  insert into contact_properties (contact_id, property_id) values (p_contact_id, p_property_id);
  return jsonb_build_object('ok', true, 'already', false, 'became_main', false,
    'main_property_id', v_contact.property_id,
    'main_property_name', (select p.property_name from properties p where p.id = v_contact.property_id));
end;
$$;

-- Remove one link. The person and the property stay. If it was the main property and other links
-- remain, the oldest remaining link becomes the main one.
create or replace function crm_unlink_contact_property(p_contact_id uuid, p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact contacts%rowtype;
  v_next uuid;
  v_next_name text;
  v_removed_name text;
begin
  if not (coalesce(is_admin(), false) or _is_trusted_context()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select * into v_contact from contacts where id = p_contact_id;
  if not found then raise exception 'That person no longer exists.'; end if;

  if v_contact.property_id is not distinct from p_property_id then
    select property_name into v_removed_name from properties where id = p_property_id;
    select cp.property_id, p.property_name into v_next, v_next_name
    from contact_properties cp join properties p on p.id = cp.property_id
    where cp.contact_id = p_contact_id and cp.property_id <> p_property_id
    order by cp.created_at, cp.property_id
    limit 1;
    -- The trigger drops the old main link and keeps the new one.
    -- With nothing left to promote, property_id is cleared (and the trigger removes the link). The free
    -- text property name on the person is cleared too when it is the name of the property just removed,
    -- so the Property field does not keep showing a property they are no longer linked to.
    update contacts set property_id = v_next,
      property = case
        when v_next is not null then v_next_name
        when lower(btrim(coalesce(v_contact.property, ''))) = lower(btrim(coalesce(v_removed_name, ''))) then null
        else v_contact.property end
      where id = p_contact_id;
    return jsonb_build_object('ok', true, 'was_main', true,
      'main_property_id', v_next, 'main_property_name', v_next_name);
  end if;

  delete from contact_properties where contact_id = p_contact_id and property_id = p_property_id;
  return jsonb_build_object('ok', true, 'was_main', false,
    'main_property_id', v_contact.property_id,
    'main_property_name', (select p.property_name from properties p where p.id = v_contact.property_id));
end;
$$;

revoke all on function crm_link_contact_property(uuid, uuid) from public, anon;
grant execute on function crm_link_contact_property(uuid, uuid) to authenticated;
revoke all on function crm_unlink_contact_property(uuid, uuid) from public, anon;
grant execute on function crm_unlink_contact_property(uuid, uuid) to authenticated;
revoke all on function _contacts_property_link_sync() from public, anon, authenticated;

-- ── Touches: a property's and a company's history include people linked through contact_properties ──
create or replace function _crm_touch_scope(
  p_kind text, p_id uuid, p_internal_domains text[],
  out contact_ids uuid[], out property_ids uuid[], out addresses text[], out domains text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_own text[];
begin
  contact_ids := '{}'; property_ids := '{}'; addresses := '{}'; domains := '{}';

  if p_kind = 'contact' then
    contact_ids := array[p_id];
    select _crm_emails(c.contact_email) || _crm_emails(c.billing_email) into addresses from contacts c where c.id = p_id;

  elsif p_kind = 'property' then
    property_ids := array[p_id];
    select coalesce(array_agg(c.id), '{}') into contact_ids from contacts c
      where c.property_id = p_id
         or exists (select 1 from contact_properties cp where cp.contact_id = c.id and cp.property_id = p_id);
    select _crm_emails(p.contact_email) into addresses from properties p where p.id = p_id;
    addresses := coalesce(addresses, '{}') || coalesce((
      select array_agg(a) from contacts c, unnest(_crm_emails(c.contact_email) || _crm_emails(c.billing_email)) a
      where c.id = any(contact_ids)
    ), '{}');

  elsif p_kind = 'company' then
    select coalesce(array_agg(p.id), '{}') into property_ids from properties p where p.company_id = p_id;
    select coalesce(array_agg(c.id), '{}') into contact_ids from contacts c
      where c.company_id = p_id or c.property_id = any(property_ids)
         or exists (select 1 from contact_properties cp where cp.contact_id = c.id and cp.property_id = any(property_ids));
    select _crm_emails(co.contact_email) into v_own from companies co where co.id = p_id;
    v_own := coalesce(v_own, '{}') || coalesce((
      select array_agg(a) from contacts c, unnest(_crm_emails(c.contact_email) || _crm_emails(c.billing_email)) a
      where c.id = any(contact_ids)
    ), '{}');
    addresses := v_own || coalesce((
      select array_agg(a) from properties p, unnest(_crm_emails(p.contact_email)) a where p.id = any(property_ids)
    ), '{}');
    -- Mail from anyone at the company's own domain counts too, unless it is
    -- shared webmail or one of our own domains.
    domains := coalesce((
      select array_agg(distinct split_part(a, '@', 2)) from unnest(v_own) a
      where not _crm_free_mail(split_part(a, '@', 2))
        and split_part(a, '@', 2) <> all(coalesce(p_internal_domains, '{}'))
    ), '{}');

  else
    raise exception 'Unknown record type.';
  end if;

  addresses := coalesce((select array_agg(distinct a) from unnest(addresses) a), '{}');
end;
$$;
revoke all on function _crm_touch_scope(text, uuid, text[]) from public, anon, authenticated;

-- ── Logging a touch: any of the person's linked properties is fine ──

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
    -- A person can be linked to several properties (contact_properties). The touch may be about
    -- any of them. It is only refused when the person has links and none of them is this property.
    if v_pid is not null
       and (v_contact.property_id is not null or exists (select 1 from contact_properties cp where cp.contact_id = p_contact_id))
       and v_pid is distinct from v_contact.property_id
       and not exists (select 1 from contact_properties cp where cp.contact_id = p_contact_id and cp.property_id = v_pid) then
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

-- Notes
--  * Bot API: a bot still finds a person at their main property only (contacts.property_id). A person's
--    other properties are staff-side for now. To widen it, the bot functions in 161, 166, 167 and 168
--    that read contacts.property_id would need to also read contact_properties.
--  * Rollback: nothing outside this migration depends on contact_properties. drop table contact_properties
--    cascade; drop function crm_link_contact_property(uuid, uuid), crm_unlink_contact_property(uuid, uuid),
--    _contacts_property_link_sync(); then re-run 162 (the _crm_touch_scope part) and 165 (crm_log_touch).
