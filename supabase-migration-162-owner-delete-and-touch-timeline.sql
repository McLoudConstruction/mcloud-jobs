-- Run in Supabase SQL Editor after migration 161. Safe to re-run.
--
-- Two features that share this migration.
--
-- 1. OWNER ONLY DELETE for People (contacts), Properties and Companies.
--    * Before: any signed in staff member could delete these rows straight from
--      the browser, and the only guard was a confirm() box.
--    * Now: no one can delete these rows directly. Deleting goes through
--      crm_delete_record(), which only an owner can run. It first shows what
--      else would be removed or unlinked (crm_delete_preview), refuses when
--      something still depends on the record, and writes a line to
--      admin_delete_log with a copy of the row.
--    * The log keeps its copies for 90 days. To bring a row back, an owner can
--      run, for example:
--        insert into contacts select * from jsonb_populate_record(null::contacts,
--          (select snapshot from admin_delete_log where record_id = '<id>' order by id desc limit 1));
--      Anything that was removed along with it (outreach touches, portal rows,
--      and so on) is not copied. The impact column says how much there was.
--
-- 2. TOUCH HISTORY. One feed of every time someone was contacted, built from:
--      outreach_touches   (bots, migration 161)
--      outreach_events    (platform email sequences: sent, replied, bounced...)
--      email_messages     (mail sent or received, staff only, never given to bots)
--    A touch on a Person also shows on the Property and Company they are linked
--    to, labeled with the person's name. crm_touch_timeline() feeds the history
--    on the People, Properties and Companies screens. bot_sales_outreach_history()
--    feeds GET /api/bot/sales/outreach.

-- ─── 1. Owner only delete ───────────────────────────────────────────────

-- True for an active owner, and for trusted server contexts (SQL editor,
-- service role), the same rule migration 161 uses for the bot key tools.
create or replace function _crm_caller_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _is_trusted_context() or coalesce(is_staff_owner(auth.uid()), false);
$$;

create table if not exists admin_delete_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('contact', 'property', 'company')),
  record_id uuid not null,
  record_name text,
  snapshot jsonb not null,
  impact jsonb not null default '{}',
  deleted_by uuid,                         -- no foreign key, so the log survives a staff account being removed
  deleted_by_name text,
  deleted_at timestamptz not null default now()
);
create index if not exists admin_delete_log_time_idx on admin_delete_log (deleted_at desc);
create index if not exists admin_delete_log_record_idx on admin_delete_log (record_id);

alter table admin_delete_log enable row level security;
drop policy if exists "Owner can read admin_delete_log" on admin_delete_log;
create policy "Owner can read admin_delete_log"
  on admin_delete_log for select using (is_staff_owner(auth.uid()));
-- No insert, update or delete policies: only crm_delete_record() writes here.

-- Walks the database's own foreign keys to find everything that points at the
-- record, so the preview is always right, even for tables added later.
-- action is deleted (removed along with it), unlinked (the link is cleared,
-- the row stays) or blocked (the database will refuse the delete).
create or replace function _crm_impact_walk(p_table regclass, p_ids uuid[], p_depth integer default 0)
returns table (action text, child_table text, child_column text, n bigint)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  fk record;
  v_n bigint;
  v_child_ids uuid[];
  v_has_id boolean;
begin
  if p_depth > 4 or p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  for fk in
    select c.conrelid::regclass as child, c.conrelid as child_oid, a.attname as col, c.confdeltype as deltype
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = p_table and cardinality(c.conkey) = 1
  loop
    execute format('select count(*) from %s where %I = any($1)', fk.child, fk.col) into v_n using p_ids;
    if v_n = 0 then continue; end if;

    action := case fk.deltype when 'c' then 'deleted' when 'n' then 'unlinked' when 'd' then 'unlinked' else 'blocked' end;
    child_table := fk.child::text;
    child_column := fk.col;
    n := v_n;
    return next;

    -- Rows removed by a cascade can have children of their own.
    if fk.deltype = 'c' and p_depth < 4 then
      select exists (
        select 1 from pg_attribute x
        where x.attrelid = fk.child_oid and x.attname = 'id' and x.atttypid = 'uuid'::regtype and not x.attisdropped
      ) into v_has_id;
      if v_has_id then
        execute format('select coalesce(array_agg(id), ''{}''::uuid[]) from %s where %I = any($1)', fk.child, fk.col)
          into v_child_ids using p_ids;
        return query select * from _crm_impact_walk(fk.child, v_child_ids, p_depth + 1);
      end if;
    end if;
  end loop;
end;
$$;

