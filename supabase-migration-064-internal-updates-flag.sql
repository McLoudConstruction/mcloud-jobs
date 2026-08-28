-- Run in Supabase SQL Editor after migration 063. Safe to re-run.
--
-- Adds a way to tell "Internal Updates" (quick field notes, formerly the
-- Field Log tab) apart from formal customer-facing progress updates —
-- both live in job_updates, since they're the same underlying shape.
--
-- Note on customer-facing security: this does NOT need a new RLS policy
-- to keep internal updates hidden from customers. That's already handled
-- — migration 035's customer policy requires `sent_at is not null`, and
-- sent_at is only ever set by the explicit "Send" action on a formal
-- progress update (app/jobs/[id]/updates/[updateId]/page.js). Internal
-- updates never go through that flow, so they're already unreachable by
-- a customer session regardless of this column. is_internal exists
-- purely to separate the two feeds on the admin side.

alter table job_updates add column if not exists is_internal boolean not null default false;

-- Tracks whether (and into which formal update) an internal note has
-- already been promoted, so the UI can show "Added to Progress Update"
-- instead of letting the same note get promoted twice by accident.
alter table job_updates add column if not exists promoted_to_update_id uuid references job_updates(id) on delete set null;
