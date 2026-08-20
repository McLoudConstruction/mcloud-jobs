-- Run in Supabase SQL Editor after migration 036. Safe to re-run.

-- job_questions already modeled "customer asks, admin answers" via
-- message/response on one row. Adding sender lets admin also send a
-- standalone message (not just reply to a pending question) — existing
-- rows default to 'customer', which is exactly what they already are.
alter table job_questions add column if not exists sender text not null default 'customer'
  check (sender in ('customer', 'admin'));
