-- Run in the Supabase SQL Editor after migration 165. Safe to run more than once.
--
-- Gives the sales bot the whole Sales side, not just the prospect list:
--
--   People      read, add, and fill in blanks            /api/bot/sales/people
--   Companies   read, add, and fill in blanks            /api/bot/sales/companies
--   Properties  the prospects list gains update          /api/bot/sales/prospects/{id}
--   Sales page  the follow up lists and scorecard        /api/bot/sales/follow-up
--   Touches     can now be logged against a person, and history can be read
--               for a person or a company
--
-- What a bot still cannot do, because the database refuses it:
--   * delete anything (deleting stays owner only, in the app)
--   * overwrite something staff already filled in. Updates only fill blanks.
--     The exceptions are the working fields on a prospect: stage, next step,
--     lost reason and try again date, which a bot has to move as it works.
--   * set a prospect to won (that is a staff decision), or clear Do not contact
--   * see subcontractors (they live in Companies, but are not sales records),
--     billing details, tax ids, or custom columns
--   * touch jobs, money, staff, or settings
--
-- Nothing here changes what staff see or can do.

-- ─── 1. Trace what a bot created ────────────────────────────────────────
alter table companies add column if not exists created_by_bot_id uuid references bot_keys(id) on delete set null;
create index if not exists companies_bot_idx on companies (created_by_bot_id) where created_by_bot_id is not null;

-- ─── 2. Allowed values ──────────────────────────────────────────────────
-- Same as migration 163, plus the people and company lists and the stages a bot may set.
-- contact_types and company_types mirror CONTACT_TYPES in lib/constants.js and
-- COMPANY_TYPES in app/companies/page.js. If staff add a type there, add it here too.
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
    'settable_prospect_stages', jsonb_build_array('prospecting', 'contacted', 'proposal', 'lost'),
    'tiers', jsonb_build_array('A', 'B', 'C'),
    'known_verticals', jsonb_build_array('multi_family', 'hotel_lodging', 'office', 'retail', 'recreational', 'church', 'residential'),
    'contact_types', jsonb_build_array('Multi-Family', 'Commercial', 'Hospitality', 'Senior Living', 'Education', 'Religious - Churches', 'Government', 'Residential - Homeowner', 'Residential - Investor', 'Real Estate Agent'),
    'company_types', jsonb_build_array('Management Company', 'Ownership Group', 'REIT', 'Developer', 'Other')
  );
$$;

-- ─── 3. Internal helpers (not callable from the API) ────────────────────

-- Case insensitive pick from an allowed list. Raises BK422 with the list when it is not there.
create or replace function _bot_canon(p_allowed jsonb, p_value text, p_label text)
returns text
language plpgsql
immutable
as $$
declare
  x text;
begin
  if p_value is null then return null; end if;
  for x in select jsonb_array_elements_text(p_allowed) loop
    if lower(x) = lower(btrim(p_value)) then return x; end if;
  end loop;
  raise exception 'Unknown % "%". Allowed: %.', p_label, p_value, (select string_agg(a, ', ') from jsonb_array_elements_text(p_allowed) a) using errcode = 'BK422';
end;
$$;

-- A UUID field. Null when absent, BK422 when it is not a UUID.
create or replace function _bot_uuid(b jsonb, k text)
returns uuid
language plpgsql
immutable
as $$
declare
  v text := _bot_text(b, k, 64);
  r uuid;
begin
  if v is null then return null; end if;
  begin
    r := v::uuid;
  exception when others then
    r := null;
  end;
  if r is null then
    raise exception '% must be a UUID.', k using errcode = 'BK422';
  end if;
  return r;
end;
$$;

-- Reads a next_cursor value. bad is true when it does not decode.
create or replace function _bot_cursor(p_cursor text, out ts timestamptz, out id uuid, out bad boolean)
language plpgsql
immutable
as $$
declare
  d text;
begin
  bad := false;
  if p_cursor is null then return; end if;
  begin
    d := convert_from(decode(p_cursor, 'hex'), 'utf8');
    ts := split_part(d, '|', 1)::timestamptz;
    id := split_part(d, '|', 2)::uuid;
  exception when others then
    bad := true; ts := null; id := null;
  end;
end;
$$;

