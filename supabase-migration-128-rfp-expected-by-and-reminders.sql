-- Run in Supabase SQL Editor after migration 127. Safe to re-run.
--
-- Two things, both feeding the new "RFP proposal reminder" cron block in
-- /api/cron/daily-automations:
-- 1. rfps.expected_by — an optional date staff can set on an RFP for
--    when they need the sub's proposal back by. Left blank, the RFP is
--    open-ended and the reminder instead fires 2 weeks after the RFP
--    was created (computed in the cron job from created_at, not stored
--    here — no need for a second date column just to hold a derived
--    value).
-- 2. rfp_recipients.reminder_sent_at — so each recipient gets exactly
--    one nudge, not one per cron run until they respond.

alter table rfps add column if not exists expected_by date;
comment on column rfps.expected_by is 'Optional date staff need the sub''s proposal back by. When set, the reminder cron fires on the next workday on/after this date. When null, the reminder instead fires 2 weeks after created_at.';

alter table rfp_recipients add column if not exists reminder_sent_at timestamptz;
comment on column rfp_recipients.reminder_sent_at is 'When the one-time "please submit your proposal" reminder was sent to this recipient. Never re-sent once set, and never sent at all once the recipient has responded (status past sent/viewed).';
