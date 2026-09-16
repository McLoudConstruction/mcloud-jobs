-- Change Orders: categorized reason picker (Scope & Condition Changes,
-- Schedule, Site Conditions, Financial/Administrative, Status/Informational
-- — see CHANGE_ORDER_REASON_CATEGORIES in lib/constants.js).
alter table change_orders add column if not exists reason_category text;
alter table change_orders add column if not exists reason text;

-- Work Orders: Trade dropdown, sourced from the trades already present on
-- this job's Exhaustive Action List & Trade Breakdown, plus "Other".
alter table work_orders add column if not exists trade text;

-- job_photos: lets a photo be linked to a change order (used when
-- "Fill Change Order with Internal Update" carries an update's photos
-- over), the same way it already links to job_updates via update_id.
alter table job_photos add column if not exists change_order_id uuid references change_orders(id) on delete cascade;

-- Invoice: what this invoice covers, alongside the existing invoice_amount/
-- invoice_status/invoiced_at fields. Lives on jobs directly, same as
-- invoiced_at, rather than job_financials — it's descriptive text, not a
-- number that needs hiding from field crew via RLS.
alter table jobs add column if not exists invoice_description text;
