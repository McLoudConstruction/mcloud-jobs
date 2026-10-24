-- Migration 172: bots can link a person to more than one property.
--
-- Run after 171. Safe to run twice.
--
-- Why
--  Migration 169 let a person belong to several properties, but only on the app side. A bot that
--  sent property_id when updating a person set their MAIN property, and the sync trigger treats
--  that as "moved", so the old link was dropped. Linking Carol Nastave to 1201 Walnut replaced her
--  1111 Main link.
--
-- What changes for bots
--  people.update   property_id now ADDS a property and keeps the person's other links. A person
--                  with no property yet gets it as their main one, as before.
--                  New main_property_id: make this property the main one. The old main stays
--                  linked as an extra property.
--                  New unlink_property_id: remove one link. If it was the main one, the oldest
--                  remaining link becomes the main one.
--  people.list     Each person has a new "properties" list (id, name, main). The property_id
--                  filter finds people linked to that property, main or not.
--  prospects.list  A prospect's contact and people include everyone linked to it, not only the
--                  people whose main property it is.
--  outreach.log    A touch for a person and one of their extra properties is accepted. A bare
--                  email that belongs to someone at several properties asks for prospect_id (the
--                  usual "ambiguous" answer) instead of picking one.
--
-- What does not change
--  people.create with property_id sets the new person's main property, as before.
--  The "do not contact" check for automated email still looks at the person's main property.
--
-- A note on who is calling
--  A bot calls with a key and is not a signed in admin, so the checked crm_link_contact_property and
--  crm_unlink_contact_property would refuse it. This migration moves their logic into two internal
--  functions with no caller check (not reachable from outside the database), keeps the checked ones
--  as thin wrappers for the screens, and has the bot functions use the internal ones.
--
-- How it is done
--  The bot functions are long, so this migration edits their saved text in place (each change
--  is a find and replace on a single line of the function, so line endings do not matter. Each
--  must match exactly once, or the migration stops with a message naming the piece it could not
--  find). Nothing is changed if any piece is missing.

-- The link and unlink logic from migration 169, without the "who is calling" check, so the bot
-- functions below can use it. A bot is not a signed in admin (it calls with a key), so the checked
-- crm_ functions would refuse it. These two are not callable from outside the database.
create or replace function _contact_property_link(p_contact_id uuid, p_property_id uuid)
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

create or replace function _contact_property_unlink(p_contact_id uuid, p_property_id uuid)
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
  select * into v_contact from contacts where id = p_contact_id;
  if not found then raise exception 'That person no longer exists.'; end if;

  if v_contact.property_id is not distinct from p_property_id then
    select property_name into v_removed_name from properties where id = p_property_id;
    select cp.property_id, p.property_name into v_next, v_next_name
    from contact_properties cp join properties p on p.id = cp.property_id
    where cp.contact_id = p_contact_id and cp.property_id <> p_property_id
    order by cp.created_at, cp.property_id
    limit 1;
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

