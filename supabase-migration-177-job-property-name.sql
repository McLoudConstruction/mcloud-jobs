-- Property name on a job, for commercial work where the customer is a company
-- and the job is at a named property (for example "Oakwood Apartments").
-- Optional and free text. Safe to run twice.

alter table jobs add column if not exists property_name text;

-- Rollback: alter table jobs drop column if exists property_name;
