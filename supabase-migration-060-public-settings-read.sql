-- Run in Supabase SQL Editor after migration 059. Safe to re-run.
-- Branding (logo, colors) isn't sensitive — migration 021 already opened
-- this up for any authenticated user. The sub-portal's landing and login
-- pages now also show the configured logo, and those are hit by
-- signed-out visitors (anon role), so read access needs to extend to them
-- too or the custom logo silently falls back to the default there.

drop policy if exists "Any authenticated user can read settings" on app_settings;
create policy "Anyone can read settings"
  on app_settings for select
  using (true);

-- "Admin can update settings" policy (write access) is untouched and stays admin-only.
