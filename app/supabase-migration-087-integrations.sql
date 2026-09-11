-- Run in Supabase SQL Editor after migration 086. Safe to re-run.
--
-- Backs the new Integrations tab in Settings: real OAuth connections
-- for Google, Microsoft, and QuickBooks Online, plus API-key-based
-- integrations (Resend, Weather), plus two-way calendar sync tracking.
--
-- Tokens and API keys are encrypted at rest (see lib/integrations/crypto.js,
-- requires INTEGRATION_ENCRYPTION_KEY in Vercel env vars) and these
-- tables get NO client RLS policies at all — anon and authenticated are
-- both blocked from reading or writing them directly. Every access goes
-- through a server API route using the service role key. That's a
-- deliberate belt-and-suspenders: even a bug in a route's query can't
-- leak a token to the browser, because the client was never granted
-- permission to read the table in the first place.

-- One row per staff member per provider they've personally connected.
-- Google/Microsoft are per-staff (each person's own calendar); a staff
-- member reconnecting the same provider overwrites their existing row.
create table if not exists integration_connections (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft', 'quickbooks')),
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  scope text,
  external_account_email text,   -- connected Gmail / Outlook address
  external_account_id text,      -- provider user id, or QBO realmId
  external_account_label text,   -- e.g. QBO company name
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, provider)
);
alter table integration_connections enable row level security;

-- Company-wide, key-based integrations. Not per-staff.
create table if not exists integration_credentials (
  provider text primary key check (provider in ('resend', 'weather')),
  api_key_enc text not null,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table integration_credentials enable row level security;

-- Maps a job to the calendar event it was pushed to, per connection, so
-- re-syncing updates the same event instead of creating duplicates.
create table if not exists calendar_sync_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references integration_connections(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  external_event_id text not null,
  last_pushed_at timestamptz not null default now(),
  unique (connection_id, job_id)
);
alter table calendar_sync_events enable row level security;

-- Cached "busy" events pulled from a staff member's personal calendar on
-- each sync run. Not linked to any job — just an overlay so the office
-- can see "Mike's got something personal that week" on the job calendar.
create table if not exists external_busy_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references integration_connections(id) on delete cascade,
  external_event_id text not null,
  title text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  last_synced_at timestamptz not null default now(),
  unique (connection_id, external_event_id)
);
alter table external_busy_events enable row level security;

-- Unlike the tables above, active staff CAN read busy events directly —
-- that's the whole point (an overlay on the shared job calendar). Titles
-- pulled from a personal calendar are still shown, so this is a
-- deliberate, narrow exception to the "no client access" rule above.
create policy "staff can read busy events" on external_busy_events
  for select
  using (
    exists (select 1 from staff_users where id = auth.uid() and status = 'active')
  );

-- QuickBooks invoice sync tracking on the existing draws table.
alter table invoices add column if not exists qbo_invoice_id text;
alter table invoices add column if not exists qbo_synced_at timestamptz;