create or replace function _crm_delete_impact(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table regclass;
  v_result jsonb;
begin
  v_table := case p_kind
    when 'contact' then 'contacts'::regclass
    when 'property' then 'properties'::regclass
    when 'company' then 'companies'::regclass
  end;
  select jsonb_build_object(
    'blocked',  coalesce(jsonb_agg(jsonb_build_object('table', w.child_table, 'column', w.child_column, 'count', w.n) order by w.child_table) filter (where w.action = 'blocked'), '[]'::jsonb),
    'deleted',  coalesce(jsonb_agg(jsonb_build_object('table', w.child_table, 'column', w.child_column, 'count', w.n) order by w.child_table) filter (where w.action = 'deleted'), '[]'::jsonb),
    'unlinked', coalesce(jsonb_agg(jsonb_build_object('table', w.child_table, 'column', w.child_column, 'count', w.n) order by w.child_table) filter (where w.action = 'unlinked'), '[]'::jsonb)
  )
  into v_result
  from (
    select x.action, x.child_table, x.child_column, sum(x.n)::bigint as n
    from _crm_impact_walk(v_table, array[p_id]) x
    group by x.action, x.child_table, x.child_column
  ) w;
  return v_result;
end;
$$;

-- Owner only. Says what a delete would do, without doing it.
create or replace function crm_delete_preview(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_found boolean;
  v_impact jsonb;
begin
  if not _crm_caller_is_owner() then
    raise exception 'Only an owner can delete records.' using errcode = '42501';
  end if;
  if p_kind not in ('contact', 'property', 'company') then
    raise exception 'Unknown record type.';
  end if;

  if p_kind = 'contact' then
    select true, c.name into v_found, v_name from contacts c where c.id = p_id;
  elsif p_kind = 'property' then
    select true, p.property_name into v_found, v_name from properties p where p.id = p_id;
  else
    select true, c.company_name into v_found, v_name from companies c where c.id = p_id;
  end if;
  if not coalesce(v_found, false) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'That record no longer exists.');
  end if;

  v_impact := _crm_delete_impact(p_kind, p_id);
  return jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'id', p_id,
    'name', v_name,
    'blocked', jsonb_array_length(v_impact -> 'blocked') > 0,
    'impact', v_impact
  );
end;
$$;

-- Owner only. Deletes one record and logs it. Nothing is deleted when
-- something still depends on the record: the answer says what and why.
create or replace function crm_delete_record(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_name text;
  v_impact jsonb;
  v_staff text;
  v_table text;
begin
  if not _crm_caller_is_owner() then
    raise exception 'Only an owner can delete records.' using errcode = '42501';
  end if;
  if p_kind not in ('contact', 'property', 'company') then
    raise exception 'Unknown record type.';
  end if;
  v_table := case p_kind when 'contact' then 'contacts' when 'property' then 'properties' else 'companies' end;

  -- Lock the row so two people cannot delete it at once, and copy it.
  execute format('select to_jsonb(t) from %I t where t.id = $1 for update', v_table) into v_row using p_id;
  if v_row is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'That record no longer exists.');
  end if;
  v_name := case p_kind when 'contact' then v_row ->> 'name' when 'property' then v_row ->> 'property_name' else v_row ->> 'company_name' end;

  v_impact := _crm_delete_impact(p_kind, p_id);
  if jsonb_array_length(v_impact -> 'blocked') > 0 then
    return jsonb_build_object(
      'ok', false, 'code', 'blocked',
      'error', 'This record is still in use, so it cannot be deleted. Remove or reassign what is listed first.',
      'impact', v_impact
    );
  end if;

  select s.full_name into v_staff from staff_users s where s.id = auth.uid();

  begin
    insert into admin_delete_log (kind, record_id, record_name, snapshot, impact, deleted_by, deleted_by_name)
    values (p_kind, p_id, v_name, v_row, v_impact, auth.uid(), v_staff);
    execute format('delete from %I where id = $1', v_table) using p_id;
  exception when foreign_key_violation then
    return jsonb_build_object(
      'ok', false, 'code', 'blocked',
      'error', 'This record is still in use, so it cannot be deleted.',
      'impact', v_impact
    );
  end;

  -- Copies are kept for 90 days, then dropped.
  delete from admin_delete_log where deleted_at < now() - interval '90 days';

  return jsonb_build_object('ok', true, 'kind', p_kind, 'id', p_id, 'name', v_name, 'impact', v_impact);
end;
$$;

