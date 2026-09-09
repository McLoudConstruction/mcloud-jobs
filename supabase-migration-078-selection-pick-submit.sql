-- Run in Supabase SQL Editor after migration 077. Safe to re-run.
--
-- Splits material selection approval into two steps: the customer can
-- pick (and change) an option on each individual sheet freely, and a
-- separate "submit all" action finalizes every sheet for the job at
-- once, only once every sent sheet has a pick. Jobs often have several
-- selection sheets (faucet, vanity, fan, ...), so customers should be
-- able to review everything before anything locks in, rather than each
-- sheet finalizing the instant they click it.
--
-- Supersedes approve_material_selection for the customer-facing flow —
-- left in place rather than dropped, in case anything else references
-- it, but the app no longer calls it.

-- Records a tentative pick without finalizing it — status stays 'sent'
-- so the customer can still change their mind or pick on other sheets
-- before the final submit.
create or replace function pick_material_selection_option(target_selection_id uuid, chosen_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job_id uuid;
  current_status text;
  option_belongs boolean;
begin
  select job_id, status into target_job_id, current_status
  from material_selections
  where id = target_selection_id and sent_at is not null;

  if target_job_id is null then
    raise exception 'Selection not found or not yet sent';
  end if;
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;
  if current_status = 'approved' then
    raise exception 'This selection has already been submitted and can no longer be changed';
  end if;

  select exists (
    select 1 from material_selection_options where id = chosen_option_id and selection_id = target_selection_id
  ) into option_belongs;
  if not option_belongs then
    raise exception 'That option does not belong to this selection';
  end if;

  update material_selections
  set selected_option_id = chosen_option_id
  where id = target_selection_id;
end;
$$;

grant execute on function pick_material_selection_option(uuid, uuid) to authenticated;

-- Finalizes every sent sheet for the job that already has a pick.
-- Refuses to run if any sent sheet is still missing a pick, so partial
-- submission isn't possible even via a direct RPC call bypassing the
-- UI's own gate.
create or replace function submit_material_selections(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  incomplete_count int;
begin
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;

  select count(*) into incomplete_count
  from material_selections
  where job_id = target_job_id and sent_at is not null and status = 'sent' and selected_option_id is null;

  if incomplete_count > 0 then
    raise exception 'All material selections must be picked before submitting';
  end if;

  update material_selections
  set status = 'approved', approved_at = now()
  where job_id = target_job_id and sent_at is not null and status = 'sent' and selected_option_id is not null;
end;
$$;

grant execute on function submit_material_selections(uuid) to authenticated;

-- Root cause of "nothing updates after choosing/submitting" reported
-- separately: these tables were never added to the realtime
-- publication, so the page's postgres_changes subscription silently
-- never fires. Same gotcha as job_portal_access and sub_portal_users
-- earlier in this project.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'material_selections'
  ) then
    alter publication supabase_realtime add table material_selections;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'material_selection_options'
  ) then
    alter publication supabase_realtime add table material_selection_options;
  end if;
end $$;

