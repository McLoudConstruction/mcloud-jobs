-- Run in Supabase SQL Editor after migration 180. Safe to re-run.
--
-- Website chat assistant (mcloudconstruction.com) and consultation booking.
--
--   consult_settings   One row. Whether the chat may book consultations, the
--                      weekly hours, slot length, buffer, notice, how far
--                      ahead, and the most consultations per day.
--   consult_blackouts  Dates (or part of a day) the chat must not offer.
--   consult_bookings   Every consultation the chat booked. A unique index on
--                      the start time stops two people taking the same slot.
--   chat_conversations Saved transcripts, so staff can see what visitors ask.
--   chat_rate_events   One row per chat message or booking, used to rate limit
--                      a visitor (stored as a salted hash, never the raw IP).
--
-- The marketing site reaches all of this through the secret protected routes
-- under /api/public/chat (server to server). No table here is readable by the
-- public; staff reach them through the admin policies below.
--
-- Consultations are off until an owner turns them on in Settings, Consultations.

-- ═══════════════════════════════════════════════════════════════════════
-- Settings
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists consult_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  slot_minutes integer not null default 60 check (slot_minutes between 15 and 480),
  buffer_minutes integer not null default 30 check (buffer_minutes between 0 and 240),
  min_notice_hours integer not null default 24 check (min_notice_hours between 0 and 720),
  max_days_ahead integer not null default 30 check (max_days_ahead between 1 and 120),
  max_per_day integer not null default 3 check (max_per_day between 1 and 20),
  -- { "mon": [{"start":"09:00","end":"16:00"}], ... }. An empty list is a day off.
  weekly_hours jsonb not null default '{
    "sun": [],
    "mon": [{"start":"09:00","end":"16:00"}],
    "tue": [{"start":"09:00","end":"16:00"}],
    "wed": [{"start":"09:00","end":"16:00"}],
    "thu": [{"start":"09:00","end":"16:00"}],
    "fri": [{"start":"09:00","end":"16:00"}],
    "sat": []
  }'::jsonb,
  updated_at timestamptz not null default now()
);

insert into consult_settings (id) values (1) on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════
-- Blackout periods
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists consult_blackouts (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  -- Both empty = the whole day(s). Both set = only that time range each day.
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz not null default now(),
  constraint consult_blackouts_dates check (end_date >= start_date),
  constraint consult_blackouts_times check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index if not exists consult_blackouts_dates_idx on consult_blackouts (start_date, end_date);

-- ═══════════════════════════════════════════════════════════════════════
-- Bookings
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists consult_bookings (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked', 'canceled')),
  source text not null default 'chat',
  conversation_id uuid,
  created_at timestamptz not null default now()
);

-- Two people can never hold the same start time.
create unique index if not exists consult_bookings_start_unique
  on consult_bookings (starts_at) where status = 'booked';
create index if not exists consult_bookings_opportunity_idx on consult_bookings (opportunity_id);

-- ═══════════════════════════════════════════════════════════════════════
-- Chat transcripts and rate limiting
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  ip_hash text,
  page_path text,
  -- [{ "role": "user"|"assistant", "content": "...", "at": "ISO time" }]
  messages jsonb not null default '[]'::jsonb,
  user_message_count integer not null default 0,
  opportunity_id uuid references opportunities(id) on delete set null,
  escalated boolean not null default false,
  escalation_reason text,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists chat_conversations_last_idx on chat_conversations (last_message_at desc);
create index if not exists chat_conversations_ip_idx on chat_conversations (ip_hash, started_at);

create table if not exists chat_rate_events (
  id bigserial primary key,
  ip_hash text not null,
  kind text not null check (kind in ('message', 'booking', 'conversation', 'lead')),
  created_at timestamptz not null default now()
);

create index if not exists chat_rate_events_lookup_idx on chat_rate_events (ip_hash, kind, created_at desc);
create index if not exists chat_rate_events_created_idx on chat_rate_events (created_at);

-- ═══════════════════════════════════════════════════════════════════════
-- Row level security: admin staff only. The chat routes use the service role.
-- ═══════════════════════════════════════════════════════════════════════
alter table consult_settings enable row level security;
alter table consult_blackouts enable row level security;
alter table consult_bookings enable row level security;
alter table chat_conversations enable row level security;
alter table chat_rate_events enable row level security;

drop policy if exists "Admin can do everything on consult_settings" on consult_settings;
create policy "Admin can do everything on consult_settings" on consult_settings
  for all using (is_admin()) with check (is_admin());

drop policy if exists "Admin can do everything on consult_blackouts" on consult_blackouts;
create policy "Admin can do everything on consult_blackouts" on consult_blackouts
  for all using (is_admin()) with check (is_admin());

drop policy if exists "Admin can do everything on consult_bookings" on consult_bookings;
create policy "Admin can do everything on consult_bookings" on consult_bookings
  for all using (is_admin()) with check (is_admin());

drop policy if exists "Admin can do everything on chat_conversations" on chat_conversations;
create policy "Admin can do everything on chat_conversations" on chat_conversations
  for all using (is_admin()) with check (is_admin());

-- Rate events are only ever touched by the service role; no client policy.
