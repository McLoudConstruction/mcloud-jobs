-- Run in Supabase SQL Editor after migration 087. Safe to re-run.
--
-- Backs the picture chooser on Estimate → Pricing material line items.
-- image_storage_path is used for photos uploaded from your device (private
-- job-photos bucket — same pattern as MaterialSelectionWizard, resolved to
-- a signed URL at render time). image_url is used for photos picked from
-- an online image search (already a public URL, no signing needed).
alter table job_estimate_items add column if not exists image_storage_path text;
alter table job_estimate_items add column if not exists image_url text;
alter table job_estimate_items add column if not exists image_source text check (image_source in ('upload', 'search'));

-- Image search (for the material picture chooser) is another API-key
-- integration, same shape as Resend/Weather — widen the existing check.
alter table integration_credentials drop constraint if exists integration_credentials_provider_check;
alter table integration_credentials add constraint integration_credentials_provider_check
  check (provider in ('resend', 'weather', 'unsplash'));

-- job_estimate_items has only one RLS policy (admin-only) since it holds
-- unit prices and margins — nothing on it should ever be readable by a
-- customer directly. But the proposal document needs to show material
-- photos to the customer viewing their own job. Rather than add a broader
-- table policy (risking a future column ever leaking price/cost data),
-- this function returns exactly description + photo and nothing else,
-- gated by the same has_job_portal_access() check every other
-- customer-facing read already uses.
create or replace function get_job_material_photos(target_job_id uuid)
returns table(description text, image_url text, image_storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select i.description, i.image_url, i.image_storage_path
  from job_estimate_items i
  where i.job_id = target_job_id
    and i.category = 'material'
    and (i.image_url is not null or i.image_storage_path is not null)
    and (has_job_portal_access(target_job_id) or is_admin());
$$;

grant execute on function get_job_material_photos(uuid) to authenticated;
