-- Run in Supabase SQL Editor after migration 057. Safe to re-run.

-- sub_portal_users was never added to the realtime publication back in
-- migration 054, which is why the Settings roster list needed a manual
-- refresh to show a newly-added login.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sub_portal_users'
  ) then
    alter publication supabase_realtime add table sub_portal_users;
  end if;
end $$;

-- Lets an Owner/Manager set a password on behalf of a teammate. This
-- resolves an auth.users id from an email address so a server-only API
-- route can call the Supabase Admin API (auth.admin.updateUserById),
-- which needs a user id, not an email. Deliberately NOT granted to
-- "authenticated" — only the service-role key can call it, so it can't
-- be used to enumerate arbitrary accounts from the client.
create or replace function get_user_id_by_email(lookup_email text)
returns uuid
language sql
security definer
set search_path = public, auth
stable
as $$
  select id from auth.users where email = lookup_email limit 1;
$$;
revoke all on function get_user_id_by_email(text) from public, anon, authenticated;
grant execute on function get_user_id_by_email(text) to service_role;
