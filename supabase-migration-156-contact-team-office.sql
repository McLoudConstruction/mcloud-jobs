-- Run in Supabase SQL Editor after migration 155. Safe to re-run.
-- Adds a Team/Office field to contacts, used by the Real Estate Agent
-- contact type (the brokerage team or office the agent works under).
alter table contacts add column if not exists team_office text;
