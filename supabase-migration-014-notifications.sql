-- Run in Supabase SQL Editor after migration 013. Safe to re-run.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  job_id uuid references jobs(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

drop policy if exists "Admin can do everything on notifications" on notifications;
create policy "Admin can do everything on notifications"
  on notifications for all using (is_admin()) with check (is_admin());

-- Customers can create a notification (e.g. signing a contract) tied to
-- their own job, but can never read the notifications list — that's yours.
drop policy if exists "Customers can create notifications on their own jobs" on notifications;
create policy "Customers can create notifications on their own jobs"
  on notifications for insert
  with check (
    is_admin()
    or (
      job_id is not null
      and exists (
        select 1 from jobs j
        where j.id = notifications.job_id
        and (j.customer_email = auth.jwt()->>'email' or j.billing_email = auth.jwt()->>'email')
      )
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

-- Dashboard widget display order (array of widget keys)
alter table app_settings add column if not exists dashboard_widget_order jsonb not null default '[]';
