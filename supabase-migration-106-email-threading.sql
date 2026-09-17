-- Run in Supabase SQL Editor after migration 105. Safe to re-run.
--
-- Job-threaded email (Option C from the email integration conversation):
-- every outbound email is now tagged with "[Job #2026-003]" in its
-- subject (lib/emailThreading.js), and this table is where inbound sync
-- files replies back against the right job by reading that same tag.
-- Filtered to job-tagged mail only — this is not a general inbox.

create table if not exists email_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete set null,
  connection_id uuid references integration_connections(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  provider text, -- 'google' | 'microsoft'
  provider_message_id text,
  provider_thread_id text,
  from_email text,
  to_email text,
  subject text,
  snippet text,
  body_text text,
  body_html text,
  received_at timestamptz not null default now(),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists email_messages_job_idx on email_messages (job_id);
create index if not exists email_messages_connection_idx on email_messages (connection_id);
-- Prevents re-filing the same provider message twice on a repeat sync run.
create unique index if not exists email_messages_provider_msg_idx
  on email_messages (connection_id, provider_message_id)
  where provider_message_id is not null;

alter table email_messages enable row level security;
create policy "Authenticated can do everything on email_messages"
  on email_messages for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
alter publication supabase_realtime add table email_messages;

-- Tracks how far back each mailbox connection has been synced, so the
-- sync route can ask providers for "anything since X" instead of
-- re-scanning the whole mailbox history every run.
alter table integration_connections add column if not exists email_last_synced_at timestamptz;
