-- Run in Supabase SQL Editor after migration 040. Safe to re-run.
--
-- Migration 028 created accept_work_order(), which sets accepted_at on
-- signing — but never actually added that column. This is why signing a
-- work order has been throwing "column accepted_at does not exist."
alter table work_orders add column if not exists accepted_at timestamptz;
