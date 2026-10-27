-- Run in Supabase SQL Editor after migration 174. Safe to re-run.
--
-- Photos round: real folders, an Initial Inspection folder on every new
-- opportunity, thumbnails, and a file name prefix setting.
--
-- job_photos.folder stays as the plain text name, so share links, the RFP
-- picker, the customer portal feed and mirrored sub photos all keep working.
-- This table only adds what a text column cannot: folders that exist before
-- they have a photo (Initial Inspection), system folders, and a safe way to
-- rename or remove a folder.
--
-- Rollback notes are at the bottom.

create table if not exists job_photo_folders (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  name text not null,
  kind text not null default 'named' check (kind in ('day', 'named', 'system')),
  day date,
  created_at timestamptz not null default now(),
  created_by_email text
);

create unique index if not exists job_photo_folders_job_name_key
  on job_photo_folders (job_id, lower(name));

alter table job_photo_folders enable row level security;

drop policy if exists "Admin can do everything on job_photo_folders" on job_photo_folders;
create policy "Admin can do everything on job_photo_folders"
  on job_photo_folders for all using (is_admin()) with check (is_admin());

-- Small preview stored next to each new photo so the grid does not load the
-- full size file for every tile.
alter table job_photos add column if not exists thumb_path text;

-- Prefix for downloaded file names and the watermark text fallback
-- (example: McLoud gives McLoud-MC26012-2026-10-27-091422.jpg).
alter table app_settings add column if not exists photo_file_prefix text;
update app_settings set photo_file_prefix = 'McLoud' where id = 1 and photo_file_prefix is null;

-- ─── Create a folder if it is not there yet (idempotent) ────────────────
-- Called by the uploader, so two phones shooting at once cannot create a
-- duplicate. Returns the folder id.
create or replace function ensure_job_photo_folder(
  job_id_in uuid,
  name_in text,
  kind_in text default 'named',
  day_in date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(name_in, ''));
  k text := coalesce(kind_in, 'named');
  fid uuid;
begin
  if not is_admin() then raise exception 'Not authorized.'; end if;
  if nm = '' then raise exception 'Folder name is required.'; end if;
  if k not in ('day', 'named', 'system') then k := 'named'; end if;

  insert into job_photo_folders (job_id, name, kind, day, created_by_email)
  values (job_id_in, nm, k, day_in, auth.jwt()->>'email')
  on conflict (job_id, lower(name)) do nothing;

  select id into fid from job_photo_folders where job_id = job_id_in and lower(name) = lower(nm);
  return fid;
end;
$$;

grant execute on function ensure_job_photo_folder(uuid, text, text, date) to authenticated;

-- ─── Rename a named folder, moving its photos with it ───────────────────
create or replace function rename_job_photo_folder(job_id_in uuid, old_name text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(new_name, ''));
  existing record;
begin
  if not is_admin() then raise exception 'Not authorized.'; end if;
  if nm = '' then raise exception 'Folder name is required.'; end if;

  select * into existing from job_photo_folders where job_id = job_id_in and lower(name) = lower(old_name);
  if existing.id is not null and existing.kind <> 'named' then
    raise exception 'That folder cannot be renamed.';
  end if;
  if exists (select 1 from job_photo_folders where job_id = job_id_in and lower(name) = lower(nm) and lower(nm) <> lower(old_name)) then
    raise exception 'A folder with that name already exists.';
  end if;

  update job_photos set folder = nm where job_id = job_id_in and folder = old_name;
  if existing.id is not null then
    update job_photo_folders set name = nm where id = existing.id;
  else
    insert into job_photo_folders (job_id, name, kind, created_by_email)
    values (job_id_in, nm, 'named', auth.jwt()->>'email')
    on conflict (job_id, lower(name)) do nothing;
  end if;
end;
$$;

grant execute on function rename_job_photo_folder(uuid, text, text) to authenticated;

-- ─── Delete a named folder, only when it is empty ───────────────────────
create or replace function delete_empty_job_photo_folder(job_id_in uuid, name_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing record;
begin
  if not is_admin() then raise exception 'Not authorized.'; end if;
  if exists (select 1 from job_photos where job_id = job_id_in and folder = name_in) then
    raise exception 'That folder still has photos in it.';
  end if;
  select * into existing from job_photo_folders where job_id = job_id_in and lower(name) = lower(name_in);
  if existing.id is null then return; end if;
  if existing.kind <> 'named' then raise exception 'That folder cannot be deleted.'; end if;
  delete from job_photo_folders where id = existing.id;
end;
$$;

grant execute on function delete_empty_job_photo_folder(uuid, text) to authenticated;

-- ─── Every new opportunity gets an Initial Inspection folder ────────────
-- An opportunity is a job row at stage 'new', so one trigger on jobs covers
-- every way a job can be created (new job form, converted lead, API).
create or replace function create_initial_inspection_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage = 'new' then
    insert into job_photo_folders (job_id, name, kind)
    values (new.id, 'Initial Inspection', 'system')
    on conflict (job_id, lower(name)) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_initial_inspection_folder on jobs;
create trigger jobs_initial_inspection_folder
  after insert on jobs
  for each row execute function create_initial_inspection_folder();

-- ─── Backfill ───────────────────────────────────────────────────────────
-- One folder row for every folder name already used on a job's photos.
insert into job_photo_folders (job_id, name, kind)
select distinct on (job_id, lower(btrim(folder)))
  job_id,
  btrim(folder),
  case when btrim(folder) ~ '^\d{4}-\d{2}-\d{2}$' then 'day' else 'named' end
from job_photos
where folder is not null and btrim(folder) <> ''
order by job_id, lower(btrim(folder)), created_at
on conflict (job_id, lower(name)) do nothing;

-- Initial Inspection for jobs still in a Sell stage.
insert into job_photo_folders (job_id, name, kind)
select id, 'Initial Inspection', 'system'
from jobs
where stage in ('new', 'inspected', 'proposal_delivered')
on conflict (job_id, lower(name)) do nothing;

-- A job that already had photos filed under that exact name keeps them, and
-- the folder becomes the system one.
update job_photo_folders set kind = 'system'
where lower(name) = 'initial inspection' and kind <> 'system';

-- ─── Notes ──────────────────────────────────────────────────────────────
-- Rollback: nothing outside this migration depends on it. The app falls back
-- to folder names found on the photos themselves, and skips thumbnails, if
-- these objects are missing.
--   drop trigger if exists jobs_initial_inspection_folder on jobs;
--   drop function if exists create_initial_inspection_folder();
--   drop function if exists ensure_job_photo_folder(uuid, text, text, date);
--   drop function if exists rename_job_photo_folder(uuid, text, text);
--   drop function if exists delete_empty_job_photo_folder(uuid, text);
--   drop table if exists job_photo_folders;
--   alter table job_photos drop column if exists thumb_path;
--   alter table app_settings drop column if exists photo_file_prefix;
