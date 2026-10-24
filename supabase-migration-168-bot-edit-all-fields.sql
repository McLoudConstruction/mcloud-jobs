-- Migration 168: bots may edit every field on prospects, people and companies.
--
-- Run after 167. Safe to run twice. Decided by the owner on 2026-10-24.
--
-- What changes
--  1. A bot's value now replaces what is there. Before, a value that differed from what
--     staff entered was left alone and listed under "skipped". Every change is still saved
--     in bot_audit_log with the value before and after, so it can be put back by hand.
--  2. A field sent as JSON null is cleared, for optional fields. Required fields (the name
--     of a person, prospect or company), stage, do_not_contact, email_confidence and
--     blocked_reason ignore null as before.
--  3. More fields can be written:
--       prospects: name, source, target_value, active, last_visited_at
--       people:    shared_email
--     Companies and the other fields were already writable, they now overwrite.
--
-- What does not change
--  - Subcontractors stay invisible: not listed, not fetched, not linked, not edited.
--  - Billing details, tax ids, COI and W-9 paths, portal fields and custom columns are not
--    writable. Neither are system fields: created_by_bot_id, is_test, stage_changed_at,
--    last_contacted_at, won_job_id and dnc_source.
--  - A bot can set do_not_contact to true but never back to false.
--  - A bot cannot clear a blocked email reason and cannot lower email_confidence from
--    verified.
--  - A bot cannot move a prospect out of won. Setting won still needs a won_note.
--  - Leads (opportunities) stay read only.
--  - There is still no delete. Owner only delete stays in the app.
--  - Writes still need an Idempotency-Key, are rate limited and are audited.
--
-- Note: "notes" now replaces the whole notes field. Use "add_note" to append a dated line
-- without losing what staff wrote.

-- Sent as JSON null, an optional field is cleared. Fields not listed as clearable ignore null,
-- as before. Returns column name -> null for the fields to clear.
create or replace function _bot_null_cols(b jsonb, p_map jsonb, p_clearable text[])
returns jsonb
language plpgsql
immutable
as $$
declare
  k text;
  v jsonb;
  r jsonb := '{}'::jsonb;
begin
  for k, v in select * from jsonb_each(b) loop
    if v = 'null'::jsonb and k = any(p_clearable) then
      r := r || jsonb_build_object(coalesce(p_map ->> k, k), null);
    end if;
  end loop;
  return r;
end;
$$;

