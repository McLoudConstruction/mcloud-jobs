-- Migration 139 — Move the notification webhook secret out of the code
--
-- Migrations 111, 125 and 126 hard-coded the NOTIFICATION_WEBHOOK_SECRET into
-- the two trigger functions that call the email webhooks. Anyone who can read
-- this repository can therefore read the secret, and use it to make the
-- webhooks send email on your behalf.
--
-- This migration changes both functions to read the secret from a locked
-- table instead. On first run it copies the CURRENT secret out of the live
-- function definitions into that table, so nothing stops working the moment
-- you run it — this migration itself contains no secret.
--
-- TO ROTATE (do this after running the migration — the old value is still
-- visible in the history of migrations 111/125/126):
--   1. Pick a new random value.
--   2. In Vercel, set NOTIFICATION_WEBHOOK_SECRET to it and redeploy.
--   3. In the SQL editor run:
--        insert into app_private_secrets (name, value) values ('webhook_secret', 'THE-NEW-VALUE')
--        on conflict (name) do update set value = excluded.value;
--   Emails are skipped (the in-app notification is still saved) for the minute
--   or so between steps 2 and 3, so do them back to back.

create table if not exists app_private_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table app_private_secrets enable row level security;
revoke all on app_private_secrets from public, anon, authenticated;
-- No policies: nothing but the database owner (and the functions below,
-- which are security definer) can read it. Not even staff logins.

-- One-time seed from whatever the live functions currently send.
do $$
declare
  found text;
  fn text;
begin
  if exists (select 1 from app_private_secrets where name = 'webhook_secret') then return; end if;
  foreach fn in array array['notify_portal_recipient', 'notify_owner_on_notification'] loop
    begin
      select substring(pg_get_functiondef(p.oid) from 'Bearer ([^'']+)''') into found
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.proname = fn and n.nspname = 'public' limit 1;
    exception when others then found := null;
    end;
    exit when found is not null and found <> '';
  end loop;
  if found is not null and found <> '' then
    insert into app_private_secrets (name, value) values ('webhook_secret', found);
  else
    raise notice 'No existing webhook secret was found to copy. Set one with: insert into app_private_secrets (name, value) values (''webhook_secret'', ''...'');';
  end if;
end $$;

create or replace function _webhook_secret()
returns text
language sql
stable
security definer
set search_path = public
as $$ select value from app_private_secrets where name = 'webhook_secret'; $$;
revoke all on function _webhook_secret() from public, anon, authenticated;

create or replace function notify_owner_on_notification()
returns trigger as $$
declare
  secret text := _webhook_secret();
begin
  if not new.owner_notify then
    return new;
  end if;
  if secret is null then
    raise warning 'Webhook secret not set (app_private_secrets) — owner email skipped.';
    return new;
  end if;
  perform net.http_post(
    url := 'https://jobs.mcloudconstruction.com/api/webhooks/notification-created',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := jsonb_build_object('id', new.id, 'message', new.message, 'job_id', new.job_id)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function notify_portal_recipient()
returns trigger as $$
declare
  secret text := _webhook_secret();
begin
  if secret is null then
    raise warning 'Webhook secret not set (app_private_secrets) — portal email skipped.';
    return new;
  end if;
  perform net.http_post(
    url := 'https://jobs.mcloudconstruction.com/api/webhooks/portal-notification-created',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := jsonb_build_object(
      'id', new.id,
      'recipient_kind', new.recipient_kind,
      'job_id', new.job_id,
      'company_id', new.company_id,
      'category', new.category,
      'message', new.message,
      'source_id', new.source_id,
      'meta', new.meta
    )
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