-- Idempotency, shared by the new write functions. Returns null to go ahead (the
-- request is locked so a retry waits for it), or an answer to hand straight back:
-- a bad key, a key reused for a different request, or the saved answer of the first try.
create or replace function _bot_idem_check(p_bot bot_keys, p_action text, p_idem text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior record;
begin
  if p_idem is null then return null; end if;
  if p_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    return _bot_reject(p_bot, p_action, 422, 'invalid_idempotency_key', 'Idempotency-Key must be 8 to 128 characters: letters, numbers, and _ . : -');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bot_idem:' || p_bot.id::text || ':' || p_idem, 0));
  select * into v_prior from bot_idempotency i where i.bot_key_id = p_bot.id and i.idem_key = p_idem;
  if found then
    if v_prior.action <> p_action or v_prior.request_hash <> p_hash then
      return _bot_reject(p_bot, p_action, 422, 'idempotency_conflict', 'That Idempotency-Key was already used for a different request.');
    end if;
    perform _bot_log(p_bot, p_action, 'ok', jsonb_build_object('replay', true));
    return v_prior.response || jsonb_build_object('idempotent_replay', true);
  end if;
  return null;
end;
$$;

create or replace function _bot_idem_save(p_bot bot_keys, p_action text, p_idem text, p_hash text, p_resp jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_idem is null then return; end if;
  insert into bot_idempotency (bot_key_id, idem_key, action, request_hash, response)
  values (p_bot.id, p_idem, p_action, p_hash, p_resp)
  on conflict (bot_key_id, idem_key) do nothing;
end;
$$;

-- Fill in blanks on one row, and report exactly what changed.
--   p_fields     column name -> new value (already validated by the caller)
--   p_overwrite  columns a bot may replace even when they hold a value
--                (a JSON null for one of these clears it)
--   p_names      column name -> the name the API uses, for the report
-- Any other column is only written when it is blank. A value that differs from
-- what staff entered is left alone and listed under "skipped".
-- Returns null when the row does not exist.
-- No dynamic SQL: each table has its own fixed list of columns a bot may write, so a
-- column outside that list cannot be named even by a bug in a caller.
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
                      'company_id', 'property_id', 'property', 'management_company', 'notes'];
    select to_jsonb(t) into cur from contacts t where t.id = p_id for update;
  elsif p_table = 'companies' then
    writable := array['company_name', 'company_type', 'street', 'unit', 'city', 'state', 'zip', 'contact_name', 'contact_email', 'contact_phone', 'notes'];
    select to_jsonb(t) into cur from companies t where t.id = p_id for update;
  elsif p_table = 'properties' then
    writable := array['property_type', 'prospect_vertical', 'prospect_tier', 'property_street', 'property_unit', 'property_city', 'property_state', 'property_zip',
                      'management_company', 'year_built', 'sq_ft', 'contact_name', 'contact_email', 'contact_phone', 'company_id', 'notes',
                      'prospect_stage', 'next_action_at', 'next_action_note', 'lost_reason', 'reengage_at', 'do_not_contact'];
    select to_jsonb(t) into cur from properties t where t.id = p_id for update;
  else
    raise exception 'Table not allowed.';
  end if;
  if cur is null then return null; end if;

  for k, nv in select * from jsonb_each(p_fields) loop
    if k <> all(writable) then
      raise exception 'Column % is not writable.', k;
    end if;
    cv := cur -> k;
    nm := coalesce(p_names ->> k, k);
    if k = any(coalesce(p_overwrite, '{}'::text[])) then
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
        do_not_contact = case when changes ? 'do_not_contact' then r.do_not_contact else t.do_not_contact end
      from jsonb_populate_record(null::properties, changes) r
      where t.id = p_id;
    end if;
  end if;
  return jsonb_build_object('updated', updated, 'skipped', skipped);
end;
$$;

-- Reads and checks the person fields in a request body. Returns column name -> value
-- for the fields that were sent. Raises BK422 on the first bad value.
create or replace function _bot_person_fields(b jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  v text;
  vid uuid;
  prop record;
begin
  v := _bot_text(b, 'name', 200);          if v is not null then r := r || jsonb_build_object('name', v); end if;
  v := _bot_text(b, 'first_name', 100);    if v is not null then r := r || jsonb_build_object('first_name', v); end if;
  v := _bot_text(b, 'last_name', 100);     if v is not null then r := r || jsonb_build_object('last_name', v); end if;
  v := _bot_email(b, 'email');             if v is not null then r := r || jsonb_build_object('contact_email', v); end if;
  v := _bot_phone(b, 'phone');             if v is not null then r := r || jsonb_build_object('contact_phone', v); end if;
  v := _bot_text(b, 'position', 120);      if v is not null then r := r || jsonb_build_object('position', v); end if;
  v := _bot_text(b, 'role', 120);          if v is not null then r := r || jsonb_build_object('role', v); end if;
  v := _bot_canon(_bot_enums() -> 'contact_types', _bot_text(b, 'type', 60), 'type');
  if v is not null then r := r || jsonb_build_object('contact_type', v); end if;
  v := _bot_text(b, 'team_office', 120);   if v is not null then r := r || jsonb_build_object('team_office', v); end if;
  v := _bot_text(b, 'street', 200);        if v is not null then r := r || jsonb_build_object('address_street', v); end if;
  v := _bot_text(b, 'unit', 60);           if v is not null then r := r || jsonb_build_object('address_unit', v); end if;
  v := _bot_text(b, 'city', 100);          if v is not null then r := r || jsonb_build_object('address_city', v); end if;
  v := _bot_text(b, 'state', 60);          if v is not null then r := r || jsonb_build_object('address_state', v); end if;
  v := _bot_text(b, 'zip', 20);            if v is not null then r := r || jsonb_build_object('address_zip', v); end if;

  vid := _bot_uuid(b, 'company_id');
  if vid is not null then
    if not exists (select 1 from companies c where c.id = vid and coalesce(c.company_type, '') <> 'Subcontractor') then
      raise exception 'No company with that company_id.' using errcode = 'BK422';
    end if;
    r := r || jsonb_build_object('company_id', vid);
  end if;

  vid := _bot_uuid(b, 'property_id');
  if vid is not null then
    select p.property_name, p.management_company into prop from properties p where p.id = vid;
    if not found then
      raise exception 'No property with that property_id.' using errcode = 'BK422';
    end if;
    r := r || jsonb_build_object('property_id', vid, 'property', prop.property_name);
    if prop.management_company is not null then r := r || jsonb_build_object('management_company', prop.management_company); end if;
  end if;
  return r;
end;
$$;

-- Same for a company.
create or replace function _bot_company_fields(b jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  v text;
begin
  v := _bot_text(b, 'name', 200);          if v is not null then r := r || jsonb_build_object('company_name', v); end if;
  v := _bot_canon(_bot_enums() -> 'company_types', _bot_text(b, 'type', 60), 'type');
  if v is not null then r := r || jsonb_build_object('company_type', v); end if;
  v := _bot_text(b, 'street', 200);        if v is not null then r := r || jsonb_build_object('street', v); end if;
  v := _bot_text(b, 'unit', 60);           if v is not null then r := r || jsonb_build_object('unit', v); end if;
  v := _bot_text(b, 'city', 100);          if v is not null then r := r || jsonb_build_object('city', v); end if;
  v := _bot_text(b, 'state', 60);          if v is not null then r := r || jsonb_build_object('state', v); end if;
  v := _bot_text(b, 'zip', 20);            if v is not null then r := r || jsonb_build_object('zip', v); end if;
  v := _bot_text(b, 'contact_name', 200);  if v is not null then r := r || jsonb_build_object('contact_name', v); end if;
  v := _bot_email(b, 'contact_email');     if v is not null then r := r || jsonb_build_object('contact_email', v); end if;
  v := _bot_phone(b, 'contact_phone');     if v is not null then r := r || jsonb_build_object('contact_phone', v); end if;
  v := _bot_text(b, 'notes', 4000);        if v is not null then r := r || jsonb_build_object('notes', v); end if;
  return r;
end;
$$;

-- A note a bot adds is appended under a dated line with its name, never swapped in.
create or replace function _bot_append_note(p_existing text, p_bot text, p_note text)
returns text
language sql
immutable
as $$
  select case when nullif(btrim(coalesce(p_existing, '')), '') is null then '' else btrim(p_existing) || E'\n\n' end
         || format('[%s, %s] %s', p_bot, to_char(now() at time zone 'utc', 'YYYY-MM-DD'), p_note);
$$;


-- ─── 4. People ──────────────────────────────────────────────────────────
-- A person is a row in Contacts. People who belong to a subcontractor company are not
-- sales records and are never returned.

-- GET /api/bot/sales/people
create or replace function bot_sales_people_list(p_key text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  allowed text[] := array['id', 'q', 'email', 'type', 'company_id', 'property_id', 'can_email', 'contacted', 'created_since', 'limit', 'cursor'];
  unknown text[];
  v_limit integer := 50;
  v_id uuid;
  v_company uuid;
  v_property uuid;
  v_q text;
  v_email text;
  v_type text;
  v_can boolean;
  v_contacted boolean;
  v_created timestamptz;
  v_cursor text;
  cur record;
  v_items jsonb;
  v_more boolean;
  v_next text;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if jsonb_typeof(f) <> 'object' then
    return _bot_reject(k, 'people.list', 422, 'invalid_filters', 'Filters must be a JSON object.');
  end if;
  unknown := _bot_unknown_keys(f, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'people.list', 422, 'unknown_filter', format('Unknown filter: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  begin
    if f ? 'limit' then
      v_limit := (f ->> 'limit')::integer;
      if v_limit < 1 or v_limit > 200 then
        return _bot_reject(k, 'people.list', 422, 'invalid_filter', 'limit must be between 1 and 200.');
      end if;
    end if;
  exception when invalid_text_representation then
    return _bot_reject(k, 'people.list', 422, 'invalid_filter', 'limit must be a whole number between 1 and 200.');
  end;

  begin
    v_id := nullif(btrim(f ->> 'id'), '')::uuid;
    v_company := nullif(btrim(f ->> 'company_id'), '')::uuid;
    v_property := nullif(btrim(f ->> 'property_id'), '')::uuid;
  exception when others then
    return _bot_reject(k, 'people.list', 422, 'invalid_filter', 'id, company_id and property_id must be UUIDs.');
  end;

  v_type := nullif(btrim(f ->> 'type'), '');
  if v_type is not null then
    begin
      v_type := _bot_canon(_bot_enums() -> 'contact_types', v_type, 'type');
    exception when sqlstate 'BK422' then
      return _bot_reject(k, 'people.list', 422, 'invalid_filter', format('Unknown type "%s".', v_type), jsonb_build_object('allowed', _bot_enums() -> 'contact_types'));
    end;
  end if;
  v_q := nullif(lower(btrim(f ->> 'q')), '');
  v_email := nullif(lower(btrim(f ->> 'email')), '');
  if length(coalesce(v_q, '')) > 100 or length(coalesce(v_email, '')) > 254 then
    return _bot_reject(k, 'people.list', 422, 'invalid_filter', 'q or email is too long.');
  end if;
  if f ? 'can_email' then
    v_can := _bot_bool(f ->> 'can_email');
    if v_can is null then return _bot_reject(k, 'people.list', 422, 'invalid_filter', 'can_email must be true or false.'); end if;
  end if;
  if f ? 'contacted' then
    v_contacted := _bot_bool(f ->> 'contacted');
    if v_contacted is null then return _bot_reject(k, 'people.list', 422, 'invalid_filter', 'contacted must be true or false.'); end if;
  end if;
  begin
    v_created := (f ->> 'created_since')::timestamptz;
  exception when others then
    return _bot_reject(k, 'people.list', 422, 'invalid_filter', 'created_since must be an ISO 8601 date, like 2026-10-01 or 2026-10-01T12:00:00Z.');
  end;

  v_cursor := nullif(btrim(f ->> 'cursor'), '');
  select * into cur from _bot_cursor(v_cursor);
  if cur.bad then
    return _bot_reject(k, 'people.list', 422, 'invalid_filter', 'cursor is not valid. Use the next_cursor value from the previous page.');
  end if;

  with base as (
    select c.*,
      case
        when c.contact_email is null or btrim(c.contact_email) = '' then 'no_email'
        else _outreach_blocked_reason(c.contact_email, c.property_id)
      end as blocked
    from contacts c
    where not exists (select 1 from companies s where s.id = c.company_id and s.company_type = 'Subcontractor')
      and (v_id is null or c.id = v_id)
      and (v_company is null or c.company_id = v_company)
      and (v_property is null or c.property_id = v_property)
      and (v_type is null or c.contact_type = v_type)
      and (v_created is null or c.created_at >= v_created)
      and (v_q is null or position(v_q in lower(concat_ws(' ', c.name, c.contact_email, c.position, c.property, c.management_company))) > 0)
      and (v_email is null or lower(btrim(c.contact_email)) = v_email)
      and (v_contacted is null or exists (select 1 from outreach_touches t where t.contact_id = c.id and _touch_counts(t.outcome)) = v_contacted)
      and (cur.ts is null or (c.created_at, c.id) > (cur.ts, cur.id))
  ), page as (
    select b.*, row_number() over (order by b.created_at, b.id) as rn
    from base b
    where (v_can is null or (b.blocked is null) = v_can)
    order by b.created_at, b.id
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', pg.id,
      'name', pg.name,
      'first_name', pg.first_name,
      'last_name', pg.last_name,
      'email', pg.contact_email,
      'phone', pg.contact_phone,
      'position', pg.position,
      'role', pg.role,
      'type', pg.contact_type,
      'team_office', pg.team_office,
      'street', pg.address_street,
      'unit', pg.address_unit,
      'city', pg.address_city,
      'state', pg.address_state,
      'zip', pg.address_zip,
      'notes', pg.notes,
      'company', (select jsonb_build_object('id', co.id, 'name', co.company_name) from companies co where co.id = pg.company_id),
      'property', (select jsonb_build_object('id', p.id, 'name', p.property_name) from properties p where p.id = pg.property_id),
      'can_email', (pg.blocked is null),
      'blocked_reason', pg.blocked,
      'touches', (
        select jsonb_build_object('count', count(*), 'last_at', max(t.sent_at), 'last_outcome', (array_agg(t.outcome order by t.sent_at desc))[1])
        from outreach_touches t where t.contact_id = pg.id
      ),
      'created_at', pg.created_at
    ) order by pg.rn) filter (where pg.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit,
    (array_agg(encode(convert_to(pg.created_at::text || '|' || pg.id::text, 'utf8'), 'hex') order by pg.rn) filter (where pg.rn = v_limit))[1]
  into v_items, v_more, v_next
  from page pg;

  perform _bot_log(k, 'people.list', 'ok', jsonb_build_object('returned', jsonb_array_length(v_items)));
  return jsonb_build_object('ok', true, 'items', v_items, 'count', jsonb_array_length(v_items), 'next_cursor', case when v_more then v_next else null end);
end;
$$;

-- POST /api/bot/sales/people
-- Adds a person, or returns the one we already have. Nothing is overwritten.
create or replace function bot_sales_person_create(p_key text, p_body jsonb, p_idem text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  b jsonb := p_body;
  allowed text[] := array['name', 'first_name', 'last_name', 'email', 'phone', 'position', 'role', 'type', 'team_office',
                          'street', 'unit', 'city', 'state', 'zip', 'company_id', 'property_id', 'notes'];
  unknown text[];
  v_idem text := nullif(btrim(p_idem), '');
  v_hash text;
  v_early jsonb;
  v_msg text;
  fl jsonb;
  v_notes text;
  v_name text;
  v_first text;
  v_last text;
  v_email text;
  v_phone text;
  v_company uuid;
  v_property uuid;
  v_role text;
  v_id uuid;
  v_status text := 'created';
  v_matched text;
  v_similar jsonb;
  v_blocked text;
  v_resp jsonb;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if b is null or jsonb_typeof(b) <> 'object' then
    return _bot_reject(k, 'people.create', 422, 'invalid_body', 'Send a JSON object. Give a name, or an email.');
  end if;
  unknown := _bot_unknown_keys(b, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'people.create', 422, 'unknown_field', format('Unknown field: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  v_hash := md5(b::text);
  v_early := _bot_idem_check(k, 'people.create', v_idem, v_hash);
  if v_early is not null then return v_early; end if;

  begin
    fl := _bot_person_fields(b);
    v_notes := _bot_text(b, 'notes', 4000);
    v_name := fl ->> 'name';
    v_first := fl ->> 'first_name';
    v_last := fl ->> 'last_name';
    v_email := fl ->> 'contact_email';
    v_phone := fl ->> 'contact_phone';
    v_company := (fl ->> 'company_id')::uuid;
    v_property := (fl ->> 'property_id')::uuid;
    if v_name is null then
      v_name := nullif(btrim(concat_ws(' ', v_first, v_last)), '');
    end if;
    if v_name is null and v_email is null then
      raise exception 'Give a name (or first_name and last_name), or at least an email.' using errcode = 'BK422';
    end if;
    if v_name is not null and v_first is null and v_last is null then
      v_first := split_part(v_name, ' ', 1);
      v_last := nullif(btrim(substr(v_name, length(v_first) + 1)), '');
    end if;
    v_name := coalesce(v_name, v_email);
    if _bot_norm(v_name) = '' then
      raise exception 'name must contain letters or numbers.' using errcode = 'BK422';
    end if;
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'people.create', 422, 'invalid_field', v_msg);
  end;

  -- Two calls for the same person at the same time must not both insert.
  perform pg_advisory_xact_lock(hashtextextended('bot_person:' || coalesce(v_email, _bot_norm(v_name)), 0));

  -- Hard duplicate: the same email, or with no email, the same name at the same company or property.
  if v_email is not null then
    select c.id into v_id from contacts c
    where lower(btrim(c.contact_email)) = v_email
      and not exists (select 1 from companies s where s.id = c.company_id and s.company_type = 'Subcontractor')
    order by c.created_at limit 1;
    if v_id is not null then v_status := 'duplicate'; v_matched := 'email'; end if;
  else
    select c.id into v_id from contacts c
    where _bot_norm(c.name) = _bot_norm(v_name)
      and ((v_company is not null and c.company_id = v_company) or (v_property is not null and c.property_id = v_property))
    order by c.created_at limit 1;
    if v_id is not null then v_status := 'duplicate'; v_matched := 'name_and_link'; end if;
  end if;

  if v_status = 'created' then
    v_role := coalesce(fl ->> 'role', case when v_property is not null then 'Property Contact' else null end);
    insert into contacts (
      name, first_name, last_name, contact_email, contact_phone, position, role, contact_type, team_office,
      address_street, address_unit, address_city, address_state, address_zip,
      company_id, property_id, property, management_company, notes, created_by_bot_id
    ) values (
      v_name, v_first, v_last, v_email, v_phone, fl ->> 'position', v_role, fl ->> 'contact_type', fl ->> 'team_office',
      fl ->> 'address_street', fl ->> 'address_unit', fl ->> 'address_city', fl ->> 'address_state', fl ->> 'address_zip',
      v_company, v_property, fl ->> 'property', fl ->> 'management_company',
      case when v_notes is null then null else _bot_append_note(null, k.name, v_notes) end, k.id
    ) returning id into v_id;
  end if;

  -- Soft matches: the same name elsewhere, or the same phone. Informational only.
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'matched_on', s.matched_on)), '[]'::jsonb)
  into v_similar
  from (
    select c.id, c.name,
      case when length(_bot_digits(v_phone)) >= 10 and right(_bot_digits(c.contact_phone), 10) = right(_bot_digits(v_phone), 10) then 'phone' else 'name' end as matched_on
    from contacts c
    where c.id <> v_id
      and not exists (select 1 from companies s2 where s2.id = c.company_id and s2.company_type = 'Subcontractor')
      and (_bot_norm(c.name) = _bot_norm(v_name)
           or (length(_bot_digits(v_phone)) >= 10 and right(_bot_digits(c.contact_phone), 10) = right(_bot_digits(v_phone), 10)))
    order by c.created_at
    limit 5
  ) s;

  select case when c.contact_email is null or btrim(c.contact_email) = '' then 'no_email' else _outreach_blocked_reason(c.contact_email, c.property_id) end
  into v_blocked from contacts c where c.id = v_id;

  v_resp := jsonb_build_object(
    'ok', true, 'status', v_status, 'id', v_id, 'matched_on', v_matched,
    'can_email', (v_blocked is null), 'blocked_reason', v_blocked, 'similar', v_similar
  );
  perform _bot_idem_save(k, 'people.create', v_idem, v_hash, v_resp);
  perform _bot_log(k, 'people.create', 'ok', jsonb_build_object('person_id', v_id, 'status', v_status));
  return v_resp;
end;
$$;

-- PATCH /api/bot/sales/people/{id}
-- Fills blanks on an existing person. Anything staff already entered is left alone and
-- reported under "skipped". add_note appends a dated note and never replaces notes.
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
  allowed text[] := array['name', 'first_name', 'last_name', 'email', 'phone', 'position', 'role', 'type', 'team_office',
                          'street', 'unit', 'city', 'state', 'zip', 'company_id', 'property_id', 'notes', 'add_note'];
  names jsonb := jsonb_build_object('contact_email', 'email', 'contact_phone', 'phone', 'contact_type', 'type',
                                    'address_street', 'street', 'address_unit', 'unit', 'address_city', 'city',
                                    'address_state', 'state', 'address_zip', 'zip');
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
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'people.update', 422, 'invalid_field', v_msg);
  end;

  if not exists (select 1 from contacts c where c.id = v_pid
                 and not exists (select 1 from companies s where s.id = c.company_id and s.company_type = 'Subcontractor')) then
    return _bot_reject(k, 'people.update', 404, 'unknown_person', 'No person with that id.');
  end if;

  -- An email that belongs to someone else would make two people one address.
  if fl ? 'contact_email' then
    select c.id into v_other from contacts c
    where lower(btrim(c.contact_email)) = fl ->> 'contact_email' and c.id <> v_pid limit 1;
    if v_other is not null then
      return _bot_reject(k, 'people.update', 409, 'email_in_use', 'Another person already has that email address.', jsonb_build_object('person_id', v_other));
    end if;
  end if;

  rep := _bot_fill('contacts', v_pid, fl, '{}'::text[], names);
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


-- ─── 5. Companies ───────────────────────────────────────────────────────
-- Subcontractors are rows in Companies too. They are not sales records, so a bot never
-- sees them, and cannot create a company of that type.

-- GET /api/bot/sales/companies
create or replace function bot_sales_companies_list(p_key text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  allowed text[] := array['id', 'q', 'type', 'city', 'state', 'email', 'created_since', 'limit', 'cursor'];
  unknown text[];
  v_limit integer := 50;
  v_id uuid;
  v_q text;
  v_type text;
  v_city text;
  v_state text;
  v_email text;
  v_created timestamptz;
  v_cursor text;
  cur record;
  v_items jsonb;
  v_more boolean;
  v_next text;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if jsonb_typeof(f) <> 'object' then
    return _bot_reject(k, 'companies.list', 422, 'invalid_filters', 'Filters must be a JSON object.');
  end if;
  unknown := _bot_unknown_keys(f, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'companies.list', 422, 'unknown_filter', format('Unknown filter: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  begin
    if f ? 'limit' then
      v_limit := (f ->> 'limit')::integer;
      if v_limit < 1 or v_limit > 200 then
        return _bot_reject(k, 'companies.list', 422, 'invalid_filter', 'limit must be between 1 and 200.');
      end if;
    end if;
  exception when invalid_text_representation then
    return _bot_reject(k, 'companies.list', 422, 'invalid_filter', 'limit must be a whole number between 1 and 200.');
  end;

  begin
    v_id := nullif(btrim(f ->> 'id'), '')::uuid;
  exception when others then
    return _bot_reject(k, 'companies.list', 422, 'invalid_filter', 'id must be a UUID.');
  end;

  v_type := nullif(btrim(f ->> 'type'), '');
  if v_type is not null then
    begin
      v_type := _bot_canon(_bot_enums() -> 'company_types', v_type, 'type');
    exception when sqlstate 'BK422' then
      return _bot_reject(k, 'companies.list', 422, 'invalid_filter', format('Unknown type "%s".', v_type), jsonb_build_object('allowed', _bot_enums() -> 'company_types'));
    end;
  end if;
  v_q := nullif(lower(btrim(f ->> 'q')), '');
  v_email := nullif(lower(btrim(f ->> 'email')), '');
  v_city := nullif(_bot_norm(f ->> 'city'), '');
  v_state := nullif(_bot_norm(f ->> 'state'), '');
  if length(coalesce(v_q, '')) > 100 or length(coalesce(v_email, '')) > 254 then
    return _bot_reject(k, 'companies.list', 422, 'invalid_filter', 'q or email is too long.');
  end if;
  begin
    v_created := (f ->> 'created_since')::timestamptz;
  exception when others then
    return _bot_reject(k, 'companies.list', 422, 'invalid_filter', 'created_since must be an ISO 8601 date, like 2026-10-01 or 2026-10-01T12:00:00Z.');
  end;

  v_cursor := nullif(btrim(f ->> 'cursor'), '');
  select * into cur from _bot_cursor(v_cursor);
  if cur.bad then
    return _bot_reject(k, 'companies.list', 422, 'invalid_filter', 'cursor is not valid. Use the next_cursor value from the previous page.');
  end if;

  with page as (
    select co.*, row_number() over (order by co.created_at, co.id) as rn
    from companies co
    where coalesce(co.company_type, '') <> 'Subcontractor'
      and (v_id is null or co.id = v_id)
      and (v_type is null or co.company_type = v_type)
      and (v_city is null or _bot_norm(co.city) = v_city)
      and (v_state is null or _bot_norm(co.state) = v_state)
      and (v_created is null or co.created_at >= v_created)
      and (v_q is null or position(v_q in lower(concat_ws(' ', co.company_name, co.city, co.contact_name, co.contact_email))) > 0)
      and (v_email is null
           or lower(btrim(co.contact_email)) = v_email
           or exists (select 1 from contacts c where c.company_id = co.id and lower(btrim(c.contact_email)) = v_email))
      and (cur.ts is null or (co.created_at, co.id) > (cur.ts, cur.id))
    order by co.created_at, co.id
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', pg.id,
      'name', pg.company_name,
      'type', pg.company_type,
      'street', pg.street,
      'unit', pg.unit,
      'city', pg.city,
      'state', pg.state,
      'zip', pg.zip,
      'contact_name', pg.contact_name,
      'contact_email', pg.contact_email,
      'contact_phone', pg.contact_phone,
      'notes', pg.notes,
      'people_count', (select count(*) from contacts c where c.company_id = pg.id),
      'people', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'email', x.contact_email, 'position', x.position) order by x.name)
        from (select c.id, c.name, c.contact_email, c.position from contacts c where c.company_id = pg.id order by c.name limit 25) x
      ), '[]'::jsonb),
      'properties_count', (select count(*) from properties p where p.company_id = pg.id),
      'properties', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.property_name, 'stage', x.prospect_stage) order by x.property_name)
        from (select p.id, p.property_name, p.prospect_stage from properties p where p.company_id = pg.id order by p.property_name limit 25) x
      ), '[]'::jsonb),
      -- Touches with the company's people and its properties.
      'touches', (
        select jsonb_build_object('count', count(*), 'last_at', max(t.sent_at), 'last_outcome', (array_agg(t.outcome order by t.sent_at desc))[1])
        from outreach_touches t
        where t.property_id in (select p.id from properties p where p.company_id = pg.id)
           or t.contact_id in (select c.id from contacts c where c.company_id = pg.id)
      ),
      'created_at', pg.created_at
    ) order by pg.rn) filter (where pg.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit,
    (array_agg(encode(convert_to(pg.created_at::text || '|' || pg.id::text, 'utf8'), 'hex') order by pg.rn) filter (where pg.rn = v_limit))[1]
  into v_items, v_more, v_next
  from page pg;

  perform _bot_log(k, 'companies.list', 'ok', jsonb_build_object('returned', jsonb_array_length(v_items)));
  return jsonb_build_object('ok', true, 'items', v_items, 'count', jsonb_array_length(v_items), 'next_cursor', case when v_more then v_next else null end);
end;
$$;

-- POST /api/bot/sales/companies
create or replace function bot_sales_company_create(p_key text, p_body jsonb, p_idem text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  b jsonb := p_body;
  allowed text[] := array['name', 'type', 'street', 'unit', 'city', 'state', 'zip', 'contact_name', 'contact_email', 'contact_phone', 'notes'];
  unknown text[];
  v_idem text := nullif(btrim(p_idem), '');
  v_hash text;
  v_early jsonb;
  v_msg text;
  fl jsonb;
  v_notes text;
  n_name text; n_street text; n_city text;
  v_id uuid;
  v_status text := 'created';
  v_similar jsonb;
  v_resp jsonb;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if b is null or jsonb_typeof(b) <> 'object' then
    return _bot_reject(k, 'companies.create', 422, 'invalid_body', 'Send a JSON object. Required field: name.');
  end if;
  unknown := _bot_unknown_keys(b, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'companies.create', 422, 'unknown_field', format('Unknown field: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  v_hash := md5(b::text);
  v_early := _bot_idem_check(k, 'companies.create', v_idem, v_hash);
  if v_early is not null then return v_early; end if;

  begin
    fl := _bot_company_fields(b);
    v_notes := fl ->> 'notes';
    if (fl ->> 'company_name') is null then
      raise exception 'name is required.' using errcode = 'BK422';
    end if;
    n_name := _bot_norm(fl ->> 'company_name');
    n_street := _bot_norm_street(fl ->> 'street');
    n_city := _bot_norm(fl ->> 'city');
    if n_name = '' then
      raise exception 'name must contain letters or numbers.' using errcode = 'BK422';
    end if;
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'companies.create', 422, 'invalid_field', v_msg);
  end;

  perform pg_advisory_xact_lock(hashtextextended('bot_company:' || n_name || ':' || coalesce(nullif(n_street, ''), n_city), 0));

  -- Same name, and the same street. With a street missing on one side, the same city.
  -- With neither a street nor a city to compare, the name alone matches.
  select co.id into v_id
  from companies co
  where coalesce(co.company_type, '') <> 'Subcontractor'
    and _bot_norm(co.company_name) = n_name
    and (
      (n_street <> '' and _bot_norm_street(co.street) <> '' and _bot_norm_street(co.street) = n_street)
      or ((n_street = '' or _bot_norm_street(co.street) = '') and n_city <> '' and _bot_norm(co.city) <> '' and _bot_norm(co.city) = n_city)
      or ((n_street = '' or _bot_norm_street(co.street) = '') and (n_city = '' or _bot_norm(co.city) = ''))
    )
  order by co.created_at
  limit 1;

  if v_id is not null then
    v_status := 'duplicate';
  else
    insert into companies (company_name, company_type, street, unit, city, state, zip, contact_name, contact_email, contact_phone, notes, created_by_bot_id)
    values (fl ->> 'company_name', fl ->> 'company_type', fl ->> 'street', fl ->> 'unit', fl ->> 'city', fl ->> 'state', fl ->> 'zip',
            fl ->> 'contact_name', fl ->> 'contact_email', fl ->> 'contact_phone',
            case when v_notes is null then null else _bot_append_note(null, k.name, v_notes) end, k.id)
    returning id into v_id;
  end if;

  -- Soft matches: the same name elsewhere, or the same contact email.
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.company_name, 'matched_on', s.matched_on)), '[]'::jsonb)
  into v_similar
  from (
    select co.id, co.company_name,
      case when (fl ->> 'contact_email') is not null and lower(btrim(co.contact_email)) = fl ->> 'contact_email' then 'contact_email' else 'name' end as matched_on
    from companies co
    where co.id <> v_id and coalesce(co.company_type, '') <> 'Subcontractor'
      and (_bot_norm(co.company_name) = n_name
           or ((fl ->> 'contact_email') is not null and lower(btrim(co.contact_email)) = fl ->> 'contact_email'))
    order by co.created_at
    limit 5
  ) s;

  v_resp := jsonb_build_object('ok', true, 'status', v_status, 'id', v_id, 'matched_on', case when v_status = 'duplicate' then 'name_and_address' else null end, 'similar', v_similar);
  perform _bot_idem_save(k, 'companies.create', v_idem, v_hash, v_resp);
  perform _bot_log(k, 'companies.create', 'ok', jsonb_build_object('company_id', v_id, 'status', v_status));
  return v_resp;
