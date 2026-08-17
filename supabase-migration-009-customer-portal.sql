-- Run in Supabase SQL Editor after migration 008.
-- ⚠️ This migration changes who can see what. Read the notes at the bottom
-- before running, especially the part about signing back in afterward.

-- ─── Helper: is the current logged-in user the admin (you)? ────────────
create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- ─── Lock every existing "any authenticated user" policy to admin-only ──
-- (Previously, ANY logged-in user — including a customer who signs in via
-- magic link — could read/write everything. That's fixed here.)

drop policy if exists "Authenticated can do everything on jobs" on jobs;
create policy "Admin can do everything on jobs"
  on jobs for all using (is_admin()) with check (is_admin());

drop policy if exists "Authenticated can do everything on job_updates" on job_updates;
create policy "Admin can do everything on job_updates"
  on job_updates for all using (is_admin()) with check (is_admin());

drop policy if exists "Authenticated can do everything on contacts" on contacts;
create policy "Admin can do everything on contacts"
  on contacts for all using (is_admin()) with check (is_admin());

drop policy if exists "Authenticated can do everything on change_orders" on change_orders;
create policy "Admin can do everything on change_orders"
  on change_orders for all using (is_admin()) with check (is_admin());

drop policy if exists "Authenticated can do everything on properties" on properties;
create policy "Admin can do everything on properties"
  on properties for all using (is_admin()) with check (is_admin());

drop policy if exists "Authenticated can do everything on opportunities" on opportunities;
create policy "Admin can do everything on opportunities"
  on opportunities for all using (is_admin()) with check (is_admin());

drop policy if exists "Authenticated can read settings" on app_settings;
drop policy if exists "Authenticated can update settings" on app_settings;
create policy "Admin can read settings" on app_settings for select using (is_admin());
create policy "Admin can update settings" on app_settings for update using (is_admin()) with check (is_admin());

drop policy if exists "Authenticated can upload branding assets" on storage.objects;
drop policy if exists "Authenticated can update branding assets" on storage.objects;
drop policy if exists "Authenticated can delete branding assets" on storage.objects;
create policy "Admin can upload branding assets" on storage.objects for insert with check (bucket_id = 'branding' and is_admin());
create policy "Admin can update branding assets" on storage.objects for update using (bucket_id = 'branding' and is_admin());
create policy "Admin can delete branding assets" on storage.objects for delete using (bucket_id = 'branding' and is_admin());
-- (Public read of the logo stays public — no change needed there.)

-- ─── Customer-facing read access: only their own job(s) ────────────────
create policy "Customers can view their own jobs"
  on jobs for select
  using (
    not is_admin()
    and (customer_email = auth.jwt()->>'email' or billing_email = auth.jwt()->>'email')
  );

create policy "Customers can view updates on their own jobs"
  on job_updates for select
  using (
    not is_admin()
    and exists (
      select 1 from jobs j
      where j.id = job_updates.job_id
      and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
    )
  );

-- ─── Job field: track when a customer was invited to the portal ────────
alter table jobs add column if not exists portal_invited_at timestamptz;

-- ─── Customer questions ─────────────────────────────────────────────────
create table job_questions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  customer_email text not null,
  message text not null,
  response text,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table job_questions enable row level security;

create policy "Admin can do everything on job_questions"
  on job_questions for all using (is_admin()) with check (is_admin());

create policy "Customers can view questions on their own jobs"
  on job_questions for select
  using (
    not is_admin()
    and exists (
      select 1 from jobs j
      where j.id = job_questions.job_id
      and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
    )
  );

create policy "Customers can submit questions on their own jobs"
  on job_questions for insert
  with check (
    customer_email = auth.jwt()->>'email'
    and exists (
      select 1 from jobs j
      where j.id = job_questions.job_id
      and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
    )
  );

alter publication supabase_realtime add table job_questions;

-- ══════════════════════════════════════════════════════════════════════
-- REQUIRED MANUAL STEP — mark your own account as admin
-- ══════════════════════════════════════════════════════════════════════
-- Replace the email below with the exact email you use to log into
-- jobs.mcloudconstruction.com, then run this separately:
--
-- update auth.users
-- set raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'::jsonb
-- where email = 'YOUR_ADMIN_EMAIL_HERE';
--
-- ⚠️ IMPORTANT: after running that, SIGN OUT and SIGN BACK IN on the main
-- site. Your browser is holding an old login token that doesn't know
-- about the admin role yet — until you sign in fresh, the app will look
-- like everything disappeared. That's expected and fixes itself on
-- next login.
