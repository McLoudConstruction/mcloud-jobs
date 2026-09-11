-- Run in Supabase SQL Editor after migration 091. Safe to re-run.
--
-- A single log of every outbound email the system has sent, regardless of
-- which route sent it (the shared /api/send-email endpoint, staff invites,
-- portal invites, or the daily-automations cron). Inserts always go through
-- the service-role client from the server, so RLS here only needs to gate
-- staff read access.

create table if not exists communications_log (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  channel text not null default 'email',
  category text not null default 'general',
  to_email text not null,
  subject text,
  job_id uuid references jobs(id) on delete set null,
  sent_by text,
  status text not null default 'sent',
  error_message text,
  provider text
);

create index if not exists communications_log_sent_at_idx on communications_log (sent_at desc);
create index if not exists communications_log_job_id_idx on communications_log (job_id);
create index if not exists communications_log_to_email_idx on communications_log (to_email);

alter table communications_log enable row level security;

drop policy if exists "Admin full access to communications_log" on communications_log;
create policy "Admin full access to communications_log" on communications_log for all
  using (is_admin()) with check (is_admin());