create or replace function _bot_fill(p_table text, p_id uuid, p_fields jsonb, p_overwrite text[], p_names jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur jsonb;
  k text;
  nv jsonb;
  cv jsonb;
  nm text;
  changes jsonb := '{}'::jsonb;
  updated jsonb := '{}'::jsonb;
  skipped jsonb := '[]'::jsonb;
  writable text[];
begin
  if p_table = 'contacts' then
    writable := array['name', 'first_name', 'last_name', 'contact_email', 'contact_phone', 'position', 'role', 'contact_type', 'team_office',
                      'address_street', 'address_unit', 'address_city', 'address_state', 'address_zip',
                      'phone_type', 'contact_phone2', 'phone2_type', 'email_confidence', 'email_blocked_reason', 'shared_email',
                      'company_id', 'property_id', 'property', 'management_company', 'notes'];
    select to_jsonb(t) into cur from contacts t where t.id = p_id for update;
  elsif p_table = 'companies' then
    writable := array['company_name', 'company_type', 'street', 'unit', 'city', 'state', 'zip', 'contact_name', 'contact_email', 'contact_phone', 'notes'];
    select to_jsonb(t) into cur from companies t where t.id = p_id for update;
  elsif p_table = 'properties' then
    writable := array['property_type', 'prospect_vertical', 'prospect_tier', 'property_street', 'property_unit', 'property_city', 'property_state', 'property_zip',
                      'management_company', 'year_built', 'sq_ft', 'contact_name', 'contact_email', 'contact_phone', 'company_id', 'notes',
                      'prospect_stage', 'next_action_at', 'next_action_note', 'lost_reason', 'reengage_at', 'do_not_contact', 'won_at', 'won_note',
                      'property_name', 'prospect_source', 'target_value', 'active', 'last_visited_at'];
    select to_jsonb(t) into cur from properties t where t.id = p_id for update;
  else
    raise exception 'Table not allowed.';
  end if;
  if cur is null then return null; end if;

  for k, nv in select * from jsonb_each(p_fields) loop
    if k <> all(writable) then
      raise exception 'Column % is not writable.', k;
    end if;
    -- Two things a bot can set but never undo, whatever the caller passed in.
    if k = 'do_not_contact' and nv is distinct from 'true'::jsonb then
      raise exception 'A bot cannot clear do_not_contact.';
    end if;
    if k = 'email_blocked_reason' and nv = 'null'::jsonb then
      raise exception 'A bot cannot clear a blocked email reason.';
    end if;
    cv := cur -> k;
    nm := coalesce(p_names ->> k, k);
    -- Migration 168: every writable column overwrites (the audit row keeps before and after).
    if true then
      if (cv is null or cv = 'null'::jsonb) and nv = 'null'::jsonb then continue; end if;
      if cv is not null and cv <> 'null'::jsonb and nv <> 'null'::jsonb and (cv #>> '{}') = (nv #>> '{}') then continue; end if;
      changes := changes || jsonb_build_object(k, nv);
      updated := updated || jsonb_build_object(nm, jsonb_build_object('before', cv, 'after', nv));
    else
      if nv = 'null'::jsonb then continue; end if;
      if cv is null or cv = 'null'::jsonb or (jsonb_typeof(cv) = 'string' and btrim(cv #>> '{}') = '') then
        changes := changes || jsonb_build_object(k, nv);
        updated := updated || jsonb_build_object(nm, jsonb_build_object('before', null, 'after', nv));
      elsif lower(btrim(cv #>> '{}')) = lower(btrim(nv #>> '{}')) then
        continue;
      else
        skipped := skipped || jsonb_build_array(jsonb_build_object('field', nm, 'current', cv, 'sent', nv));
      end if;
    end if;
  end loop;

  if changes <> '{}'::jsonb then
    if p_table = 'contacts' then
      update contacts t set
        name = case when changes ? 'name' then r.name else t.name end,
        first_name = case when changes ? 'first_name' then r.first_name else t.first_name end,
        last_name = case when changes ? 'last_name' then r.last_name else t.last_name end,
        contact_email = case when changes ? 'contact_email' then r.contact_email else t.contact_email end,
        contact_phone = case when changes ? 'contact_phone' then r.contact_phone else t.contact_phone end,
        position = case when changes ? 'position' then r.position else t.position end,
        role = case when changes ? 'role' then r.role else t.role end,
        contact_type = case when changes ? 'contact_type' then r.contact_type else t.contact_type end,
        team_office = case when changes ? 'team_office' then r.team_office else t.team_office end,
        address_street = case when changes ? 'address_street' then r.address_street else t.address_street end,
        address_unit = case when changes ? 'address_unit' then r.address_unit else t.address_unit end,
        address_city = case when changes ? 'address_city' then r.address_city else t.address_city end,
        address_state = case when changes ? 'address_state' then r.address_state else t.address_state end,
        address_zip = case when changes ? 'address_zip' then r.address_zip else t.address_zip end,
        company_id = case when changes ? 'company_id' then r.company_id else t.company_id end,
        property_id = case when changes ? 'property_id' then r.property_id else t.property_id end,
        property = case when changes ? 'property' then r.property else t.property end,
        management_company = case when changes ? 'management_company' then r.management_company else t.management_company end,
        phone_type = case when changes ? 'phone_type' then r.phone_type else t.phone_type end,
        contact_phone2 = case when changes ? 'contact_phone2' then r.contact_phone2 else t.contact_phone2 end,
        phone2_type = case when changes ? 'phone2_type' then r.phone2_type else t.phone2_type end,
        email_confidence = case when changes ? 'email_confidence' then r.email_confidence else t.email_confidence end,
        email_blocked_reason = case when changes ? 'email_blocked_reason' then r.email_blocked_reason else t.email_blocked_reason end,
        shared_email = case when changes ? 'shared_email' then r.shared_email else t.shared_email end,
        notes = case when changes ? 'notes' then r.notes else t.notes end
      from jsonb_populate_record(null::contacts, changes) r
      where t.id = p_id;
    elsif p_table = 'companies' then
      update companies t set
        company_name = case when changes ? 'company_name' then r.company_name else t.company_name end,
        company_type = case when changes ? 'company_type' then r.company_type else t.company_type end,
        street = case when changes ? 'street' then r.street else t.street end,
        unit = case when changes ? 'unit' then r.unit else t.unit end,
        city = case when changes ? 'city' then r.city else t.city end,
        state = case when changes ? 'state' then r.state else t.state end,
        zip = case when changes ? 'zip' then r.zip else t.zip end,
        contact_name = case when changes ? 'contact_name' then r.contact_name else t.contact_name end,
        contact_email = case when changes ? 'contact_email' then r.contact_email else t.contact_email end,
        contact_phone = case when changes ? 'contact_phone' then r.contact_phone else t.contact_phone end,
        notes = case when changes ? 'notes' then r.notes else t.notes end
      from jsonb_populate_record(null::companies, changes) r
      where t.id = p_id;
    else
      update properties t set
        property_type = case when changes ? 'property_type' then r.property_type else t.property_type end,
        prospect_vertical = case when changes ? 'prospect_vertical' then r.prospect_vertical else t.prospect_vertical end,
        prospect_tier = case when changes ? 'prospect_tier' then r.prospect_tier else t.prospect_tier end,
        property_street = case when changes ? 'property_street' then r.property_street else t.property_street end,
        property_unit = case when changes ? 'property_unit' then r.property_unit else t.property_unit end,
        property_city = case when changes ? 'property_city' then r.property_city else t.property_city end,
        property_state = case when changes ? 'property_state' then r.property_state else t.property_state end,
        property_zip = case when changes ? 'property_zip' then r.property_zip else t.property_zip end,
        management_company = case when changes ? 'management_company' then r.management_company else t.management_company end,
        year_built = case when changes ? 'year_built' then r.year_built else t.year_built end,
        sq_ft = case when changes ? 'sq_ft' then r.sq_ft else t.sq_ft end,
        contact_name = case when changes ? 'contact_name' then r.contact_name else t.contact_name end,
        contact_email = case when changes ? 'contact_email' then r.contact_email else t.contact_email end,
        contact_phone = case when changes ? 'contact_phone' then r.contact_phone else t.contact_phone end,
        company_id = case when changes ? 'company_id' then r.company_id else t.company_id end,
        notes = case when changes ? 'notes' then r.notes else t.notes end,
        prospect_stage = case when changes ? 'prospect_stage' then r.prospect_stage else t.prospect_stage end,
        next_action_at = case when changes ? 'next_action_at' then r.next_action_at else t.next_action_at end,
        next_action_note = case when changes ? 'next_action_note' then r.next_action_note else t.next_action_note end,
        lost_reason = case when changes ? 'lost_reason' then r.lost_reason else t.lost_reason end,
        reengage_at = case when changes ? 'reengage_at' then r.reengage_at else t.reengage_at end,
        do_not_contact = case when changes ? 'do_not_contact' then r.do_not_contact else t.do_not_contact end,
        won_at = case when changes ? 'won_at' then r.won_at else t.won_at end,
        won_note = case when changes ? 'won_note' then r.won_note else t.won_note end,
        property_name = case when changes ? 'property_name' then r.property_name else t.property_name end,
        prospect_source = case when changes ? 'prospect_source' then r.prospect_source else t.prospect_source end,
        target_value = case when changes ? 'target_value' then r.target_value else t.target_value end,
        active = case when changes ? 'active' then r.active else t.active end,
        last_visited_at = case when changes ? 'last_visited_at' then r.last_visited_at else t.last_visited_at end
      from jsonb_populate_record(null::properties, changes) r
      where t.id = p_id;
    end if;
  end if;
  return jsonb_build_object('updated', updated, 'skipped', skipped);
end;
$$;

create or replace function bot_sales_person_update(p_key text, p_id text, p_body jsonb, p_idem text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  b jsonb := p_body;
  allowed text[] := array['name', 'first_name', 'last_name', 'email', 'email_confidence', 'blocked_reason', 'phone', 'phone_type', 'phone2', 'phone2_type', 'position', 'role', 'type', 'team_office',
                          'street', 'unit', 'city', 'state', 'zip', 'company_id', 'property_id', 'shared_email', 'notes', 'add_note'];
  names jsonb := jsonb_build_object('contact_email', 'email', 'contact_phone', 'phone', 'contact_type', 'type',
                                    'address_street', 'street', 'address_unit', 'unit', 'address_city', 'city',
                                    'address_state', 'state', 'address_zip', 'zip', 'contact_phone2', 'phone2', 'email_blocked_reason', 'blocked_reason');
  unknown text[];
  v_idem text := nullif(btrim(p_idem), '');
  v_hash text;
  v_early jsonb;
  v_msg text;
  v_pid uuid;
  fl jsonb;
  v_add text;
  v_notes text;
  v_other uuid;
  v_cur_conf text;
  v_conf_skip jsonb;
  rep jsonb;
  v_status text;
  v_resp jsonb;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  begin
    v_pid := nullif(btrim(p_id), '')::uuid;
  exception when others then
    return _bot_reject(k, 'people.update', 422, 'invalid_id', 'The id in the address must be a person id from the people list.');
  end;
  if v_pid is null then
    return _bot_reject(k, 'people.update', 422, 'invalid_id', 'The id in the address must be a person id from the people list.');
  end if;
  if b is null or jsonb_typeof(b) <> 'object' or b = '{}'::jsonb then
    return _bot_reject(k, 'people.update', 422, 'invalid_body', 'Send a JSON object with the fields to fill in.');
  end if;
  unknown := _bot_unknown_keys(b, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'people.update', 422, 'unknown_field', format('Unknown field: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  v_hash := md5(jsonb_build_object('id', v_pid, 'body', b)::text);
  v_early := _bot_idem_check(k, 'people.update', v_idem, v_hash);
  if v_early is not null then return v_early; end if;

  begin
    fl := _bot_person_fields(b);
    v_add := _bot_text(b, 'add_note', 2000);
    v_notes := _bot_text(b, 'notes', 4000);
    if v_notes is not null then fl := fl || jsonb_build_object('notes', v_notes); end if;
    if b ? 'shared_email' then
      if jsonb_typeof(b -> 'shared_email') <> 'boolean' then
        raise exception 'shared_email must be true or false.' using errcode = 'BK422';
      end if;
      fl := fl || jsonb_build_object('shared_email', (b ->> 'shared_email')::boolean);
    end if;
    -- JSON null clears an optional field. name, blocked_reason and email_confidence cannot be cleared.
    fl := fl || _bot_null_cols(b,
      jsonb_build_object('email', 'contact_email', 'phone', 'contact_phone', 'phone2', 'contact_phone2', 'type', 'contact_type',
                         'street', 'address_street', 'unit', 'address_unit', 'city', 'address_city', 'state', 'address_state', 'zip', 'address_zip'),
      array['first_name', 'last_name', 'email', 'phone', 'phone_type', 'phone2', 'phone2_type', 'position', 'role', 'type', 'team_office',
            'street', 'unit', 'city', 'state', 'zip', 'company_id', 'property_id', 'notes']);
    if fl ? 'property_id' and fl -> 'property_id' = 'null'::jsonb then
      fl := fl || jsonb_build_object('property', null);
    end if;
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'people.update', 422, 'invalid_field', v_msg);
  end;

  if not exists (select 1 from contacts c where c.id = v_pid and not c.is_test
                 and not exists (select 1 from companies s where s.id = c.company_id and s.company_type = 'Subcontractor')) then
    return _bot_reject(k, 'people.update', 404, 'unknown_person', 'No person with that id.');
  end if;

  -- An email that belongs to someone else would make two people one address.
  if fl ? 'contact_email' then
    select c.id into v_other from contacts c
    where lower(btrim(c.contact_email)) = fl ->> 'contact_email' and c.id <> v_pid and not c.is_test limit 1;
    if v_other is not null then
      return _bot_reject(k, 'people.update', 409, 'email_in_use', 'Another person already has that email address.', jsonb_build_object('person_id', v_other));
    end if;
  end if;

  -- Email confidence is a working field: a bot may move a guess to verified, and may correct itself,
  -- but cannot downgrade an address staff marked verified.
  if fl ? 'email_confidence' then
    select c.email_confidence into v_cur_conf from contacts c where c.id = v_pid;
    if v_cur_conf = 'verified' and (fl ->> 'email_confidence') <> 'verified' then
      fl := fl - 'email_confidence';
      v_conf_skip := jsonb_build_object('field', 'email_confidence', 'current', v_cur_conf, 'sent', b ->> 'email_confidence');
    end if;
  end if;

  rep := _bot_fill('contacts', v_pid, fl, array['email_confidence'], names);
  if v_conf_skip is not null then
    rep := jsonb_set(rep, '{skipped}', coalesce(rep -> 'skipped', '[]'::jsonb) || jsonb_build_array(v_conf_skip));
  end if;
  if v_add is not null then
    update contacts set notes = _bot_append_note(notes, k.name, v_add) where id = v_pid;
    rep := jsonb_set(rep, '{updated,add_note}', jsonb_build_object('before', null, 'after', v_add), true);
  end if;

  v_status := case when rep -> 'updated' = '{}'::jsonb then 'unchanged' else 'updated' end;
  v_resp := jsonb_build_object('ok', true, 'status', v_status, 'id', v_pid, 'updated', rep -> 'updated', 'skipped', rep -> 'skipped');
  perform _bot_idem_save(k, 'people.update', v_idem, v_hash, v_resp);
  perform _bot_log(k, 'people.update', 'ok', jsonb_build_object('person_id', v_pid, 'status', v_status, 'changes', rep -> 'updated'));
  return v_resp;
end;
$$;

create or replace function bot_sales_company_update(p_key text, p_id text, p_body jsonb, p_idem text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  b jsonb := p_body;
  allowed text[] := array['name', 'type', 'street', 'unit', 'city', 'state', 'zip', 'contact_name', 'contact_email', 'contact_phone', 'notes', 'add_note'];
  names jsonb := jsonb_build_object('company_name', 'name', 'company_type', 'type');
  unknown text[];
  v_idem text := nullif(btrim(p_idem), '');
  v_hash text;
  v_early jsonb;
  v_msg text;
  v_cid uuid;
  fl jsonb;
  v_add text;
  rep jsonb;
  v_status text;
  v_resp jsonb;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  begin
    v_cid := nullif(btrim(p_id), '')::uuid;
  exception when others then
    return _bot_reject(k, 'companies.update', 422, 'invalid_id', 'The id in the address must be a company id from the companies list.');
  end;
  if v_cid is null then
    return _bot_reject(k, 'companies.update', 422, 'invalid_id', 'The id in the address must be a company id from the companies list.');
  end if;
  if b is null or jsonb_typeof(b) <> 'object' or b = '{}'::jsonb then
    return _bot_reject(k, 'companies.update', 422, 'invalid_body', 'Send a JSON object with the fields to fill in.');
  end if;
  unknown := _bot_unknown_keys(b, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'companies.update', 422, 'unknown_field', format('Unknown field: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  v_hash := md5(jsonb_build_object('id', v_cid, 'body', b)::text);
  v_early := _bot_idem_check(k, 'companies.update', v_idem, v_hash);
  if v_early is not null then return v_early; end if;

  begin
    fl := _bot_company_fields(b);
    -- JSON null clears an optional field. The name cannot be cleared.
    fl := fl || _bot_null_cols(b, jsonb_build_object('type', 'company_type'),
      array['type', 'street', 'unit', 'city', 'state', 'zip', 'contact_name', 'contact_email', 'contact_phone', 'notes']);
    v_add := _bot_text(b, 'add_note', 2000);
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'companies.update', 422, 'invalid_field', v_msg);
  end;

  if not exists (select 1 from companies co where co.id = v_cid and not co.is_test and coalesce(co.company_type, '') <> 'Subcontractor') then
    return _bot_reject(k, 'companies.update', 404, 'unknown_company', 'No company with that id.');
  end if;

  rep := _bot_fill('companies', v_cid, fl, '{}'::text[], names);
  if v_add is not null then
    update companies set notes = _bot_append_note(notes, k.name, v_add) where id = v_cid;
    rep := jsonb_set(rep, '{updated,add_note}', jsonb_build_object('before', null, 'after', v_add), true);
  end if;

  v_status := case when rep -> 'updated' = '{}'::jsonb then 'unchanged' else 'updated' end;
  v_resp := jsonb_build_object('ok', true, 'status', v_status, 'id', v_cid, 'updated', rep -> 'updated', 'skipped', rep -> 'skipped');
  perform _bot_idem_save(k, 'companies.update', v_idem, v_hash, v_resp);
  perform _bot_log(k, 'companies.update', 'ok', jsonb_build_object('company_id', v_cid, 'status', v_status, 'changes', rep -> 'updated'));
  return v_resp;
end;
$$;

create or replace function bot_sales_prospect_update(p_key text, p_id text, p_body jsonb, p_idem text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  b jsonb := p_body;
  allowed text[] := array['type', 'vertical', 'tier', 'street', 'unit', 'city', 'state', 'zip', 'management_company', 'year_built', 'sq_ft',
                          'contact_name', 'contact_email', 'contact_phone', 'company_id',
                          'stage', 'next_action_at', 'next_action_note', 'lost_reason', 'reengage_at', 'do_not_contact', 'won_at', 'won_note',
                          'name', 'source', 'target_value', 'active', 'last_visited_at', 'notes', 'add_note'];
  names jsonb := jsonb_build_object('property_type', 'type', 'prospect_vertical', 'vertical', 'prospect_tier', 'tier',
                                    'property_street', 'street', 'property_unit', 'unit', 'property_city', 'city',
                                    'property_state', 'state', 'property_zip', 'zip', 'prospect_stage', 'stage',
                                    'property_name', 'name', 'prospect_source', 'source');
  overwrite text[] := array['prospect_stage'];  -- ignored since migration 168, every writable column overwrites
  unknown text[];
  v_idem text := nullif(btrim(p_idem), '');
  v_hash text;
  v_early jsonb;
  v_msg text;
  v_pid uuid;
  fl jsonb := '{}'::jsonb;
  v text;
  v_add text;
  v_stage text;
  v_cur_stage text;
  v_flag boolean;
  v_ts timestamptz;
  v_date date;
  v_co uuid;
  v_won_note text;
  v_won_at date;
  v_cur_won_note text;
  rep jsonb;
  v_status text;
  v_resp jsonb;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  begin
    v_pid := nullif(btrim(p_id), '')::uuid;
  exception when others then
    return _bot_reject(k, 'prospects.update', 422, 'invalid_id', 'The id in the address must be a prospect id from the prospects list.');
  end;
  if v_pid is null then
    return _bot_reject(k, 'prospects.update', 422, 'invalid_id', 'The id in the address must be a prospect id from the prospects list.');
  end if;
  if b is null or jsonb_typeof(b) <> 'object' or b = '{}'::jsonb then
    return _bot_reject(k, 'prospects.update', 422, 'invalid_body', 'Send a JSON object with the fields to change.');
  end if;
  unknown := _bot_unknown_keys(b, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'prospects.update', 422, 'unknown_field', format('Unknown field: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  v_hash := md5(jsonb_build_object('id', v_pid, 'body', b)::text);
  v_early := _bot_idem_check(k, 'prospects.update', v_idem, v_hash);
  if v_early is not null then return v_early; end if;

  select p.prospect_stage, p.won_note into v_cur_stage, v_cur_won_note from properties p where p.id = v_pid and not p.is_test;
  if not found then
    return _bot_reject(k, 'prospects.update', 404, 'unknown_prospect', 'No prospect with that id.');
  end if;

  begin
    v := _bot_text(b, 'type', 60);               v := coalesce(_sector_canon(v), v);
    if v is not null then fl := fl || jsonb_build_object('property_type', v); end if;
    v := _bot_text(b, 'vertical', 60);           v := coalesce(_sector_canon(v), lower(v));
    if v is not null then fl := fl || jsonb_build_object('prospect_vertical', v); end if;
    v := upper(_bot_text(b, 'tier', 5));
    if v is not null then
      if not ((_bot_enums() -> 'tiers') ? v) then
        raise exception 'Unknown tier "%". Allowed: A, B, C.', v using errcode = 'BK422';
      end if;
      fl := fl || jsonb_build_object('prospect_tier', v);
    end if;
    v := _bot_text(b, 'street', 200);            if v is not null then fl := fl || jsonb_build_object('property_street', v); end if;
    v := _bot_text(b, 'unit', 60);               if v is not null then fl := fl || jsonb_build_object('property_unit', v); end if;
    v := _bot_text(b, 'city', 100);              if v is not null then fl := fl || jsonb_build_object('property_city', v); end if;
    v := _bot_text(b, 'state', 60);              if v is not null then fl := fl || jsonb_build_object('property_state', v); end if;
    v := _bot_text(b, 'zip', 20);                if v is not null then fl := fl || jsonb_build_object('property_zip', v); end if;
    v := _bot_text(b, 'management_company', 200); if v is not null then fl := fl || jsonb_build_object('management_company', v); end if;
    v := _bot_text(b, 'year_built', 10);
    if v is not null then
      if v !~ '^[0-9]{4}$' then raise exception 'year_built must be a four digit year.' using errcode = 'BK422'; end if;
      fl := fl || jsonb_build_object('year_built', v);
    end if;
    v := _bot_text(b, 'sq_ft', 20);
    if v is not null then
      if v !~ '^[0-9][0-9,]*$' then raise exception 'sq_ft must be a number.' using errcode = 'BK422'; end if;
      fl := fl || jsonb_build_object('sq_ft', replace(v, ',', ''));
    end if;
    v := _bot_text(b, 'contact_name', 200);      if v is not null then fl := fl || jsonb_build_object('contact_name', v); end if;
    v := _bot_email(b, 'contact_email');         if v is not null then fl := fl || jsonb_build_object('contact_email', v); end if;
    v := _bot_phone(b, 'contact_phone');         if v is not null then fl := fl || jsonb_build_object('contact_phone', v); end if;
    v := _bot_text(b, 'notes', 4000);            if v is not null then fl := fl || jsonb_build_object('notes', v); end if;
    v_add := _bot_text(b, 'add_note', 2000);

    v := _bot_text(b, 'name', 200);              if v is not null then fl := fl || jsonb_build_object('property_name', v); end if;
    v := _bot_text(b, 'source', 100);            if v is not null then fl := fl || jsonb_build_object('prospect_source', v); end if;
    v := _bot_text(b, 'target_value', 20);
    if v is not null then
      v := replace(v, ',', '');
      if v !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception 'target_value must be a dollar amount, like 25000.' using errcode = 'BK422'; end if;
      fl := fl || jsonb_build_object('target_value', v::numeric);
    end if;
    if b ? 'active' then
      if jsonb_typeof(b -> 'active') <> 'boolean' then raise exception 'active must be true or false.' using errcode = 'BK422'; end if;
      fl := fl || jsonb_build_object('active', (b ->> 'active')::boolean);
    end if;
    if b ? 'last_visited_at' and jsonb_typeof(b -> 'last_visited_at') <> 'null' then
      v := _bot_text(b, 'last_visited_at', 40);
      begin
        v_ts := v::timestamptz;
      exception when others then
        raise exception 'last_visited_at must be an ISO 8601 time, like 2026-11-02T15:00:00Z, or null to clear it.' using errcode = 'BK422';
      end;
      fl := fl || jsonb_build_object('last_visited_at', v_ts);
    end if;
    -- JSON null clears an optional field. name, stage and do_not_contact cannot be cleared this way.
    fl := fl || _bot_null_cols(b,
      jsonb_build_object('type', 'property_type', 'vertical', 'prospect_vertical', 'tier', 'prospect_tier', 'street', 'property_street',
                         'unit', 'property_unit', 'city', 'property_city', 'state', 'property_state', 'zip', 'property_zip', 'source', 'prospect_source'),
      array['type', 'vertical', 'tier', 'street', 'unit', 'city', 'state', 'zip', 'management_company', 'year_built', 'sq_ft',
            'contact_name', 'contact_email', 'contact_phone', 'company_id', 'notes', 'source', 'target_value', 'last_visited_at']);

    v_co := _bot_uuid(b, 'company_id');
    if v_co is not null then
      if not exists (select 1 from companies c where c.id = v_co and coalesce(c.company_type, '') <> 'Subcontractor') then
        raise exception 'No company with that company_id.' using errcode = 'BK422';
      end if;
      fl := fl || jsonb_build_object('company_id', v_co);
    end if;

    -- Working fields.
    v_stage := lower(_bot_text(b, 'stage', 30));
    if v_stage is not null then
      if not ((_bot_enums() -> 'settable_prospect_stages') ? v_stage) then
        raise exception 'Unknown stage "%". Allowed: prospecting, contacted, proposal, won, lost.', v_stage using errcode = 'BK422';
      end if;
      if v_cur_stage = 'won' and v_stage <> 'won' then
        raise exception 'This prospect is won. Only staff can move it out of won.' using errcode = 'BK422';
      end if;
      fl := fl || jsonb_build_object('prospect_stage', v_stage);
    end if;

    -- Won needs a short note saying what was agreed, so the win can be checked later.
    v_won_note := _bot_text(b, 'won_note', 300);
    if b ? 'won_at' then
      v := _bot_text(b, 'won_at', 20);
      begin
        v_won_at := v::date;
      exception when others then
        raise exception 'won_at must be a date, like 2026-10-23.' using errcode = 'BK422';
      end;
      if v_won_at > current_date + 1 or v_won_at < current_date - 400 then
        raise exception 'won_at must be a recent date, not in the future.' using errcode = 'BK422';
      end if;
    end if;
    if (v_won_note is not null or v_won_at is not null) and coalesce(v_stage, v_cur_stage) <> 'won' then
      raise exception 'won_note and won_at only apply when the stage is won. Send stage "won" with them.' using errcode = 'BK422';
    end if;
    if v_stage = 'won' and v_cur_stage <> 'won' and v_won_note is null then
      raise exception 'Setting a prospect to won needs a won_note: say what was agreed, for example "signed the lobby remodel proposal".' using errcode = 'BK422';
    end if;
    if v_won_note is not null then fl := fl || jsonb_build_object('won_note', v_won_note); end if;
    if v_won_at is not null then fl := fl || jsonb_build_object('won_at', v_won_at); end if;

    if b ? 'next_action_at' then
      if jsonb_typeof(b -> 'next_action_at') = 'null' then
        fl := fl || jsonb_build_object('next_action_at', null);
      else
        v := _bot_text(b, 'next_action_at', 40);
        begin
          v_ts := v::timestamptz;
        exception when others then
          raise exception 'next_action_at must be an ISO 8601 time, like 2026-11-02T15:00:00Z, or null to clear it.' using errcode = 'BK422';
        end;
        fl := fl || jsonb_build_object('next_action_at', v_ts);
      end if;
    end if;
    if b ? 'next_action_note' then
      if jsonb_typeof(b -> 'next_action_note') = 'null' then
        fl := fl || jsonb_build_object('next_action_note', null);
      else
        fl := fl || jsonb_build_object('next_action_note', _bot_text(b, 'next_action_note', 300));
      end if;
    end if;
    if b ? 'lost_reason' then
      if jsonb_typeof(b -> 'lost_reason') = 'null' then
        fl := fl || jsonb_build_object('lost_reason', null);
      else
        fl := fl || jsonb_build_object('lost_reason', _bot_text(b, 'lost_reason', 300));
      end if;
    end if;
    if b ? 'reengage_at' then
      if jsonb_typeof(b -> 'reengage_at') = 'null' then
        fl := fl || jsonb_build_object('reengage_at', null);
      else
        v := _bot_text(b, 'reengage_at', 20);
        begin
          v_date := v::date;
        exception when others then
          raise exception 'reengage_at must be a date, like 2027-03-01, or null to clear it.' using errcode = 'BK422';
        end;
        fl := fl || jsonb_build_object('reengage_at', v_date);
      end if;
    end if;
    if (fl ? 'lost_reason' or fl ? 'reengage_at') and coalesce(v_stage, v_cur_stage) <> 'lost' then
      raise exception 'lost_reason and reengage_at only apply when the stage is lost. Send stage "lost" with them.' using errcode = 'BK422';
    end if;

    if b ? 'do_not_contact' then
      v_flag := case jsonb_typeof(b -> 'do_not_contact') when 'boolean' then (b ->> 'do_not_contact')::boolean else null end;
      if v_flag is null then
        raise exception 'do_not_contact must be true or false.' using errcode = 'BK422';
      end if;
      if not v_flag then
        raise exception 'A bot can set do_not_contact to true but cannot clear it. Ask staff.' using errcode = 'BK422';
      end if;
      fl := fl || jsonb_build_object('do_not_contact', true);
    end if;
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'prospects.update', 422, 'invalid_field', v_msg);
  end;

  rep := _bot_fill('properties', v_pid, fl, overwrite, names);
  if v_add is not null then
    update properties set notes = _bot_append_note(notes, k.name, v_add) where id = v_pid;
    rep := jsonb_set(rep, '{updated,add_note}', jsonb_build_object('before', null, 'after', v_add), true);
  end if;

  v_status := case when rep -> 'updated' = '{}'::jsonb then 'unchanged' else 'updated' end;
  v_resp := jsonb_build_object('ok', true, 'status', v_status, 'id', v_pid, 'updated', rep -> 'updated', 'skipped', rep -> 'skipped');
  perform _bot_idem_save(k, 'prospects.update', v_idem, v_hash, v_resp);
  perform _bot_log(k, 'prospects.update', 'ok', jsonb_build_object('prospect_id', v_pid, 'status', v_status, 'changes', rep -> 'updated'));
  return v_resp;
end;
$$;