end;
$$;

-- PATCH /api/bot/sales/companies/{id}
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
    v_add := _bot_text(b, 'add_note', 2000);
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'companies.update', 422, 'invalid_field', v_msg);
  end;

  if not exists (select 1 from companies co where co.id = v_cid and coalesce(co.company_type, '') <> 'Subcontractor') then
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

-- ─── 6. Properties (prospects): update ──────────────────────────────────
-- PATCH /api/bot/sales/prospects/{id}
--
-- Descriptive fields (type, vertical, tier, address, management company, size, year built,
-- the main contact, company link) only fill blanks, like People and Companies.
-- The working fields can be replaced, because moving a prospect along is the job:
--   stage          prospecting, contacted, proposal or lost (never won)
--   next_action_at, next_action_note   what happens next. null clears it.
--   lost_reason, reengage_at           only while the stage is lost
--   do_not_contact                     can be set to true, never cleared
-- add_note appends a dated note.
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
                          'stage', 'next_action_at', 'next_action_note', 'lost_reason', 'reengage_at', 'do_not_contact', 'notes', 'add_note'];
  names jsonb := jsonb_build_object('property_type', 'type', 'prospect_vertical', 'vertical', 'prospect_tier', 'tier',
                                    'property_street', 'street', 'property_unit', 'unit', 'property_city', 'city',
                                    'property_state', 'state', 'property_zip', 'zip', 'prospect_stage', 'stage');
  overwrite text[] := array['prospect_stage', 'next_action_at', 'next_action_note', 'lost_reason', 'reengage_at', 'do_not_contact'];
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

  select p.prospect_stage into v_cur_stage from properties p where p.id = v_pid;
  if not found then
    return _bot_reject(k, 'prospects.update', 404, 'unknown_prospect', 'No prospect with that id.');
  end if;

  begin
    v := _bot_text(b, 'type', 60);               if v is not null then fl := fl || jsonb_build_object('property_type', v); end if;
    v := lower(_bot_text(b, 'vertical', 60));    if v is not null then fl := fl || jsonb_build_object('prospect_vertical', v); end if;
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
      if v_stage = 'won' then
        raise exception 'A bot cannot mark a prospect as won. Staff decide that. Settable stages: prospecting, contacted, proposal, lost.' using errcode = 'BK422';
      end if;
      if not ((_bot_enums() -> 'settable_prospect_stages') ? v_stage) then
        raise exception 'Unknown stage "%". Allowed: prospecting, contacted, proposal, lost.', v_stage using errcode = 'BK422';
      end if;
      fl := fl || jsonb_build_object('prospect_stage', v_stage);
    end if;

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

