-- Run in Supabase SQL Editor after migration 027. Safe to re-run.
-- Subcontractor portal, Phase 1: admin + crew logins per company, work
-- order accept/decline with signature, and a narrow safe view of job
-- info so subs never touch the raw jobs table (customer PII, financials).

-- ═══════════════════════════════════════════════════════════════════════
-- Companies — a second, optional login for crew (read-only), plus portal
-- invite tracking, same pattern as jobs.portal_invited_at.
-- ═══════════════════════════════════════════════════════════════════════
alter table companies add column if not exists crew_email text;
alter table companies add column if not exists portal_invited_at timestamptz;
alter table companies add column if not exists portal_last_viewed_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════
-- Work orders — accept/decline lifecycle with signature, matching the
-- same {name, title, signature, date} shape SignaturePad already produces
-- for contracts.
-- ═══════════════════════════════════════════════════════════════════════
alter table work_orders add column if not exists sub_signature jsonb;
alter table work_orders add column if not exists declined_at timestamptz;
alter table work_orders add column if not exists decline_reason text;

alter table work_orders drop constraint if exists work_orders_status_check;
alter table work_orders add constraint work_orders_status_check
  check (status in ('draft','issued','accepted','declined','completed','invoiced','paid'));

-- ═══════════════════════════════════════════════════════════════════════
-- Secure job view — subs never get raw jobs table access (customer PII,
-- contract price, billing info). This view exposes only what a sub needs
-- to actually show up and do the work, and the WHERE clause itself
-- enforces "only jobs where this sub has a work order" — no separate
-- grant or RLS-on-view complexity needed.
-- ═══════════════════════════════════════════════════════════════════════
create or replace view sub_visible_jobs as
select distinct j.id, j.job_number, j.project_address, j.job_type, j.stage, j.expected_close_date
from jobs j
where exists (
  select 1 from work_orders wo
  join companies c on c.id = wo.company_id
  where wo.job_id = j.id
    and (c.contact_email = auth.jwt()->>'email' or c.crew_email = auth.jwt()->>'email')
);

grant select on sub_visible_jobs to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- RLS — a sub (admin or crew login) can see their own company row and
-- their own company's work orders. Everything else about companies/work
-- orders stays admin-only via the existing "for all using (is_admin())"
-- policies, which continue to apply alongside these.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "Sub can view own company" on companies;
create policy "Sub can view own company" on companies for select using (
  contact_email = auth.jwt()->>'email' or crew_email = auth.jwt()->>'email'
);

drop policy if exists "Sub company can view own work orders" on work_orders;
create policy "Sub company can view own work orders" on work_orders for select using (
  exists (
    select 1 from companies c
    where c.id = work_orders.company_id
      and (c.contact_email = auth.jwt()->>'email' or c.crew_email = auth.jwt()->>'email')
  )
);

-- ═══════════════════════════════════════════════════════════════════════
-- Secure functions — a sub can accept/decline/view their own work order
-- without any broad UPDATE grant. Accept/decline are admin-login only
-- (crew is read-only); mark_sub_portal_viewed works for either login.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function accept_work_order(target_work_order_id uuid, signature_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  wo_company_id uuid;
begin
  select company_id into wo_company_id from work_orders where id = target_work_order_id;
  if wo_company_id is null then
    raise exception 'Work order not found';
  end if;
  if not exists (select 1 from companies where id = wo_company_id and contact_email = caller_email) then
    raise exception 'Not authorized to accept this work order';
  end if;
  update work_orders
  set status = 'accepted', accepted_at = now(), sub_signature = signature_payload, declined_at = null, decline_reason = null
  where id = target_work_order_id;
end;
$$;
grant execute on function accept_work_order(uuid, jsonb) to authenticated;

create or replace function decline_work_order(target_work_order_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  wo_company_id uuid;
begin
  select company_id into wo_company_id from work_orders where id = target_work_order_id;
  if wo_company_id is null then
    raise exception 'Work order not found';
  end if;
  if not exists (select 1 from companies where id = wo_company_id and contact_email = caller_email) then
    raise exception 'Not authorized to decline this work order';
  end if;
  update work_orders
  set status = 'declined', declined_at = now(), decline_reason = reason, accepted_at = null, sub_signature = null
  where id = target_work_order_id;
end;
$$;
grant execute on function decline_work_order(uuid, text) to authenticated;

create or replace function mark_sub_portal_viewed(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
begin
  if not exists (
    select 1 from companies where id = target_company_id and (contact_email = caller_email or crew_email = caller_email)
  ) then
    raise exception 'Not authorized';
  end if;
  update companies set portal_last_viewed_at = now() where id = target_company_id;
end;
$$;
grant execute on function mark_sub_portal_viewed(uuid) to authenticated;
