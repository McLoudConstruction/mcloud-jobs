-- Migration 137 — Punch list & warranty tracking
--
-- Closeout in one place:
--
--   • punch_items — one table for both kinds of "something still needs
--     fixing": a punch item found at the end of a job (kind 'punch') and a
--     claim the customer raises after we've left (kind 'warranty'). Items can
--     be assigned to a subcontractor, who updates them from the Sub Portal.
--     Punch items are internal unless staff tick "share with customer";
--     warranty claims are always visible to the customer who raised them.
--
--   • warranties — one row per job, created automatically the moment a job
--     is marked Completed (period length is a setting, default 12 months,
--     editable per job). A customer can only file a claim while it's active.
--
--   • jobs.completed_at — stamped when a job first reaches Completed. New
--     jobs only: existing completed jobs are NOT backfilled, so switching this
--     on never fires off warranties or follow-ups for old customers.
--
-- Customers and subs never write these tables directly. They go through the
-- security-definer functions at the bottom, which check who they are and what
-- they're allowed to touch. Photos live in a private 'punch-photos' bucket,
-- stored as {job_id}/{item_id}/{file}.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Settings & job completion stamp
-- ═══════════════════════════════════════════════════════════════════════
alter table app_settings add column if not exists warranty_default_months integer not null default 12;
alter table app_settings add column if not exists warranty_auto_create boolean not null default true;
alter table jobs add column if not exists completed_at timestamptz;
alter table app_settings add column if not exists timezone text;  -- already exists from migration 112; harmless here

-- 'Today' in the business's own timezone (a claim filed at 9pm Central should
-- not count as tomorrow just because the server clock is UTC).
create or replace function _app_today()
returns date
language sql
stable
as $$
  select (now() at time zone coalesce((select nullif(timezone, '') from app_settings where id = 1), 'America/Chicago'))::date;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Warranties
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists warranties (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  start_date date not null default current_date,
  end_date date not null,
  months integer not null default 12,
  status text not null default 'active' check (status in ('active', 'void')),
  notes text,
  created_at timestamptz not null default now(),
  constraint warranties_dates check (end_date >= start_date)
);

alter table warranties enable row level security;
drop policy if exists "Admin can do everything on warranties" on warranties;
create policy "Admin can do everything on warranties" on warranties for all using (is_admin()) with check (is_admin());
drop policy if exists "Customers can view their own warranty" on warranties;
create policy "Customers can view their own warranty" on warranties for select using (has_job_portal_access(job_id));

-- Completed stamp + automatic warranty. Only fires on a real transition, and
-- only sets completed_at if it's empty, so re-saving a completed job is inert.
create or replace function trg_jobs_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s app_settings%rowtype;
  done_stages text[] := array['completed', 'invoiced', 'paid'];
begin
  if NEW.stage = any (done_stages) and not (OLD.stage = any (done_stages)) then
    if NEW.completed_at is null then
      NEW.completed_at := now();
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_jobs_completed on jobs;
create trigger trg_jobs_completed
  before update of stage on jobs
  for each row execute function trg_jobs_completed();

create or replace function trg_jobs_create_warranty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s app_settings%rowtype;
  start_d date;
begin
  if NEW.completed_at is not null and OLD.completed_at is null then
    select * into s from app_settings where id = 1;
    if coalesce(s.warranty_auto_create, true) and coalesce(s.warranty_default_months, 12) > 0 then
      start_d := (NEW.completed_at at time zone coalesce(nullif(s.timezone, ''), 'America/Chicago'))::date;
      insert into warranties (job_id, start_date, end_date, months)
      values (NEW.id, start_d, (start_d + make_interval(months => s.warranty_default_months))::date, s.warranty_default_months)
      on conflict (job_id) do nothing;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_jobs_create_warranty on jobs;
create trigger trg_jobs_create_warranty
  after update of stage on jobs
  for each row execute function trg_jobs_create_warranty();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Punch items / warranty claims
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists punch_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  kind text not null default 'punch' check (kind in ('punch', 'warranty')),
  title text not null check (length(btrim(title)) > 0),
  description text,
  location text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'verified', 'declined')),
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  assigned_company_id uuid references companies(id) on delete set null,
  due_date date,
  customer_visible boolean not null default false,
  reported_by_kind text not null default 'staff' check (reported_by_kind in ('staff', 'customer', 'sub')),
  reported_by_email text,
  resolution_note text,
  declined_reason text,
  resolved_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists punch_items_job_idx on punch_items (job_id, status);
create index if not exists punch_items_company_idx on punch_items (assigned_company_id) where assigned_company_id is not null;