-- Take direct delete away from everyone. Each of these three tables had one
-- policy named "Admin can do everything on <table>" (for all commands). It is
-- replaced by read, add and change policies with the same rule, and no delete
-- policy at all, so the only way to delete is crm_delete_record() above.
drop policy if exists "Admin can do everything on contacts" on contacts;
drop policy if exists "Admin can read contacts" on contacts;
drop policy if exists "Admin can add contacts" on contacts;
drop policy if exists "Admin can update contacts" on contacts;
create policy "Admin can read contacts" on contacts for select using (is_admin());
create policy "Admin can add contacts" on contacts for insert with check (is_admin());
create policy "Admin can update contacts" on contacts for update using (is_admin()) with check (is_admin());

drop policy if exists "Admin can do everything on properties" on properties;
drop policy if exists "Admin can read properties" on properties;
drop policy if exists "Admin can add properties" on properties;
drop policy if exists "Admin can update properties" on properties;
create policy "Admin can read properties" on properties for select using (is_admin());
create policy "Admin can add properties" on properties for insert with check (is_admin());
create policy "Admin can update properties" on properties for update using (is_admin()) with check (is_admin());

drop policy if exists "Admin can do everything on companies" on companies;
drop policy if exists "Admin can read companies" on companies;
drop policy if exists "Admin can add companies" on companies;
drop policy if exists "Admin can update companies" on companies;
create policy "Admin can read companies" on companies for select using (is_admin());
create policy "Admin can add companies" on companies for insert with check (is_admin());
create policy "Admin can update companies" on companies for update using (is_admin()) with check (is_admin());

-- ─── 2. Touch history ───────────────────────────────────────────────────

-- Every email address inside a text value, lowercase. Same pattern the email
-- log trigger in migration 154 uses.
create or replace function _crm_emails(p text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct lower(r.m[1])), '{}'::text[])
  from regexp_matches(
    coalesce(p, ''),
    '([A-Za-z0-9._%+''-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})',
    'g'
  ) as r(m);
$$;

-- Shared webmail never says which company someone belongs to. Mirrors
-- FREE_MAIL_DOMAINS in lib/crmEmailAddresses.js.
create or replace function _crm_free_mail(p_domain text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_domain, '')) = any(array[
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com',
    'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'comcast.net', 'att.net',
    'sbcglobal.net', 'bellsouth.net', 'verizon.net', 'cox.net', 'charter.net',
    'earthlink.net', 'mail.com', 'gmx.com', 'zoho.com', 'yandex.com'
  ]);
$$;

create index if not exists outreach_touches_contact_idx on outreach_touches (contact_id) where contact_id is not null;
create index if not exists outreach_enrollments_contact_idx on outreach_enrollments (contact_id) where contact_id is not null;
-- Lets the feed tell a sequence email from the same message pulled in by the mailbox sync.
create index if not exists outreach_events_message_idx
  on outreach_events ((split_part(provider_message_id, ':', 1))) where event_type = 'sent' and provider_message_id is not null;

-- Which people, properties, addresses and domains belong to a record.
--   person:   themselves
--   property: the property and every person linked to it
--   company:  the company, its properties, and every person linked to the
--             company or to one of those properties
-- This is how a touch on a person also shows on their property and company.
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
    select coalesce(array_agg(c.id), '{}') into contact_ids from contacts c where c.property_id = p_id;
    select _crm_emails(p.contact_email) into addresses from properties p where p.id = p_id;
    addresses := coalesce(addresses, '{}') || coalesce((
      select array_agg(a) from contacts c, unnest(_crm_emails(c.contact_email) || _crm_emails(c.billing_email)) a
      where c.id = any(contact_ids)
    ), '{}');

  elsif p_kind = 'company' then
    select coalesce(array_agg(p.id), '{}') into property_ids from properties p where p.company_id = p_id;
    select coalesce(array_agg(c.id), '{}') into contact_ids from contacts c
      where c.company_id = p_id or c.property_id = any(property_ids);
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

-- The one feed behind both readers. p_all returns everything (no record
-- scope). p_mail adds staff mail, which bots never get.
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
    select t.sent_at as happened_at, t.id, 'touch'::text as source, t.channel, t.direction, t.outcome as kind,
           null::text as summary, t.note, t.bot_name as actor, t.to_email as email,
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

