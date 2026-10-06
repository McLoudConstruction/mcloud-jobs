-- Run in Supabase SQL Editor after migration 153. Safe to re-run.
--
-- Email logging against CRM records (People, Properties, Companies).
--
-- The mailbox sync now reads sent and received mail for each connected
-- Google or Microsoft account and stores ONLY the messages where someone on
-- the thread matches an email address saved on a Person, Property or
-- Company. Everything else in the mailbox is never stored.
--
-- There is no separate link table. Each stored message carries a normalized
-- list of the addresses (and domains) on it, and each record's email log is
-- simply "messages whose addresses match this record's emails". That means
-- the log follows the data: change a contact's email, add a new contact to a
-- company, and the history moves with it, no re-matching needed.

-- ── Per-connection settings and progress ────────────────────────────────
alter table integration_connections add column if not exists crm_email_enabled boolean not null default false;
-- Everything before this moment has been scanned. Advances window by window.
alter table integration_connections add column if not exists crm_email_synced_at timestamptz;
alter table integration_connections add column if not exists crm_email_last_run_at timestamptz;
alter table integration_connections add column if not exists crm_email_last_error text;

-- ── email_messages additions ────────────────────────────────────────────
-- 'platform' = sent by this app, or a job tagged reply (existing behavior).
-- 'crm_sync' = pulled from a connected mailbox because an address on it
--              matched a CRM record. These stay out of the Messages inbox
--              unless they are tied to a job.
alter table email_messages add column if not exists source text not null default 'platform';
-- Holds Cc and Bcc recipients (Bcc only appears on sent copies).
alter table email_messages add column if not exists cc_email text;
alter table email_messages add column if not exists participants text[] not null default '{}';
alter table email_messages add column if not exists participant_domains text[] not null default '{}';

create index if not exists email_messages_participants_idx on email_messages using gin (participants);
create index if not exists email_messages_participant_domains_idx on email_messages using gin (participant_domains);

-- One trigger fills participants for EVERY insert path (the app's own sends,
-- the job tag reply sync, and the new mailbox sync), so there is exactly one
-- definition of "who is on this email".
create or replace function email_messages_set_participants()
returns trigger
language plpgsql
as $$
declare
  addrs text[];
begin
  select coalesce(array_agg(distinct lower(r.m[1])), '{}')
    into addrs
    from regexp_matches(
      coalesce(new.from_email, '') || ' ' || coalesce(new.to_email, '') || ' ' || coalesce(new.cc_email, ''),
      '([A-Za-z0-9._%+''-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})',
      'g'
    ) as r(m);
  new.participants := addrs;
  new.participant_domains := coalesce(
    (select array_agg(distinct split_part(a, '@', 2)) from unnest(addrs) as a),
    '{}'
  );
  return new;
end;
$$;

drop trigger if exists email_messages_set_participants_trg on email_messages;
create trigger email_messages_set_participants_trg
  before insert or update of from_email, to_email, cc_email on email_messages
  for each row execute function email_messages_set_participants();

-- Backfill every existing row (touching from_email fires the trigger).
-- This emits one realtime event per row, which is harmless.
update email_messages set from_email = from_email where participants = '{}';

-- ── Fix: the old unique index was partial, which ON CONFLICT cannot use ─
-- The inbound sync upserts on (connection_id, provider_message_id). Postgres
-- can only infer a PARTIAL unique index when the statement repeats its WHERE
-- clause, which the Supabase client cannot do, so that upsert was failing
-- with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". A plain unique index works: NULLs are never equal, so the
-- app's own sends (null connection and message id) still never collide.
drop index if exists email_messages_provider_msg_idx;
create unique index if not exists email_messages_provider_msg_full_idx
  on email_messages (connection_id, provider_message_id);
