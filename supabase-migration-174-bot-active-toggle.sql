-- Migration 174: the bot can see and change whether a person is active.
--
-- Migration 170 added the Active / Inactive switch for people (contacts.is_active) but left the bot
-- API out. This adds it:
--   * People list: every person now has "active" (true or false) and "inactive_since", and the list
--     takes an "active" filter (active=false finds the inactive people, active=true hides them).
--   * People update: send {"active": false} to make someone inactive, {"active": true} to bring
--     them back. inactive_since is stamped by the database, as it is for the app.
--
-- Run after 170 and 172. Safe to run again: a function that already has the change is left alone.
-- The pieces below are matched one line at a time, so line endings in the saved function text do
-- not matter (the same method migration 172 uses).
--
-- Rollback: re-run migrations 167 and 168 for bot_sales_people_list and bot_sales_person_update,
-- then migration 172 for the property links. Nothing is stored by this migration.

create or replace function _patch_fn(p_sig text, p_marker text, p_edits jsonb)
returns text
language plpgsql
as $$
declare
  v_def text;
  e jsonb;
  v_old text;
  v_new text;
  v_count integer;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  if position(p_marker in v_def) > 0 then
    return p_sig || ': already updated';
  end if;
  for e in select * from jsonb_array_elements(p_edits) loop
    v_old := e ->> 'old';
    v_new := e ->> 'new';
    v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / greatest(length(v_old), 1);
    if v_count <> 1 then
      raise exception 'Migration 174 stopped: % has % copies of the piece starting "%". Nothing was changed.', p_sig, v_count, left(v_old, 70);
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
  if not exists (select 1 from information_schema.columns where table_name = 'contacts' and column_name = 'is_active') then
    raise exception 'Migration 174 needs migration 170 first (contacts.is_active is missing).';
  end if;

  -- People list: the active filter, plus active and inactive_since on every person.
  perform _patch_fn('bot_sales_people_list(text,jsonb)', 'v_active', jsonb_build_array(
    jsonb_build_object(
      'old', '''can_email'', ''contacted'', ''created_since'', ''limit'', ''cursor''];',
      'new', '''can_email'', ''contacted'', ''active'', ''created_since'', ''limit'', ''cursor''];'),
    jsonb_build_object(
      'old', '  v_contacted boolean;',
      'new', '  v_contacted boolean;' || nl || '  v_active boolean;'),
    jsonb_build_object(
      'old', '  if f ? ''contacted'' then',
      'new', '  if f ? ''active'' then' || nl ||
             '    v_active := _bot_bool(f ->> ''active'');' || nl ||
             '    if v_active is null then return _bot_reject(k, ''people.list'', 422, ''invalid_filter'', ''active must be true or false.''); end if;' || nl ||
             '  end if;' || nl ||
             '  if f ? ''contacted'' then'),
    jsonb_build_object(
      'old', '      and (v_contacted is null or exists',
      'new', '      and (v_active is null or c.is_active = v_active)' || nl ||
             '      and (v_contacted is null or exists'),
    jsonb_build_object(
      'old', '      ''can_email'', (pg.blocked is null),',
      'new', '      ''active'', pg.is_active,' || nl ||
             '      ''inactive_since'', pg.inactive_since,' || nl ||
             '      ''can_email'', (pg.blocked is null),')
  ));

  -- People update: active true or false.
  perform _patch_fn('bot_sales_person_update(text,text,jsonb,text)', 'v_active', jsonb_build_array(
    jsonb_build_object(
      'old', '''shared_email'', ''notes'', ''add_note''];',
      'new', '''shared_email'', ''active'', ''notes'', ''add_note''];'),
    jsonb_build_object(
      'old', '  v_cur_conf text;',
      'new', '  v_cur_conf text;' || nl || '  v_active boolean;' || nl || '  v_old_active boolean;'),
    jsonb_build_object(
      'old', '    if b ? ''shared_email'' then',
      'new', '    if b ? ''active'' then' || nl ||
             '      if jsonb_typeof(b -> ''active'') <> ''boolean'' then' || nl ||
             '        raise exception ''active must be true or false.'' using errcode = ''BK422'';' || nl ||
             '      end if;' || nl ||
             '      v_active := (b ->> ''active'')::boolean;' || nl ||
             '    end if;' || nl ||
             '    if b ? ''shared_email'' then'),
    jsonb_build_object(
      'old', '  v_status := case when rep -> ''updated'' = ''{}''::jsonb then ''unchanged'' else ''updated'' end;',
      'new', '  if v_active is not null then' || nl ||
             '    select c.is_active into v_old_active from contacts c where c.id = v_pid;' || nl ||
             '    if v_old_active is distinct from v_active then' || nl ||
             '      update contacts set is_active = v_active where id = v_pid;' || nl ||
             '      rep := jsonb_set(rep, ''{updated,active}'', jsonb_build_object(''before'', v_old_active, ''after'', v_active), true);' || nl ||
             '    end if;' || nl ||
             '  end if;' || nl ||
             '  v_status := case when rep -> ''updated'' = ''{}''::jsonb then ''unchanged'' else ''updated'' end;')
  ));
end;
$$;

drop function _patch_fn(text, text, jsonb);