-- Staff screens: the touches timeline inside a Person, Property or Company.
create or replace function crm_touch_timeline(
  p_kind text, p_id uuid, p_limit integer default 50, p_cursor text default null, p_internal_domains text[] default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_dec text;
  v_cur_ts timestamptz;
  v_cur_id uuid;
  v_items jsonb;
  v_more boolean;
  v_next text;
  v_summary jsonb := null;
begin
  if not (coalesce(is_admin(), false) or _is_trusted_context()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_kind not in ('contact', 'property', 'company') then
    raise exception 'Unknown record type.';
  end if;

  if nullif(btrim(p_cursor), '') is not null then
    begin
      v_dec := convert_from(decode(btrim(p_cursor), 'hex'), 'utf8');
      v_cur_ts := split_part(v_dec, '|', 1)::timestamptz;
      v_cur_id := split_part(v_dec, '|', 2)::uuid;
    exception when others then
      raise exception 'That page marker is not valid.';
    end;
  end if;

  select * into s from _crm_touch_scope(p_kind, p_id, coalesce(p_internal_domains, '{}'));

  with page as (
    select f.*, row_number() over (order by f.happened_at desc, f.id desc) as rn
    from _crm_touch_feed(false, s.contact_ids, s.property_ids, s.addresses, s.domains, true) f
    where v_cur_ts is null or (f.happened_at, f.id) < (v_cur_ts, v_cur_id)
    order by f.happened_at desc, f.id desc
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', pg.id, 'at', pg.happened_at, 'source', pg.source, 'channel', pg.channel, 'direction', pg.direction,
      'kind', pg.kind, 'summary', pg.summary, 'note', pg.note, 'actor', pg.actor, 'email', pg.email,
      'person_id', pg.person_id, 'person_name', pg.person_name,
      'property_id', pg.property_id, 'property_name', pg.property_name
    ) order by pg.rn) filter (where pg.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit,
    (array_agg(encode(convert_to(pg.happened_at::text || '|' || pg.id::text, 'utf8'), 'hex') order by pg.rn) filter (where pg.rn = v_limit))[1]
  into v_items, v_more, v_next
  from page pg;

  -- The headline for the first page: how many touches, and the latest one.
  if v_cur_ts is null then
    select jsonb_build_object(
      'total', count(*),
      'last_at', max(f.happened_at),
      'last', (array_agg(jsonb_build_object(
        'source', f.source, 'channel', f.channel, 'direction', f.direction, 'kind', f.kind,
        'person_name', f.person_name, 'property_name', f.property_name
      ) order by f.happened_at desc, f.id desc))[1]
    ) into v_summary
    from _crm_touch_feed(false, s.contact_ids, s.property_ids, s.addresses, s.domains, true) f;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'next_cursor', case when v_more then v_next else null end,
    'summary', v_summary
  );
end;
$$;

-- GET /api/bot/sales/outreach: what has already happened, so a bot does not
-- contact someone twice. Bot touches and platform sequence events only. Staff
-- mailboxes are never included.
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
  allowed text[] := array['prospect_id', 'email', 'channel', 'outcome', 'source', 'since', 'limit', 'cursor'];
  unknown text[];
  v_limit integer := 50;
  v_pid uuid;
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
  if v_source is not null and v_source not in ('touch', 'sequence') then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', format('Unknown source "%s".', v_source), jsonb_build_object('allowed', jsonb_build_array('touch', 'sequence')));
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
  if v_pid is not null and v_email is not null then
    return _bot_reject(k, 'outreach.history', 422, 'invalid_filter', 'Use prospect_id or email, not both.');
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

-- ─── 3. Who can run what ────────────────────────────────────────────────
-- New functions are executable by everyone by default in Supabase, so each
-- one is locked down explicitly.
revoke all on function _crm_caller_is_owner() from public, anon, authenticated;
revoke all on function _crm_impact_walk(regclass, uuid[], integer) from public, anon, authenticated;
revoke all on function _crm_delete_impact(text, uuid) from public, anon, authenticated;
revoke all on function _crm_emails(text) from public, anon, authenticated;
revoke all on function _crm_free_mail(text) from public, anon, authenticated;
revoke all on function _crm_touch_scope(text, uuid, text[]) from public, anon, authenticated;
revoke all on function _crm_touch_feed(boolean, uuid[], uuid[], text[], text[], boolean) from public, anon, authenticated;

-- Signed in staff only. Each one checks the caller itself.
revoke all on function crm_delete_preview(text, uuid) from public, anon;
revoke all on function crm_delete_record(text, uuid) from public, anon;
revoke all on function crm_touch_timeline(text, uuid, integer, text, text[]) from public, anon;
grant execute on function crm_delete_preview(text, uuid) to authenticated;
grant execute on function crm_delete_record(text, uuid) to authenticated;
grant execute on function crm_touch_timeline(text, uuid, integer, text, text[]) to authenticated;

-- Bots: the key is the credential, checked inside.
revoke all on function bot_sales_outreach_history(text, jsonb) from public;
grant execute on function bot_sales_outreach_history(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

-- Check: this should list no delete rights on the three tables. If it shows a
-- row with cmd ALL or DELETE, that policy (made outside the repo) still lets
-- staff delete directly and should be dropped.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('contacts', 'properties', 'companies')
  and cmd in ('ALL', 'DELETE');