create table if not exists punch_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references punch_items(id) on delete cascade,
  storage_path text not null,
  caption text,
  added_by_kind text not null default 'staff' check (added_by_kind in ('staff', 'customer', 'sub')),
  added_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists punch_photos_item_idx on punch_photos (item_id);

create or replace function trg_punch_items_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.kind = 'warranty' then NEW.customer_visible := true; end if;
    NEW.reported_by_email := coalesce(NEW.reported_by_email, auth.jwt() ->> 'email');
    if NEW.status in ('resolved', 'verified') then NEW.resolved_at := coalesce(NEW.resolved_at, now()); end if;
    if NEW.status = 'verified' then NEW.verified_at := coalesce(NEW.verified_at, now()); end if;
    return NEW;
  end if;

  NEW.updated_at := now();
  if NEW.job_id is distinct from OLD.job_id or NEW.kind is distinct from OLD.kind then
    raise exception 'A punch item cannot be moved to another job or changed between punch and warranty';
  end if;
  if NEW.kind = 'warranty' then NEW.customer_visible := true; end if;

  if NEW.status is distinct from OLD.status then
    if NEW.status = 'declined' and nullif(btrim(coalesce(NEW.declined_reason, '')), '') is null then
      raise exception 'Give a reason when declining a claim — the customer will see it';
    end if;
    if NEW.status in ('open', 'in_progress') then
      NEW.resolved_at := null;
      NEW.verified_at := null;
    elsif NEW.status = 'resolved' then
      NEW.resolved_at := coalesce(NEW.resolved_at, now());
      NEW.verified_at := null;
    elsif NEW.status = 'verified' then
      NEW.resolved_at := coalesce(NEW.resolved_at, now());
      NEW.verified_at := coalesce(NEW.verified_at, now());
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_punch_items_before on punch_items;
create trigger trg_punch_items_before
  before insert or update on punch_items
  for each row execute function trg_punch_items_before();

-- Outbound notifications: the assigned sub hears about a new assignment; the
-- customer hears when a visible item moves along (not for their own
-- confirmation, which they just did).
create or replace function trg_punch_items_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jnum text;
  addr text;
  status_text text;
begin
  select coalesce(job_number, estimate_number), project_address into jnum, addr from jobs where id = NEW.job_id;

  if NEW.assigned_company_id is not null
     and (TG_OP = 'INSERT' or NEW.assigned_company_id is distinct from OLD.assigned_company_id)
     and NEW.status not in ('verified', 'declined') then
    insert into portal_notifications (recipient_kind, company_id, job_id, category, message, link_path, source_id)
    values ('subcontractor', NEW.assigned_company_id, NEW.job_id, 'punch_assigned',
      'A ' || case when NEW.kind = 'warranty' then 'warranty repair' else 'punch list item' end || ' was assigned to you'
        || coalesce(' on job #' || jnum, '') || coalesce(' (' || addr || ')', '') || ': ' || left(NEW.title, 120)
        || case when NEW.due_date is not null then ' — due ' || to_char(NEW.due_date, 'FMMon FMDD') else '' end || '.',
      '/sub-portal/punch', NEW.id);
  end if;

  if TG_OP = 'UPDATE' and NEW.customer_visible and NEW.status is distinct from OLD.status
     and NEW.status in ('in_progress', 'resolved', 'declined') then
    status_text := case NEW.status
      when 'in_progress' then 'is being worked on'
      when 'resolved' then 'has been marked complete — please let us know if it looks right to you'
      else 'could not be accepted: ' || coalesce(NEW.declined_reason, 'see your portal for details') end;
    insert into portal_notifications (recipient_kind, job_id, category, message, link_path, source_id)
    values ('customer', NEW.job_id, case when NEW.kind = 'warranty' then 'warranty_update' else 'punch_update' end,
      'Update on "' || left(NEW.title, 100) || '": it ' || status_text || '.', '/customerportal/warranty', NEW.id);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_punch_items_after on punch_items;
create trigger trg_punch_items_after
  after insert or update on punch_items
  for each row execute function trg_punch_items_after();

alter table punch_items enable row level security;
alter table punch_photos enable row level security;

drop policy if exists "Admin can do everything on punch_items" on punch_items;
create policy "Admin can do everything on punch_items" on punch_items for all using (is_admin()) with check (is_admin());
drop policy if exists "Customers can view shared punch items" on punch_items;
create policy "Customers can view shared punch items" on punch_items for select using (customer_visible and has_job_portal_access(job_id));
drop policy if exists "Subs can view items assigned to them" on punch_items;
create policy "Subs can view items assigned to them" on punch_items for select using (assigned_company_id is not null and is_sub_portal_member(assigned_company_id));

