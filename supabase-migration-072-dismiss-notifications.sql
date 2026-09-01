-- Run in Supabase SQL Editor after migration 070 (071 was applied directly
-- via the SQL Editor and isn't in this repo, per the realtime-publication
-- fix notes — safe to re-run either way).
--
-- Adds a way to clear a notification out of the list entirely, separate
-- from "read." Read/unread drives the badge count; dismissed controls
-- whether it shows up in the list at all. Dismissing always implies read,
-- so a dismissed notification can never still be counted as unread.

alter table notifications add column if not exists dismissed boolean not null default false;

create index if not exists notifications_dismissed_idx on notifications (dismissed);