-- ─── 7. Sales page: follow up lists and scorecard ───────────────────────
-- The staff function checks for a signed in staff member. The bot function checks the key.
-- Both read the same numbers from one function, so they cannot drift apart.

create or replace function _crm_follow_up_core(p_limit integer default 25, p_stalled_days integer default 14)
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


create or replace function crm_follow_up(p_limit integer default 25, p_stalled_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (coalesce(is_admin(), false) or _is_trusted_context()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return _crm_follow_up_core(p_limit, p_stalled_days);
end;
$$;

-- GET /api/bot/sales/follow-up
-- The Sales page lists a bot would otherwise have to rebuild: next steps that are overdue,
-- prospects with no next step, prospects gone quiet, lost ones to try again, and the scorecard.
create or replace function bot_sales_follow_up(p_key text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  allowed text[] := array['limit', 'stalled_days'];
  unknown text[];
  v_limit integer := 25;
  v_days integer := 14;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if jsonb_typeof(f) <> 'object' then
    return _bot_reject(k, 'follow_up', 422, 'invalid_filters', 'Filters must be a JSON object.');
  end if;
  unknown := _bot_unknown_keys(f, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'follow_up', 422, 'unknown_filter', format('Unknown filter: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;
  begin
    if f ? 'limit' then
      v_limit := (f ->> 'limit')::integer;
      if v_limit < 1 or v_limit > 100 then
        return _bot_reject(k, 'follow_up', 422, 'invalid_filter', 'limit must be between 1 and 100.');
      end if;
    end if;
    if f ? 'stalled_days' then
      v_days := (f ->> 'stalled_days')::integer;
      if v_days < 1 or v_days > 365 then
        return _bot_reject(k, 'follow_up', 422, 'invalid_filter', 'stalled_days must be between 1 and 365.');
      end if;
    end if;
  exception when invalid_text_representation then
    return _bot_reject(k, 'follow_up', 422, 'invalid_filter', 'limit and stalled_days must be whole numbers.');
  end;

  perform _bot_log(k, 'follow_up', 'ok');
  return jsonb_build_object('ok', true) || _crm_follow_up_core(v_limit, v_days);
end;
$$;


-- The prospects list, with id and company_id filters and the follow up tracking fields.
create or replace function bot_sales_prospects_list(p_key text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  allowed text[] := array['id', 'company_id', 'stage', 'vertical', 'tier', 'city', 'state', 'type', 'q', 'email', 'can_email', 'contacted', 'created_since', 'limit', 'cursor'];
  unknown text[];
  v_limit integer := 50;
  v_id uuid;
  v_company uuid;
  v_stage text;
  v_vertical text;
  v_tier text;
  v_city text;
  v_state text;
  v_type text;
  v_q text;
  v_email text;
  v_can boolean;
  v_contacted boolean;
  v_created timestamptz;
  v_cursor text;
  v_dec text;
  v_cur_ts timestamptz;
  v_cur_id uuid;
  v_items jsonb;
  v_more boolean;
  v_next text;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if jsonb_typeof(f) <> 'object' then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filters', 'Filters must be a JSON object.');
  end if;
  unknown := _bot_unknown_keys(f, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'prospects.list', 422, 'unknown_filter', format('Unknown filter: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  begin
    if f ? 'limit' then
      v_limit := (f ->> 'limit')::integer;
      if v_limit < 1 or v_limit > 200 then
        return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'limit must be between 1 and 200.');
      end if;
    end if;
  exception when invalid_text_representation then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'limit must be a whole number between 1 and 200.');
  end;

  begin
    v_id := nullif(btrim(f ->> 'id'), '')::uuid;
    v_company := nullif(btrim(f ->> 'company_id'), '')::uuid;
  exception when others then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'id and company_id must be UUIDs.');
  end;

  v_stage := nullif(lower(btrim(f ->> 'stage')), '');
  if v_stage is not null and not ((_bot_enums() -> 'prospect_stages') ? v_stage) then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', format('Unknown stage "%s".', v_stage), jsonb_build_object('allowed', _bot_enums() -> 'prospect_stages'));
  end if;
  v_tier := nullif(upper(btrim(f ->> 'tier')), '');
  if v_tier is not null and not ((_bot_enums() -> 'tiers') ? v_tier) then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', format('Unknown tier "%s".', v_tier), jsonb_build_object('allowed', _bot_enums() -> 'tiers'));
  end if;
  v_vertical := nullif(lower(btrim(f ->> 'vertical')), '');
  v_city := nullif(_bot_norm(f ->> 'city'), '');
  v_state := nullif(_bot_norm(f ->> 'state'), '');
  v_type := nullif(lower(btrim(f ->> 'type')), '');
  v_q := nullif(lower(btrim(f ->> 'q')), '');
  v_email := nullif(lower(btrim(f ->> 'email')), '');
  if length(coalesce(v_q, '')) > 100 or length(coalesce(v_email, '')) > 254 then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'q or email is too long.');
  end if;

  if f ? 'can_email' then
    v_can := _bot_bool(f ->> 'can_email');
    if v_can is null then return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'can_email must be true or false.'); end if;
  end if;
  if f ? 'contacted' then
    v_contacted := _bot_bool(f ->> 'contacted');
    if v_contacted is null then return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'contacted must be true or false.'); end if;
  end if;

  begin
    v_created := (f ->> 'created_since')::timestamptz;
  exception when others then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'created_since must be an ISO 8601 date, like 2026-10-01 or 2026-10-01T12:00:00Z.');
  end;

  v_cursor := nullif(btrim(f ->> 'cursor'), '');
  if v_cursor is not null then
    begin
      v_dec := convert_from(decode(v_cursor, 'hex'), 'utf8');
      v_cur_ts := split_part(v_dec, '|', 1)::timestamptz;
      v_cur_id := split_part(v_dec, '|', 2)::uuid;
    exception when others then
      return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'cursor is not valid. Use the next_cursor value from the previous page.');
    end;
  end if;

  with base as (
    select p.*,
      (not p.do_not_contact and (
        (p.contact_email is not null and btrim(p.contact_email) <> '' and _outreach_blocked_reason(p.contact_email, p.id) is null)
        or exists (
          select 1 from contacts c
          where c.property_id = p.id and c.contact_email is not null and btrim(c.contact_email) <> ''
            and _outreach_blocked_reason(c.contact_email, p.id) is null
        )
      )) as emailable
    from properties p
    where (v_id is null or p.id = v_id)
      and (v_company is null or p.company_id = v_company)
      and (v_stage is null or p.prospect_stage = v_stage)
      and (v_vertical is null or lower(p.prospect_vertical) = v_vertical)
      and (v_tier is null or p.prospect_tier = v_tier)
      and (v_city is null or _bot_norm(p.property_city) = v_city)
      and (v_state is null or _bot_norm(p.property_state) = v_state)
      and (v_type is null or lower(p.property_type) = v_type)
      and (v_created is null or p.created_at >= v_created)
      and (v_contacted is null or (p.last_contacted_at is not null) = v_contacted)
      and (v_q is null or position(v_q in lower(concat_ws(' ', p.property_name, p.property_city, p.contact_name, p.contact_email, p.management_company))) > 0)
      and (v_email is null
           or lower(btrim(p.contact_email)) = v_email
           or exists (select 1 from contacts c where c.property_id = p.id and lower(btrim(c.contact_email)) = v_email))
      and (v_cur_ts is null or (p.created_at, p.id) > (v_cur_ts, v_cur_id))
  ), page as (
    select b.*, row_number() over (order by b.created_at, b.id) as rn
    from base b
    where (v_can is null or b.emailable = v_can)
    order by b.created_at, b.id
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', pg.id,
      'name', pg.property_name,
      'type', pg.property_type,
      'vertical', pg.prospect_vertical,
      'tier', pg.prospect_tier,
      'stage', pg.prospect_stage,
      'stage_changed_at', pg.stage_changed_at,
      'lost_reason', pg.lost_reason,
      'reengage_at', pg.reengage_at,
      'company_id', pg.company_id,
      'source', pg.prospect_source,
      'street', pg.property_street,
      'unit', pg.property_unit,
      'city', pg.property_city,
      'state', pg.property_state,
      'zip', pg.property_zip,
      'management_company', pg.management_company,
      'year_built', pg.year_built,
      'sq_ft', pg.sq_ft,
      'notes', pg.notes,
      'do_not_contact', pg.do_not_contact,
      'can_email', pg.emailable,
      'last_contacted_at', pg.last_contacted_at,
      'last_visited_at', pg.last_visited_at,
      'next_action_at', pg.next_action_at,
      'next_action_note', pg.next_action_note,
      'contact', jsonb_build_object(
        'name', pg.contact_name,
        'email', pg.contact_email,
        'phone', pg.contact_phone,
        'can_email', (not pg.do_not_contact and pg.contact_email is not null and btrim(pg.contact_email) <> '' and _outreach_blocked_reason(pg.contact_email, pg.id) is null)
      ),
      'people', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'first_name', c.first_name, 'last_name', c.last_name,
          'email', c.contact_email, 'phone', c.contact_phone, 'position', c.position, 'role', c.role,
          'can_email', (not pg.do_not_contact and c.contact_email is not null and btrim(c.contact_email) <> '' and _outreach_blocked_reason(c.contact_email, pg.id) is null)
        ) order by c.name)
        from contacts c where c.property_id = pg.id
      ), '[]'::jsonb),
      'touches', (
        select jsonb_build_object('count', count(*), 'last_at', max(t.sent_at), 'last_outcome', (array_agg(t.outcome order by t.sent_at desc))[1])
        from outreach_touches t where t.property_id = pg.id
      ),
      'created_at', pg.created_at
    ) order by pg.rn) filter (where pg.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit,
    (array_agg(encode(convert_to(pg.created_at::text || '|' || pg.id::text, 'utf8'), 'hex') order by pg.rn) filter (where pg.rn = v_limit))[1]
  into v_items, v_more, v_next
  from page pg;

  perform _bot_log(k, 'prospects.list', 'ok', jsonb_build_object('returned', jsonb_array_length(v_items)));
  return jsonb_build_object('ok', true, 'items', v_items, 'count', jsonb_array_length(v_items), 'next_cursor', case when v_more then v_next else null end);
end;
$$;


-- Log outreach. New: person_id, and a touch may be about a person who has no prospect.
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
  allowed text[] := array['prospect_id', 'person_id', 'email', 'channel', 'direction', 'outcome', 'note', 'sent_at'];
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
  v_person uuid;
  v_pemail text;
  v_prop_person uuid;
  v_ucontacts uuid[];
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
    v_person := _bot_uuid(b, 'person_id');
    if v_pid is null and v_person is null and v_email is null then
      raise exception 'Send prospect_id, person_id, or the email address you contacted so the right record can be found.' using errcode = 'BK422';
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

  -- Find who this touch is about: a prospect, a person, or both. A person does not
  -- have to belong to a prospect.
  if v_pid is not null then
    perform 1 from properties p where p.id = v_pid;
    if not found then
      return _bot_reject(k, 'outreach.log', 404, 'unknown_prospect', 'No prospect with that prospect_id.');
    end if;
  end if;

  if v_person is not null then
    select lower(btrim(c.contact_email)), c.property_id into v_pemail, v_prop_person
    from contacts c
    where c.id = v_person
      and not exists (select 1 from companies s where s.id = c.company_id and s.company_type = 'Subcontractor');
    if not found then
      return _bot_reject(k, 'outreach.log', 404, 'unknown_person', 'No person with that person_id.');
    end if;
    if v_pid is not null and v_prop_person is not null and v_prop_person <> v_pid then
      return _bot_reject(k, 'outreach.log', 422, 'person_not_at_prospect',
        'That person belongs to a different prospect. Send only person_id, or the prospect they belong to.',
        jsonb_build_object('prospect_id', v_prop_person));
    end if;
    v_contact_id := v_person;
    v_email := coalesce(v_email, nullif(v_pemail, ''));
    if v_pid is null then v_pid := v_prop_person; end if;
  end if;

  if v_pid is null and v_person is null then
    select coalesce(array_agg(distinct m.pid), '{}'::uuid[]) into v_matches
    from (
      select p.id as pid from properties p where lower(btrim(p.contact_email)) = v_email
      union
      select c.property_id as pid from contacts c where lower(btrim(c.contact_email)) = v_email and c.property_id is not null
    ) m;
    select coalesce(array_agg(c.id), '{}'::uuid[]) into v_ucontacts
    from contacts c
    where lower(btrim(c.contact_email)) = v_email and c.property_id is null
      and not exists (select 1 from companies s where s.id = c.company_id and s.company_type = 'Subcontractor');
    if cardinality(v_matches) + cardinality(v_ucontacts) = 0 then
      return _bot_reject(k, 'outreach.log', 404, 'unknown_prospect',
        'No prospect or person has that email address. Add it first with POST /api/bot/sales/prospects or /api/bot/sales/people.');
    elsif cardinality(v_matches) + cardinality(v_ucontacts) > 1 then
      return _bot_reject(k, 'outreach.log', 409, 'ambiguous_prospect',
        'That email address belongs to more than one record. Send prospect_id or person_id to say which.',
        jsonb_build_object('prospect_ids', to_jsonb(v_matches[1:10]), 'person_ids', to_jsonb(v_ucontacts[1:10])));
    elsif cardinality(v_matches) = 1 then
      v_pid := v_matches[1];
    else
      v_contact_id := v_ucontacts[1];
    end if;
  end if;

  if v_contact_id is null and v_email is not null and v_pid is not null then
    select c.id into v_contact_id from contacts c
    where c.property_id = v_pid and lower(btrim(c.contact_email)) = v_email
    limit 1;
  end if;

  -- The same touch sent twice (same bot, record, channel, direction, outcome and time) is one touch.
  select t.id into v_dup from outreach_touches t
  where t.bot_key_id = k.id and t.channel = v_channel and t.direction = v_direction
    and t.outcome = v_outcome and t.sent_at = v_sent_at
    and ((v_pid is not null and t.property_id = v_pid)
         or (v_pid is null and t.property_id is null and t.contact_id = v_contact_id))
  limit 1;
  if v_dup is not null then
    v_resp := jsonb_build_object('ok', true, 'status', 'duplicate', 'touch_id', v_dup, 'prospect_id', v_pid, 'person_id', v_contact_id, 'effects', '[]'::jsonb);
    perform _bot_log(k, 'outreach.log', 'ok', jsonb_build_object('prospect_id', v_pid, 'person_id', v_contact_id, 'status', 'duplicate'));
    return v_resp;
  end if;

  insert into outreach_touches (property_id, contact_id, to_email, channel, direction, outcome, note, sent_at, bot_key_id, bot_name)
  values (v_pid, v_contact_id, v_email, v_channel, v_direction, v_outcome, v_note, v_sent_at, k.id, k.name)
  returning id into v_touch_id;

  -- Side effects, kept to what staff would otherwise have to do by hand.
  if v_pid is not null then
    select p.prospect_stage, p.next_action_note into v_before, v_old_note from properties p where p.id = v_pid for update;
  end if;

  v_counts := v_outcome in ('sent', 'connected', 'voicemail', 'replied', 'interested', 'not_interested', 'unsubscribed', 'meeting_set');
  if v_counts and v_pid is not null then
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
    if v_pid is not null then
    update properties
      set next_action_at = now(),
          next_action_note = left(
            format('Bot %s: %s. Follow up.', k.name, replace(v_outcome, '_', ' '))
            || case when coalesce(v_old_note, '') <> '' and v_old_note not like 'Bot %' then ' (previous: ' || v_old_note || ')' else '' end,
            300)
      where id = v_pid;
    v_effects := v_effects || 'follow_up_flagged'::text;
    end if;
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

  v_resp := jsonb_build_object('ok', true, 'status', 'logged', 'touch_id', v_touch_id, 'prospect_id', v_pid, 'person_id', v_contact_id, 'effects', to_jsonb(v_effects));

  if v_idem is not null then
    insert into bot_idempotency (bot_key_id, idem_key, action, request_hash, response)
    values (k.id, v_idem, 'outreach.log', v_hash, v_resp)
    on conflict (bot_key_id, idem_key) do nothing;
  end if;

  perform _bot_log(k, 'outreach.log', 'ok', jsonb_build_object('prospect_id', v_pid, 'person_id', v_contact_id, 'touch_id', v_touch_id, 'outcome', v_outcome));
  return v_resp;
end;
$$;


-- History: by person or company too, and staff touches can be filtered.
create or replace function bot_sales_outreach_history(p_key text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  allowed text[] := array['prospect_id', 'person_id', 'company_id', 'email', 'channel', 'outcome', 'source', 'since', 'limit', 'cursor'];
  unknown text[];
  v_limit integer := 50;
  v_pid uuid;
  v_person uuid;
  v_company uuid;
  v_email text;
  v_channel text;
  v_outcome text;
  v_source text;
  v_since timestamptz;
  v_cursor text;
  v_dec text;
  v_cur_ts timestamptz;
  v_cur_id uuid;
  v_outcomes jsonb;
  s record;
  v_all boolean := true;
  v_contacts uuid[] := '{}';
  v_props uuid[] := '{}';
  v_addrs text[] := '{}';
  v_items jsonb;
  v_more boolean;
  v_next text;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if jsonb_typeof(f) <> 'object' then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filters', 'Filters must be a JSON object.');
  end if;
  unknown := _bot_unknown_keys(f, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'outreach.history', 422, 'unknown_filter', format('Unknown filter: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  begin
    if f ? 'limit' then
      v_limit := (f ->> 'limit')::integer;
      if v_limit < 1 or v_limit > 200 then
        return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', 'limit must be between 1 and 200.');
      end if;
    end if;
  exception when invalid_text_representation then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', 'limit must be a whole number between 1 and 200.');
  end;

  -- Outcomes a bot logs, plus what the platform records for its own sequences and received mail.
  v_outcomes := (_bot_enums() -> 'outcomes') || jsonb_build_array('opened', 'clicked');

  v_channel := nullif(lower(btrim(f ->> 'channel')), '');
  if v_channel is not null and not ((_bot_enums() -> 'channels') ? v_channel) then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', format('Unknown channel "%s".', v_channel), jsonb_build_object('allowed', _bot_enums() -> 'channels'));
  end if;
  v_outcome := nullif(lower(btrim(f ->> 'outcome')), '');
  if v_outcome is not null and not (v_outcomes ? v_outcome) then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', format('Unknown outcome "%s".', v_outcome), jsonb_build_object('allowed', v_outcomes));
  end if;
  v_source := nullif(lower(btrim(f ->> 'source')), '');
  if v_source is not null and v_source not in ('touch', 'staff', 'sequence') then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', format('Unknown source "%s".', v_source), jsonb_build_object('allowed', jsonb_build_array('touch', 'staff', 'sequence')));
  end if;

  v_email := nullif(lower(btrim(f ->> 'email')), '');
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', 'email is not a valid email address.');
  end if;

  begin
    v_pid := nullif(btrim(f ->> 'prospect_id'), '')::uuid;
  exception when others then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', 'prospect_id must be an id from the prospects list.');
  end;
  begin
    v_person := nullif(btrim(f ->> 'person_id'), '')::uuid;
    v_company := nullif(btrim(f ->> 'company_id'), '')::uuid;
  exception when others then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', 'person_id and company_id must be ids from the people and companies lists.');
  end;
  if (v_pid is not null)::integer + (v_person is not null)::integer + (v_company is not null)::integer + (v_email is not null)::integer > 1 then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', 'Use only one of prospect_id, person_id, company_id or email.');
  end if;

  begin
    v_since := (f ->> 'since')::timestamptz;
  exception when others then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', 'since must be an ISO 8601 date, like 2026-10-01 or 2026-10-01T12:00:00Z.');
  end;

  v_cursor := nullif(btrim(f ->> 'cursor'), '');
  if v_cursor is not null then
    begin
      v_dec := convert_from(decode(v_cursor, 'hex'), 'utf8');
      v_cur_ts := split_part(v_dec, '|', 1)::timestamptz;
      v_cur_id := split_part(v_dec, '|', 2)::uuid;
    exception when others then
      return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', 'cursor is not valid. Use the next_cursor value from the previous page.');
    end;
  end if;

  if v_pid is not null then
    if not exists (select 1 from properties p where p.id = v_pid) then
      return _bot_reject(k, 'outreach.history', 404, 'unknown_prospect', 'No prospect with that prospect_id.');
    end if;
    -- A prospect's history includes everyone linked to it.
    select * into s from _crm_touch_scope('property', v_pid, '{}');
    v_all := false; v_contacts := s.contact_ids; v_props := s.property_ids; v_addrs := s.addresses;
  elsif v_person is not null then
    if not exists (select 1 from contacts c where c.id = v_person
                   and not exists (select 1 from companies sc where sc.id = c.company_id and sc.company_type = 'Subcontractor')) then
      return _bot_reject(k, 'outreach.history', 404, 'unknown_person', 'No person with that person_id.');
    end if;
    select * into s from _crm_touch_scope('contact', v_person, '{}');
    v_all := false; v_contacts := s.contact_ids; v_props := s.property_ids; v_addrs := s.addresses;
  elsif v_company is not null then
    if not exists (select 1 from companies co where co.id = v_company and coalesce(co.company_type, '') <> 'Subcontractor') then
      return _bot_reject(k, 'outreach.history', 404, 'unknown_company', 'No company with that company_id.');
    end if;
    -- A company's history includes its properties and everyone linked to it or them.
    select * into s from _crm_touch_scope('company', v_company, '{}');
    v_all := false; v_contacts := s.contact_ids; v_props := s.property_ids; v_addrs := s.addresses;
  elsif v_email is not null then
    -- Exactly this address: touches sent to it, and touches logged for the
    -- person who holds it.
    v_all := false;
    v_addrs := array[v_email];
    select coalesce(array_agg(c.id), '{}') into v_contacts from contacts c
      where v_email = any(_crm_emails(c.contact_email) || _crm_emails(c.billing_email));
  end if;

  with page as (
    select x.*, row_number() over (order by x.happened_at desc, x.id desc) as rn
    from _crm_touch_feed(v_all, v_contacts, v_props, v_addrs, '{}', false) x
    where (v_channel is null or x.channel = v_channel)
      and (v_outcome is null or x.kind = v_outcome)
      and (v_source is null or x.source = v_source)
      and (v_since is null or x.happened_at >= v_since)
      and (v_cur_ts is null or (x.happened_at, x.id) < (v_cur_ts, v_cur_id))
    order by x.happened_at desc, x.id desc
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', pg.id,
      'at', pg.happened_at,
      'source', pg.source,
      'channel', pg.channel,
      'direction', pg.direction,
      'outcome', pg.kind,
      'summary', pg.summary,
      'note', pg.note,
      'by', pg.actor,
      'email', pg.email,
      'prospect', case when pg.property_id is null then null else jsonb_build_object('id', pg.property_id, 'name', pg.property_name) end,
      'person', case when pg.person_id is null then null else jsonb_build_object('id', pg.person_id, 'name', pg.person_name) end
    ) order by pg.rn) filter (where pg.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit,
    (array_agg(encode(convert_to(pg.happened_at::text || '|' || pg.id::text, 'utf8'), 'hex') order by pg.rn) filter (where pg.rn = v_limit))[1]
  into v_items, v_more, v_next
  from page pg;

  perform _bot_log(k, 'outreach.history', 'ok', jsonb_build_object('returned', jsonb_array_length(v_items)));
  return jsonb_build_object('ok', true, 'items', v_items, 'count', jsonb_array_length(v_items), 'next_cursor', case when v_more then v_next else null end);
end;
$$;


-- ─── Settings, Bots tab: what each key has added ────────────────────────
-- Same as migration 161, plus how many people and companies each key created.
create or replace function bot_key_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not _bot_caller_is_owner() then raise exception 'Only an owner can manage bot keys.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k.id,
      'name', k.name,
      'prefix', k.key_prefix,
      'scopes', k.scopes,
      'live', (k.active and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())),
      'revoked_at', k.revoked_at,
      'expires_at', k.expires_at,
      'rate_limit_per_min', k.rate_limit_per_min,
      'last_used_at', k.last_used_at,
      'created_at', k.created_at,
      'calls_24h', (select count(*) from bot_audit_log a where a.bot_key_id = k.id and a.created_at > now() - interval '24 hours'),
      'prospects_created', (select count(*) from properties p where p.created_by_bot_id = k.id),
      'people_created', (select count(*) from contacts c where c.created_by_bot_id = k.id),
      'companies_created', (select count(*) from companies co where co.created_by_bot_id = k.id),
      'touches_logged', (select count(*) from outreach_touches t where t.bot_key_id = k.id)
    ) order by k.created_at desc)
    from bot_keys k
  ), '[]'::jsonb);
