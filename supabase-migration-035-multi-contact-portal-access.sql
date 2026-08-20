-- Run in Supabase SQL Editor after migration 034. Safe to re-run.
--
-- Until now, portal access was hardcoded to exactly one email per job
-- (jobs.customer_email or jobs.billing_email). This adds real multi-
-- contact support: any number of contacts can be granted portal access
-- and/or added to the notification list per job, independent of each
-- other. Backward compatible — jobs relying only on the old single-email
-- fields keep working exactly as before.

-- ═══════════════════════════════════════════════════════════════════════
-- Jobs can optionally link to a tracked Property, so "contacts tied to
-- this property" is a real, queryable relationship on the job page.
-- Optional — most residential jobs will never set this.
-- ═══════════════════════════════════════════════════════════════════════
alter table jobs add column if not exists property_id uuid references properties(id) on delete set null;

-- ═══════════════════════════════════════════════════════════════════════
-- Per-job portal access + notification list. portal_access and notify
-- are independent — someone can be on the email list without a login,
-- or have a login without being on the notification list.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists job_portal_access (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  email text not null,
  name text,
  portal_access boolean not null default true,
  notify boolean not null default true,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, email)
);

alter table job_portal_access enable row level security;
drop policy if exists "Admin full access to job_portal_access" on job_portal_access;
create policy "Admin full access to job_portal_access" on job_portal_access for all
  using (is_admin()) with check (is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- Single reusable access check — every customer-facing policy below uses
-- this instead of repeating the email-matching logic inline. Extending
-- who counts as "has access to this job" now only means changing this
-- one function, not hunting down every policy that inlined the old check.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function has_job_portal_access(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from jobs j
    where j.id = target_job_id
      and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
  )
  or exists (
    select 1 from job_portal_access jpa
    where jpa.job_id = target_job_id
      and jpa.email = auth.jwt()->>'email'
      and jpa.portal_access = true
  );
$$;

grant execute on function has_job_portal_access(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Rewire every existing customer-facing policy to the shared function.
-- ═══════════════════════════════════════════════════════════════════════

-- jobs
drop policy if exists "Customers can view their own jobs" on jobs;
create policy "Customers can view their own jobs" on jobs for select using (has_job_portal_access(id));

-- job_updates
drop policy if exists "Customers can view updates on their own jobs" on job_updates;
create policy "Customers can view updates on their own jobs" on job_updates for select using (
  has_job_portal_access(job_id) and sent_at is not null
);

-- job_questions
drop policy if exists "Customers can view questions on their own jobs" on job_questions;
create policy "Customers can view questions on their own jobs" on job_questions for select using (
  has_job_portal_access(job_id)
);
drop policy if exists "Customers can submit questions on their own jobs" on job_questions;
create policy "Customers can submit questions on their own jobs" on job_questions for insert with check (
  has_job_portal_access(job_id)
);

-- job_photos
drop policy if exists "Customers can view photos on their own jobs" on job_photos;
create policy "Customers can view photos on their own jobs" on job_photos for select using (
  has_job_portal_access(job_id)
);

-- job-photos storage bucket
drop policy if exists "Customers can view their own job photo files" on storage.objects;
create policy "Customers can view their own job photo files" on storage.objects for select using (
  bucket_id = 'job-photos'
  and not is_admin()
  and has_job_portal_access(((storage.foldername(name))[1])::uuid)
);

-- invoices (draws)
drop policy if exists "Customer can view own invoices" on invoices;
create policy "Customer can view own invoices" on invoices for select using (
  has_job_portal_access(job_id)
);

-- change_orders — customers view these via the branded document page,
-- which needs SELECT access; this was previously missing entirely.
drop policy if exists "Customers can view own change orders" on change_orders;
create policy "Customers can view own change orders" on change_orders for select using (
  has_job_portal_access(job_id) and sent_at is not null
);

-- notifications (customer-submitted, e.g. asking a question)
drop policy if exists "Customers can create notifications on their own jobs" on notifications;
create policy "Customers can create notifications on their own jobs" on notifications for insert with check (
  has_job_portal_access(job_id)
);

-- mark_portal_viewed — update to use the shared check too, so any
-- authorized contact (not just the original single email) can mark a
-- job's portal as viewed.
create or replace function mark_portal_viewed(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;
  update jobs set portal_last_viewed_at = now() where id = target_job_id;
end;
$$;
grant execute on function mark_portal_viewed(uuid) to authenticated;
