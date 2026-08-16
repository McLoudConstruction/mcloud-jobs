-- Run in Supabase SQL Editor after migration 004.

-- ─── Invoice automation (only count as invoiced once actually sent) ────
alter table jobs add column if not exists invoiced_at timestamptz;
-- invoice_status already exists (not_sent/sent/paid) from the original schema.
-- The app now sets invoiced_at automatically the moment invoice_status becomes
-- 'sent' or 'paid', and lets you manually edit that date if needed.

-- ─── Project type + structured addresses ────────────────────────────────
alter table jobs add column if not exists project_type text check (project_type in ('residential','commercial'));

alter table jobs add column if not exists billing_street text;
alter table jobs add column if not exists billing_unit text;
alter table jobs add column if not exists billing_city text;
alter table jobs add column if not exists billing_state text;
alter table jobs add column if not exists billing_zip text;
alter table jobs add column if not exists billing_email text;

alter table jobs add column if not exists project_street text;
alter table jobs add column if not exists project_unit text;
alter table jobs add column if not exists project_city text;
alter table jobs add column if not exists project_state text;
alter table jobs add column if not exists project_zip text;

-- billing_address / project_address (existing text columns) are kept as
-- auto-generated display strings built from the parts above, so proposal/
-- contract/update documents keep working without changes.

-- ─── Contacts: add billing info so "suggest autofill" has data to use ──
alter table contacts add column if not exists billing_street text;
alter table contacts add column if not exists billing_unit text;
alter table contacts add column if not exists billing_city text;
alter table contacts add column if not exists billing_state text;
alter table contacts add column if not exists billing_zip text;
alter table contacts add column if not exists billing_email text;
