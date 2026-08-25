-- Run in Supabase SQL Editor after migration 055. Safe to re-run.
-- Self-service applicants (landing on the portal with no prior invite)
-- won't have a known email until they fill out the form itself, so this
-- can no longer be a required column.
alter table subcontractor_applications alter column invited_email drop not null;
