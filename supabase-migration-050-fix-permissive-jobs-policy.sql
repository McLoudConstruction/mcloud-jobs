-- Run in Supabase SQL Editor after migration 049. This is the real fix
-- for the customer-portal-sees-everything bug.
--
-- Migration 009 tried to drop policy "Authenticated can do everything on
-- jobs" — but the policy's actual name (from the original schema file)
-- was "Authenticated users can do everything on jobs". DROP POLICY IF
-- EXISTS matches by exact name, so that one-word mismatch meant the drop
-- silently did nothing — no error, nothing to flag it. That original
-- policy — true for ANY authenticated user, admin or customer — has
-- been active this entire time. Since RLS SELECT policies are OR'd
-- together, this one alone was enough to override every careful
-- customer-scoped policy built since, on both jobs and job_updates.

drop policy if exists "Authenticated users can do everything on jobs" on jobs;
drop policy if exists "Authenticated users can do everything on job_updates" on job_updates;

-- Verification: after running this, a customer session should only ever
-- see rows their own has_job_portal_access(id) check actually permits.
