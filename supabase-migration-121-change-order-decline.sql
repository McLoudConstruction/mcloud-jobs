-- ═══════════════════════════════════════════════════════════════════════
-- Change order decline — the customer portal only had a way to approve
-- (sign) a change order, never a way to say no; everything else routed
-- through email/phone. Adds a declined_at/decline_reason pair, parallel
-- to how co_signatures.owner records approval, plus a security-definer
-- RPC to set it — customers only have SELECT on change_orders (migration
-- 035), so a direct UPDATE from the client silently no-ops under RLS,
-- same root cause the existing save_change_order_owner_signature RPC
-- works around (see that function; applied directly in Supabase, not in
-- this repo — same as migration 071 per ways-of-working notes).
-- ═══════════════════════════════════════════════════════════════════════

alter table change_orders add column if not exists declined_at timestamptz;
alter table change_orders add column if not exists decline_reason text;

create or replace function decline_change_order(target_co_id uuid, reason_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  co_job_id uuid;
  co_signed boolean;
begin
  select job_id, (co_signatures ? 'owner') into co_job_id, co_signed from change_orders where id = target_co_id;
  if co_job_id is null or not has_job_portal_access(co_job_id) then
    raise exception 'Not authorized';
  end if;
  if co_signed then
    raise exception 'This change order has already been signed and can no longer be declined';
  end if;
  update change_orders set declined_at = now(), decline_reason = reason_in where id = target_co_id;
end;
$$;
grant execute on function decline_change_order(uuid, text) to authenticated;
