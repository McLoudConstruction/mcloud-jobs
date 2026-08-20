-- Run in Supabase SQL Editor after migration 033. Safe to re-run.

-- Nothing tracked visit history before this — the sales route builder
-- needs it to actually avoid recently-visited properties rather than
-- just filtering by area/type.
alter table properties add column if not exists last_visited_at timestamptz;