drop policy if exists "Admin can do everything on punch_photos" on punch_photos;
create policy "Admin can do everything on punch_photos" on punch_photos for all using (is_admin()) with check (is_admin());
drop policy if exists "Customers can view photos on shared items" on punch_photos;
create policy "Customers can view photos on shared items" on punch_photos for select using (
  exists (select 1 from punch_items i where i.id = item_id and i.customer_visible and has_job_portal_access(i.job_id))
);
drop policy if exists "Subs can view photos on their items" on punch_photos;
create policy "Subs can view photos on their items" on punch_photos for select using (
  exists (select 1 from punch_items i where i.id = item_id and i.assigned_company_id is not null and is_sub_portal_member(i.assigned_company_id))
);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Photo storage
-- ═══════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public) values ('punch-photos', 'punch-photos', false) on conflict (id) do nothing;

-- Safe path parsing: never throws on a malformed name.
create or replace function _punch_path_uuid(name text, part integer)
returns uuid
language sql
immutable
as $$
  select case when split_part(name, '/', part) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(name, '/', part)::uuid else null end;
$$;

drop policy if exists "Admin can do everything with punch photo files" on storage.objects;
create policy "Admin can do everything with punch photo files" on storage.objects for all
  using (bucket_id = 'punch-photos' and is_admin()) with check (bucket_id = 'punch-photos' and is_admin());

-- A customer can add/see files under a job they belong to; a sub under an
-- item assigned to their company.
drop policy if exists "Customers can read punch photo files" on storage.objects;
create policy "Customers can read punch photo files" on storage.objects for select
  using (bucket_id = 'punch-photos' and _punch_path_uuid(name, 1) is not null and has_job_portal_access(_punch_path_uuid(name, 1)));
drop policy if exists "Customers can upload punch photo files" on storage.objects;
create policy "Customers can upload punch photo files" on storage.objects for insert
  with check (bucket_id = 'punch-photos' and _punch_path_uuid(name, 1) is not null and _punch_path_uuid(name, 2) is not null and has_job_portal_access(_punch_path_uuid(name, 1)));

drop policy if exists "Subs can read punch photo files" on storage.objects;
create policy "Subs can read punch photo files" on storage.objects for select
  using (bucket_id = 'punch-photos' and exists (
    select 1 from punch_items i where i.id = _punch_path_uuid(name, 2) and i.assigned_company_id is not null and is_sub_portal_member(i.assigned_company_id)));
drop policy if exists "Subs can upload punch photo files" on storage.objects;
create policy "Subs can upload punch photo files" on storage.objects for insert
  with check (bucket_id = 'punch-photos' and exists (
    select 1 from punch_items i where i.id = _punch_path_uuid(name, 2) and i.assigned_company_id is not null and is_sub_portal_member(i.assigned_company_id)));

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Customer / sub functions
-- ═══════════════════════════════════════════════════════════════════════

