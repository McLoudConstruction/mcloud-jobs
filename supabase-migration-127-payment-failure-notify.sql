-- Run in Supabase SQL Editor after migration 126. Safe to re-run.
--
-- payment_intent.payment_failed (app/api/payments/webhook/route.js) has
-- always updated payments.status = 'failed' and stopped there — no
-- record of *why*, nothing shown to the customer, nothing raised to the
-- office. This just adds the column; the webhook route (application
-- code, not a migration) is what now also writes to `notifications` and
-- `portal_notifications` when a payment fails.

alter table payments add column if not exists failure_reason text;
