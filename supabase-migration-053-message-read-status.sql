-- Run in Supabase SQL Editor after migration 052. Safe to re-run.
-- "Read" and "responded to" are different things — a message can be read
-- without needing a reply. read_at tracks whether the office has seen a
-- customer message; responded_at (already on this table) still tracks
-- whether it's gotten an actual reply.

alter table job_questions add column if not exists read_at timestamptz;

-- Anything that's already been responded to has necessarily been read.
update job_questions set read_at = responded_at where responded_at is not null and read_at is null;
