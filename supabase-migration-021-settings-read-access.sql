-- Run in Supabase SQL Editor after migration 020. Safe to re-run.
-- Settings like the logo and color theme aren't sensitive — the customer
-- portal already displays them. Only WRITING settings should be admin-only.

drop policy if exists "Admin can read settings" on app_settings;
create policy "Any authenticated user can read settings"
  on app_settings for select
  using (auth.role() = 'authenticated');

-- "Admin can update settings" policy (write access) is untouched and stays admin-only.
