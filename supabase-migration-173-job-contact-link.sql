-- Migration 173: link a job to a person.
--
-- Run after 172. Safe to run twice.
--
-- A job has always carried a typed in copy of its customer's name, email and phone, with no link
-- back to the person in People. That is a problem when a commercial contact, say a property manager
-- you are courting, hires us for their own house. The job is residential, the person is a commercial
-- contact, and nothing connected the two.
--
-- jobs.contact_id points at the person. It is optional and it does not replace the typed in customer
-- fields (documents, the portal and messages still read those). Any job can be linked to any person,
-- and one person can have many jobs. Deleting the person leaves the job and clears the link.
--
-- The person's Overview shows their linked jobs, and a job's Customer card shows its linked person.

alter table jobs add column if not exists contact_id uuid references contacts(id) on delete set null;
create index if not exists jobs_contact_id_idx on jobs (contact_id) where contact_id is not null;

-- Notes
--  * No data is changed. Existing jobs have no link until one is added.
--  * Rollback: drop index jobs_contact_id_idx; alter table jobs drop column contact_id;
--    The app then hides the link and keeps working.
