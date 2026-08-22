-- Run in Supabase SQL Editor after migration 048. Safe to re-run.
-- Temporary diagnostic — safe to drop once the portal access bug is found.
create or replace function debug_my_portal_access()
returns table (job_id uuid, email text, portal_access boolean, notify boolean)
language sql
stable
security definer
set search_path = public
as $$
  select jpa.job_id, jpa.email, jpa.portal_access, jpa.notify
  from job_portal_access jpa
  where jpa.email = auth.jwt()->>'email';
$$;

grant execute on function debug_my_portal_access() to authenticated;
