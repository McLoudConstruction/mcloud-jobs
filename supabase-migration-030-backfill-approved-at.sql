-- Run in Supabase SQL Editor after migration 029. Safe to re-run — only
-- touches rows where approved_at is still null.
--
-- Any job that reached Approved (or moved further along) before the
-- Revenue/approved_at tracking feature existed never had approved_at set,
-- since it's only written at the moment of the stage transition. This
-- catches those jobs up so they count correctly going forward. There's no
-- way to know the true historical approval date, so this uses today's
-- date as the best available value — if you know the real approval date
-- for a given job, edit it directly on that job's page afterward.
update jobs
set approved_at = now()
where approved_at is null
  and stage in ('approved', 'scheduled', 'active', 'completed', 'invoiced', 'paid');