-- The screens still go through the checked versions.
create or replace function crm_link_contact_property(p_contact_id uuid, p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (coalesce(is_admin(), false) or _is_trusted_context()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return _contact_property_link(p_contact_id, p_property_id);
end;
$$;

create or replace function crm_unlink_contact_property(p_contact_id uuid, p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (coalesce(is_admin(), false) or _is_trusted_context()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return _contact_property_unlink(p_contact_id, p_property_id);
end;
$$;

revoke all on function _contact_property_link(uuid, uuid) from public, anon, authenticated;
revoke all on function _contact_property_unlink(uuid, uuid) from public, anon, authenticated;
revoke all on function crm_link_contact_property(uuid, uuid) from public, anon;
grant execute on function crm_link_contact_property(uuid, uuid) to authenticated;
revoke all on function crm_unlink_contact_property(uuid, uuid) from public, anon;
grant execute on function crm_unlink_contact_property(uuid, uuid) to authenticated;

create or replace function _patch_fn(p_sig text, p_marker text, p_edits jsonb)
returns text
language plpgsql
as $$
declare
  v_def text;
  e jsonb;
  v_old text;
  v_new text;
  v_all boolean;
  v_count integer;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  if position(p_marker in v_def) > 0 then
    return p_sig || ': already updated';
  end if;
  for e in select * from jsonb_array_elements(p_edits) loop
    v_old := e ->> 'old';
    v_new := e ->> 'new';
    v_all := coalesce((e ->> 'all')::boolean, false);
    v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / greatest(length(v_old), 1);
    if v_count = 0 or (v_count > 1 and not v_all) then
      raise exception 'Migration 172 stopped: % has % copies of the piece starting "%". Nothing was changed.', p_sig, v_count, left(v_old, 70);
    end if;
    v_def := replace(v_def, v_old, v_new);
  end loop;
  execute v_def;
  return p_sig || ': updated';
end;
$$;

do $$
declare
  nl text := E'\n';
begin
  -- People list: the properties list, and the property_id filter finds any linked property.
  perform _patch_fn('bot_sales_people_list(text,jsonb)', 'cp.property_id = v_property', jsonb_build_array(
    jsonb_build_object(
      'old', 'and (v_property is null or c.property_id = v_property)',
      'new', 'and (v_property is null or c.property_id = v_property' || nl ||
             '           or exists (select 1 from contact_properties cp where cp.contact_id = c.id and cp.property_id = v_property))'),
    jsonb_build_object(
      'old', '''property'', (select jsonb_build_object(''id'', p.id, ''name'', p.property_name) from properties p where p.id = pg.property_id),',
      'new', '''property'', (select jsonb_build_object(''id'', p.id, ''name'', p.property_name) from properties p where p.id = pg.property_id),' || nl ||
             '      ''properties'', (select coalesce(jsonb_agg(jsonb_build_object(''id'', p.id, ''name'', p.property_name, ''main'', p.id = pg.property_id)' || nl ||
             '                                     order by (p.id = pg.property_id) desc, p.property_name), ''[]''::jsonb)' || nl ||
             '                     from contact_properties cp join properties p on p.id = cp.property_id where cp.contact_id = pg.id),')
  ));

  -- People update: property_id adds a link, plus main_property_id and unlink_property_id.
  perform _patch_fn('bot_sales_person_update(text,text,jsonb,text)', 'unlink_property_id', jsonb_build_array(
    jsonb_build_object(
      'old', '''company_id'', ''property_id'', ''shared_email'', ''notes'', ''add_note'']',
      'new', '''company_id'', ''property_id'', ''main_property_id'', ''unlink_property_id'', ''shared_email'', ''notes'', ''add_note'']'),
    jsonb_build_object(
      'old', '  v_cur_conf text;',
      'new', '  v_cur_conf text;' || nl ||
             '  v_link uuid;' || nl ||
             '  v_main uuid;' || nl ||
             '  v_unlink uuid;' || nl ||
             '  v_old_main uuid;' || nl ||
             '  v_pname text;' || nl ||
             '  v_res jsonb;'),
    jsonb_build_object(
      'old', '  -- An email that belongs to someone else would make two people one address.',
      'new', '  -- Property links (migration 172).' || nl ||
             '  begin' || nl ||
             '    v_main := _bot_uuid(b, ''main_property_id'');' || nl ||
             '    v_unlink := _bot_uuid(b, ''unlink_property_id'');' || nl ||
             '    if v_main is not null and not exists (select 1 from properties p where p.id = v_main and not p.is_test) then' || nl ||
             '      raise exception ''No property with that main_property_id.'' using errcode = ''BK422'';' || nl ||
             '    end if;' || nl ||
             '    if v_unlink is not null and not exists (select 1 from contact_properties cp where cp.contact_id = v_pid and cp.property_id = v_unlink) then' || nl ||
             '      raise exception ''That person is not linked to that unlink_property_id.'' using errcode = ''BK422'';' || nl ||
             '    end if;' || nl ||
             '  exception when sqlstate ''BK422'' then' || nl ||
             '    get stacked diagnostics v_msg = message_text;' || nl ||
             '    return _bot_reject(k, ''people.update'', 422, ''invalid_field'', v_msg);' || nl ||
             '  end;' || nl ||
             '  -- property_id adds a link and keeps the others. A person with no main property yet takes it as their main one.' || nl ||
             '  if fl ? ''property_id'' and fl -> ''property_id'' <> ''null''::jsonb' || nl ||
             '     and exists (select 1 from contacts c where c.id = v_pid and c.property_id is not null) then' || nl ||
             '    v_link := (fl ->> ''property_id'')::uuid;' || nl ||
             '    fl := fl - ''property_id'' - ''property'' - ''management_company'';' || nl ||
             '  end if;' || nl || nl ||
             '  -- An email that belongs to someone else would make two people one address.'),
    jsonb_build_object(
      'old', '  rep := _bot_fill(''contacts'', v_pid, fl, array[''email_confidence''], names);',
      'new', '  rep := _bot_fill(''contacts'', v_pid, fl, array[''email_confidence''], names);' || nl ||
             '  if v_main is not null then' || nl ||
             '    select c.property_id into v_old_main from contacts c where c.id = v_pid;' || nl ||
             '    if v_old_main is distinct from v_main then' || nl ||
             '      select p.property_name into v_pname from properties p where p.id = v_main;' || nl ||
             '      update contacts set property_id = v_main, property = v_pname where id = v_pid;' || nl ||
             '      if v_old_main is not null then' || nl ||
             '        insert into contact_properties (contact_id, property_id) values (v_pid, v_old_main) on conflict do nothing;' || nl ||
             '      end if;' || nl ||
             '      rep := jsonb_set(rep, ''{updated,main_property_id}'', jsonb_build_object(''before'', v_old_main, ''after'', v_main), true);' || nl ||
             '    end if;' || nl ||
             '  end if;' || nl ||
             '  if v_link is not null then' || nl ||
             '    v_res := _contact_property_link(v_pid, v_link);' || nl ||
             '    if not coalesce((v_res ->> ''already'')::boolean, false) then' || nl ||
             '      rep := jsonb_set(rep, ''{updated,property_link}'', jsonb_build_object(''before'', null, ''after'', v_link), true);' || nl ||
             '    end if;' || nl ||
             '  end if;' || nl ||
             '  if v_unlink is not null then' || nl ||
             '    perform _contact_property_unlink(v_pid, v_unlink);' || nl ||
             '    rep := jsonb_set(rep, ''{updated,unlink_property_id}'', jsonb_build_object(''before'', v_unlink, ''after'', null), true);' || nl ||
             '  end if;')
  ));

  -- Prospects list: a prospect's people and contact include everyone linked to it.
  perform _patch_fn('bot_sales_prospects_list(text,jsonb)', 'cp.property_id = p.id', jsonb_build_array(
    jsonb_build_object(
      'old', 'c.property_id = p.id',
      'new', '(c.property_id = p.id or exists (select 1 from contact_properties cp where cp.contact_id = c.id and cp.property_id = p.id))',
      'all', true),
    jsonb_build_object(
      'old', 'c.property_id = pg.id',
      'new', '(c.property_id = pg.id or exists (select 1 from contact_properties cp where cp.contact_id = c.id and cp.property_id = pg.id))',
      'all', true)
  ));

  -- Outreach log: a person can be logged against any property they are linked to.
  perform _patch_fn('bot_sales_outreach_log(text,jsonb,text)', 'cp.property_id = v_pid', jsonb_build_array(
    jsonb_build_object(
      'old', 'if v_pid is not null and v_prop_person is not null and v_prop_person <> v_pid then',
      'new', 'if v_pid is not null and v_prop_person is not null and v_prop_person <> v_pid' || nl ||
             '       and not exists (select 1 from contact_properties cp where cp.contact_id = v_person and cp.property_id = v_pid) then'),
    jsonb_build_object(
      'old', '      select c.property_id as pid from contacts c where lower(btrim(c.contact_email)) = v_email and c.property_id is not null and not c.is_test',
      'new', '      select c.property_id as pid from contacts c where lower(btrim(c.contact_email)) = v_email and c.property_id is not null and not c.is_test' || nl ||
             '      union' || nl ||
             '      select cp.property_id as pid from contact_properties cp join contacts c on c.id = cp.contact_id where lower(btrim(c.contact_email)) = v_email and not c.is_test'),
    jsonb_build_object(
      'old', '    where c.property_id = v_pid and lower(btrim(c.contact_email)) = v_email',
      'new', '    where (c.property_id = v_pid or exists (select 1 from contact_properties cp where cp.contact_id = c.id and cp.property_id = v_pid))' || nl ||
             '      and lower(btrim(c.contact_email)) = v_email')
  ));
end;
$$;

drop function _patch_fn(text, text, jsonb);

-- Notes
--  * Rollback: re-run migrations 167 (bot_sales_people_list, bot_sales_prospects_list,
--    bot_sales_outreach_log) and 168 (bot_sales_person_update) function definitions. Links already
--    made stay in contact_properties.
--  * A bot that relied on property_id to MOVE a person now needs main_property_id (move the main
--    link and keep the old one as an extra) or unlink_property_id (remove the old one).