end;
$$;


-- ─── 8. Who can run what ────────────────────────────────────────────────
-- New functions are executable by everyone by default in Supabase, so each one is locked down.
-- Internal helpers: nobody calls these from the API.
revoke all on function _bot_canon(jsonb, text, text) from public, anon, authenticated;
revoke all on function _bot_uuid(jsonb, text) from public, anon, authenticated;
revoke all on function _bot_cursor(text) from public, anon, authenticated;
revoke all on function _bot_idem_check(bot_keys, text, text, text) from public, anon, authenticated;
revoke all on function _bot_idem_save(bot_keys, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function _bot_fill(text, uuid, jsonb, text[], jsonb) from public, anon, authenticated;
revoke all on function _bot_person_fields(jsonb) from public, anon, authenticated;
revoke all on function _bot_company_fields(jsonb) from public, anon, authenticated;
revoke all on function _bot_append_note(text, text, text) from public, anon, authenticated;
revoke all on function _crm_follow_up_core(integer, integer) from public, anon, authenticated;

-- Bots: the key is the credential, checked inside each function.
revoke all on function bot_sales_people_list(text, jsonb) from public;
revoke all on function bot_sales_person_create(text, jsonb, text) from public;
revoke all on function bot_sales_person_update(text, text, jsonb, text) from public;
revoke all on function bot_sales_companies_list(text, jsonb) from public;
revoke all on function bot_sales_company_create(text, jsonb, text) from public;
revoke all on function bot_sales_company_update(text, text, jsonb, text) from public;
revoke all on function bot_sales_prospect_update(text, text, jsonb, text) from public;
revoke all on function bot_sales_follow_up(text, jsonb) from public;
grant execute on function bot_sales_people_list(text, jsonb) to anon, authenticated;
grant execute on function bot_sales_person_create(text, jsonb, text) to anon, authenticated;
grant execute on function bot_sales_person_update(text, text, jsonb, text) to anon, authenticated;
grant execute on function bot_sales_companies_list(text, jsonb) to anon, authenticated;
grant execute on function bot_sales_company_create(text, jsonb, text) to anon, authenticated;
grant execute on function bot_sales_company_update(text, text, jsonb, text) to anon, authenticated;
grant execute on function bot_sales_prospect_update(text, text, jsonb, text) to anon, authenticated;
grant execute on function bot_sales_follow_up(text, jsonb) to anon, authenticated;

-- crm_follow_up is the same staff function as before (signed in staff only).
revoke all on function crm_follow_up(integer, integer) from public, anon;
grant execute on function crm_follow_up(integer, integer) to authenticated;

notify pgrst, 'reload schema';

-- Check: a bot function with no key must answer 401 and write nothing.
--   select bot_sales_people_list('mcb_wrong');
