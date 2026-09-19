-- ═══════════════════════════════════════════════════════════════════════
-- Customer Portal — field progress status line on Home.
--
-- work_orders holds `amount`/`invoiced_amount` — what McLoud pays each
-- sub — which must never reach the customer. A plain RLS SELECT policy
-- on the table itself would expose those columns along with everything
-- else, so instead this follows the same pattern as sub_visible_rfps
-- (migration 117): a view, evaluated as its owner (bypassing work_orders'
-- own RLS), that only surfaces the columns a customer should see, filtered
-- to their own job via has_job_portal_access and granted directly.
--
-- Only work orders that have actually moved past negotiation (accepted
-- or later) are included — a draft/issued work order is still an
-- internal-facing negotiation with the sub, not something to surface as
-- "progress" to the customer.
-- ═══════════════════════════════════════════════════════════════════════

create or replace view customer_visible_work_order_progress as
select
  wo.id, wo.job_id, wo.trade, wo.description, wo.status, wo.field_progress
from work_orders wo
where wo.status in ('accepted', 'completed', 'invoiced', 'paid')
  and has_job_portal_access(wo.job_id);

grant select on customer_visible_work_order_progress to authenticated;
