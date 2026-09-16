-- Adds a dedicated company_name column to jobs, used by the Customer tab's
-- commercial-only "Company Name" field (autofilled from the companies
-- table). Distinct from customer_name, which stays the single "who this
-- is" field used everywhere downstream (documents, portal, messages) —
-- company_name is only the specific company record tied to this job.
alter table jobs add column if not exists company_name text;
