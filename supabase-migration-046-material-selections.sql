-- Run in Supabase SQL Editor after migration 045. Safe to re-run.

create table if not exists material_selections (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved')),
  sent_at timestamptz,
  approved_at timestamptz,
  selected_option_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists material_selection_options (
  id uuid primary key default gen_random_uuid(),
  selection_id uuid not null references material_selections(id) on delete cascade,
  brand text,
  item text not null,
  model_number text,
  color text,
  photo_storage_path text,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table material_selections enable row level security;
alter table material_selection_options enable row level security;

drop policy if exists "Admin full access to material_selections" on material_selections;
create policy "Admin full access to material_selections" on material_selections for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Admin full access to material_selection_options" on material_selection_options;
create policy "Admin full access to material_selection_options" on material_selection_options for all
  using (is_admin()) with check (is_admin());

-- Customers can view a selection (and its options) once it's actually
-- been sent, same "nothing speculative" rule the rest of the portal
-- follows — never before, never a draft.
drop policy if exists "Customer can view sent material_selections" on material_selections;
create policy "Customer can view sent material_selections" on material_selections for select
  using (has_job_portal_access(job_id) and sent_at is not null);

drop policy if exists "Customer can view material_selection_options" on material_selection_options;
create policy "Customer can view material_selection_options" on material_selection_options for select
  using (
    exists (
      select 1 from material_selections ms
      where ms.id = selection_id and has_job_portal_access(ms.job_id) and ms.sent_at is not null
    )
  );

-- Narrow, purpose-built approval function — same pattern as
-- accept_work_order, not a broad UPDATE grant on the table.
create or replace function approve_material_selection(target_selection_id uuid, chosen_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job_id uuid;
  option_belongs boolean;
begin
  select job_id into target_job_id from material_selections where id = target_selection_id and sent_at is not null;
  if target_job_id is null then
    raise exception 'Selection not found or not yet sent';
  end if;
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;

  select exists (
    select 1 from material_selection_options where id = chosen_option_id and selection_id = target_selection_id
  ) into option_belongs;
  if not option_belongs then
    raise exception 'That option does not belong to this selection';
  end if;

  update material_selections
  set selected_option_id = chosen_option_id, status = 'approved', approved_at = now()
  where id = target_selection_id;
end;
$$;

grant execute on function approve_material_selection(uuid, uuid) to authenticated;

-- Photos live in the existing private job-photos bucket, under
-- selections/{selection_id}/... — customer read access mirrors the
-- job-photos policy already in place, scoped to sent selections only.
drop policy if exists "Customer can view material selection photos" on storage.objects;
create policy "Customer can view material selection photos" on storage.objects for select
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = 'selections'
    and exists (
      select 1 from material_selections ms
      where ms.id::text = (storage.foldername(name))[2]
        and has_job_portal_access(ms.job_id)
        and ms.sent_at is not null
    )
  );
