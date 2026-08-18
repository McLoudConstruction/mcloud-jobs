-- Run in Supabase SQL Editor after migration 014. Safe to re-run.

create table if not exists job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  update_id uuid references job_updates(id) on delete set null,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

alter table job_photos enable row level security;

drop policy if exists "Admin can do everything on job_photos" on job_photos;
create policy "Admin can do everything on job_photos"
  on job_photos for all using (is_admin()) with check (is_admin());

drop policy if exists "Customers can view photos on their own jobs" on job_photos;
create policy "Customers can view photos on their own jobs"
  on job_photos for select
  using (
    not is_admin()
    and exists (
      select 1 from jobs j
      where j.id = job_photos.job_id
      and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_photos'
  ) then
    alter publication supabase_realtime add table job_photos;
  end if;
end $$;

-- ─── Private storage bucket for the actual photo files ──────────────────
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

-- Files are stored as {job_id}/{filename} — these policies read the job_id
-- straight out of the folder path to decide who can see what.

drop policy if exists "Admin can do everything with job photo files" on storage.objects;
create policy "Admin can do everything with job photo files"
  on storage.objects for all
  using (bucket_id = 'job-photos' and is_admin())
  with check (bucket_id = 'job-photos' and is_admin());

drop policy if exists "Customers can view their own job photo files" on storage.objects;
create policy "Customers can view their own job photo files"
  on storage.objects for select
  using (
    bucket_id = 'job-photos'
    and not is_admin()
    and exists (
      select 1 from jobs j
      where j.id::text = (storage.foldername(name))[1]
      and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
    )
  );
