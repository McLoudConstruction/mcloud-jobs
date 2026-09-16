-- Internal Updates: adds a Category dropdown to "Post an Internal Update"
-- (see INTERNAL_UPDATE_CATEGORIES in lib/constants.js). Optional — existing
-- and future updates with no category chosen stay null.
alter table job_updates add column if not exists category text;