-- Customer files a warranty claim.
create or replace function submit_warranty_claim(target_job_id uuid, title_in text, description_in text, location_in text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  w warranties%rowtype;
  new_id uuid;
  jnum text;
  open_count integer;
begin
  if not coalesce(has_job_portal_access(target_job_id), false) then
    raise exception 'Not authorized';
  end if;
  if nullif(btrim(coalesce(title_in, '')), '') is null then
    raise exception 'Please describe the problem in a few words';
  end if;
  select * into w from warranties where job_id = target_job_id;
  if w.id is null or w.status <> 'active' then
    raise exception 'There is no active warranty on this project. Please call or message us and we will help.';
  end if;
  if _app_today() > w.end_date then
    raise exception 'The warranty period for this project ended on %. Please message us and we will see what we can do.', to_char(w.end_date, 'FMMonth FMDD, YYYY');
  end if;
  select count(*) into open_count from punch_items where job_id = target_job_id and kind = 'warranty' and status in ('open', 'in_progress');
  if open_count >= 15 then
    raise exception 'You already have several open claims — we are working through them. Please message us for anything urgent.';
  end if;

  insert into punch_items (job_id, kind, title, description, location, reported_by_kind, reported_by_email, customer_visible)
  values (target_job_id, 'warranty', left(btrim(title_in), 200), nullif(btrim(coalesce(description_in, '')), ''), nullif(btrim(coalesce(location_in, '')), ''),
          'customer', auth.jwt() ->> 'email', true)
  returning id into new_id;

  select coalesce(job_number, estimate_number) into jnum from jobs where id = target_job_id;
  insert into notifications (message, job_id)
  values ('Warranty claim' || coalesce(' on job #' || jnum, '') || ': ' || left(btrim(title_in), 140), target_job_id);
  return new_id;
end;
$$;
grant execute on function submit_warranty_claim(uuid, text, text, text) to authenticated;

-- Customer says a resolved item is fine (verified) or still not right (reopened).
create or replace function respond_punch_resolution(target_item_id uuid, accepted boolean, note_in text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i punch_items%rowtype;
  jnum text;
begin
  select * into i from punch_items where id = target_item_id;
  if i.id is null or not i.customer_visible or not coalesce(has_job_portal_access(i.job_id), false) then
    raise exception 'Not authorized';
  end if;
  if i.status <> 'resolved' then
    raise exception 'This item is not waiting on your confirmation';
  end if;
  select coalesce(job_number, estimate_number) into jnum from jobs where id = i.job_id;
  if accepted then
    update punch_items set status = 'verified' where id = i.id;
    insert into notifications (message, job_id) values ('Customer confirmed a fix' || coalesce(' on job #' || jnum, '') || ': ' || left(i.title, 120), i.job_id);
  else
    if nullif(btrim(coalesce(note_in, '')), '') is null then
      raise exception 'Tell us what is still wrong';
    end if;
    update punch_items set status = 'open', resolution_note = null,
      description = coalesce(description || E'\n\n', '') || 'Customer follow-up: ' || btrim(note_in)
    where id = i.id;
    insert into notifications (message, job_id) values ('Customer says a fix is not right' || coalesce(' on job #' || jnum, '') || ': ' || left(btrim(note_in), 140), i.job_id);
  end if;
end;
$$;
grant execute on function respond_punch_resolution(uuid, boolean, text) to authenticated;

-- Sub updates an item assigned to their company.
create or replace function sub_update_punch_item(target_item_id uuid, status_in text, note_in text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i punch_items%rowtype;
  cname text;
  jnum text;
begin
  select * into i from punch_items where id = target_item_id;
  if i.id is null or i.assigned_company_id is null or not coalesce(is_sub_portal_member(i.assigned_company_id), false) then
    raise exception 'Not authorized';
  end if;
  if status_in not in ('in_progress', 'resolved') then
    raise exception 'You can mark an item in progress or done';
  end if;
  if i.status in ('verified', 'declined') then
    raise exception 'This item is already closed';
  end if;
  if status_in = 'resolved' and nullif(btrim(coalesce(note_in, '')), '') is null then
    raise exception 'Add a short note on what you did';
  end if;

  update punch_items set status = status_in,
    resolution_note = coalesce(nullif(btrim(coalesce(note_in, '')), ''), resolution_note)
  where id = i.id;

  select company_name into cname from companies where id = i.assigned_company_id;
  select coalesce(job_number, estimate_number) into jnum from jobs where id = i.job_id;
  insert into notifications (message, job_id)
  values (coalesce(cname, 'A sub') || case when status_in = 'resolved' then ' finished' else ' started' end
    || ' a ' || case when i.kind = 'warranty' then 'warranty repair' else 'punch item' end || coalesce(' on job #' || jnum, '') || ': ' || left(i.title, 120), i.job_id);
end;
$$;
grant execute on function sub_update_punch_item(uuid, text, text) to authenticated;

-- Register an uploaded photo. The file must already be in the bucket under
-- {job_id}/{item_id}/…, and the caller must be allowed to touch that item.
create or replace function add_punch_photo(target_item_id uuid, path_in text, caption_in text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  i punch_items%rowtype;
  who text;
  new_id uuid;
begin
  select * into i from punch_items where id = target_item_id;
  if i.id is null then raise exception 'Not found'; end if;
  if split_part(path_in, '/', 1) <> i.job_id::text or split_part(path_in, '/', 2) <> i.id::text then
    raise exception 'That file is not stored under this item';
  end if;
  if coalesce(is_admin(), false) then
    who := 'staff';
  elsif i.customer_visible and coalesce(has_job_portal_access(i.job_id), false) then
    who := 'customer';
  elsif i.assigned_company_id is not null and coalesce(is_sub_portal_member(i.assigned_company_id), false) then
    who := 'sub';
  else
    raise exception 'Not authorized';
  end if;
  if (select count(*) from punch_photos where item_id = i.id) >= 20 then
    raise exception 'That item already has the maximum number of photos';
  end if;
  insert into punch_photos (item_id, storage_path, caption, added_by_kind, added_by_email)
  values (i.id, path_in, nullif(btrim(coalesce(caption_in, '')), ''), who, auth.jwt() ->> 'email')
  returning id into new_id;
  return new_id;
end;
$$;
grant execute on function add_punch_photo(uuid, text, text) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['punch_items', 'punch_photos', 'warranties'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
