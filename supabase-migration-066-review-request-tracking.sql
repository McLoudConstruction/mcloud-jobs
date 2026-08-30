-- Run in Supabase SQL Editor after migration 065. Safe to re-run.
--
-- Tracks when a Google Review request email was sent to the customer,
-- so the "Request a Google Review" button (Updates tab) can show
-- "Sent on <date>" / offer a resend, the same pattern used for
-- proposal_sent_at, contract_finalized_at, etc.

alter table jobs add column if not exists review_requested_at timestamptz;
