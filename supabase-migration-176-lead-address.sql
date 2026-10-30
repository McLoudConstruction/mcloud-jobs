-- Lead address, so the lead popup on the Sales page can show a map with a pin.
-- Site requests already carry site_address (migration 146); this is the same
-- idea for leads entered by staff or from the website. Safe to run twice.

alter table opportunities add column if not exists address text;

-- Rollback: alter table opportunities drop column if exists address;
