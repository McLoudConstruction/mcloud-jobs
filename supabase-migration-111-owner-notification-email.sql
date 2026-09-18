-- Run in Supabase SQL Editor after migration 110.
--
-- Emails the owner the moment a notification-level event happens anywhere
-- in the app (a contract signed, a work order accepted, and similar —
-- anything that already lands in the `notifications` table, from any of
-- the ~9 places in the code that insert one, including future ones). A
-- Postgres trigger + pg_net webhook, not a new Vercel Cron job — this
-- project is already at its 2-cron cap on the Hobby plan (see
-- vercel.json) — a trigger fires once, immediately, per row, at no
-- cron-slot cost at all.
--
-- SETUP — two steps, both required before this actually sends anything:
--   1. Pick a long random secret string and paste it in place of
--      'CHANGE-ME-TO-A-RANDOM-SECRET' below.
--   2. Set NOTIFICATION_WEBHOOK_SECRET to that EXACT SAME string in
--      Vercel → Settings → Environment Variables, then redeploy.
-- The receiving route (app/api/webhooks/notification-created) is
-- otherwise unauthenticated — Supabase can't send a real user session —
-- so this shared secret is what stops a stranger from POSTing fake
-- "notifications" at it to spam your inbox.
--
-- Also: Settings → Automation → "Send to" (app_settings.notification_email,
-- added below) must have an address in it, or these emails are silently
-- skipped — that's intentional (opt-in, not a misconfiguration), matching
-- how notifications themselves already work without ever forcing an
-- email on someone who didn't ask for it. It's pre-filled with your
-- current account email so this works immediately; change or clear it
-- any time in Settings.

create extension if not exists pg_net with schema extensions;

alter table app_settings add column if not exists notification_email text;
update app_settings set notification_email = 'stachys@mcloud.us' where id = 1 and notification_email is null;

create or replace function notify_owner_on_notification()
returns trigger as $$
begin
  perform net.http_post(
    url := 'https://jobs.mcloudconstruction.com/api/webhooks/notification-created',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer rVKyY75WfWTFNuq64HmY'
    ),
    body := jsonb_build_object('id', new.id, 'message', new.message, 'job_id', new.job_id)
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists notifications_notify_owner on notifications;
create trigger notifications_notify_owner
  after insert on notifications
  for each row execute function notify_owner_on_notification();
