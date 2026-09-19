-- ═══════════════════════════════════════════════════════════════════════
-- Customer Portal — read-only schedule view.
--
-- Replaces the earlier idea of a fixed 6-step milestone stepper (Contract
-- → Permitting → Materials → In Progress → Punch List → Complete): none
-- of those steps besides Contract and Complete map onto real data, so
-- rather than guess, the customer now sees the same job_phases Gantt
-- schedule staff already builds on the Schedule tab — view only, no
-- drag/edit/regenerate controls, same phases, dates, and trade colors.
--
-- job_phases previously had no customer-facing policy at all (admin-only,
-- migration 081) — this adds SELECT scoped to the job's own portal
-- contacts via the shared has_job_portal_access() gate (migration 093),
-- same pattern as job_updates/change_orders/invoices.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "Customers can view phases on their own jobs" on job_phases;
create policy "Customers can view phases on their own jobs" on job_phases for select using (
  has_job_portal_access(job_id)
);
