-- Run in Supabase SQL Editor after migration 104. Safe to re-run.
--
-- Scheduling a bid walk / inspection for a lead (opportunities row) is a
-- strong enough signal that it's a real, qualified opportunity — the
-- Sales page uses this to automatically walk the person straight into
-- the "Convert to Opportunity" flow the moment it's scheduled, instead
-- of leaving that as a separate manual click later.

alter table opportunities add column if not exists bid_walk_scheduled_at timestamptz;
