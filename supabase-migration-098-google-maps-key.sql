-- Run in Supabase SQL Editor after migration 097. Safe to re-run.
--
-- Adds Google Maps as a fourth key-based integration (same table
-- migration 087 created, extended for 'unsplash' in migration 088).
-- Lets the Google Maps Platform API key that powers property
-- name/address autocomplete (PlacesAutocompleteInput, used on the
-- Properties form and the Sales > Create Sales Route builder) be
-- managed from Settings → Integrations instead of a Vercel env var.

alter table integration_credentials drop constraint if exists integration_credentials_provider_check;
alter table integration_credentials add constraint integration_credentials_provider_check
  check (provider in ('resend', 'weather', 'unsplash', 'google_maps'));
