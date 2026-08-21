-- Run in Supabase SQL Editor after migration 041. Safe to re-run.
alter table opportunities add column if not exists project_type text check (project_type in ('residential', 'commercial'));

-- Contact and property types diverged: properties keep granular commercial
-- sub-types (now without the "Commercial - " prefix), contacts collapse
-- them into one "Commercial" option. Update existing stored values to
-- match, so records created under the old naming still show correctly
-- selected in the new dropdowns instead of appearing blank.
update properties set property_type = 'Office' where property_type = 'Commercial - Office';
update properties set property_type = 'Retail' where property_type = 'Commercial - Retail';
update properties set property_type = 'Industrial' where property_type = 'Commercial - Industrial';

update contacts set contact_type = 'Commercial' where contact_type in ('Commercial - Office', 'Commercial - Retail', 'Commercial - Industrial');
