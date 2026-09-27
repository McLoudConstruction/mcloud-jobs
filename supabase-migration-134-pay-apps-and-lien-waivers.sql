-- Run in Supabase SQL Editor after migration 133. Safe to re-run.
--
-- PAY APPLICATIONS (AIA G702 / G703 style) + LIEN WAIVERS
--
-- Commercial owners and lenders won't release a draw without a pay
-- application and lien waivers, and a missing waiver holds up the check.
-- This adds:
--   • pay_app_sov_lines — the job's Schedule of Values (G703 rows): one
--     line per piece of the contract, plus one per approved change order.
--   • pay_applications  — one per billing period: numbered, dated, with
--     retainage terms, a status (draft → submitted → approved → paid, or
--     void), the contractor's e-signature, and a frozen snapshot of the
--     computed G702 at the moment of submission. Submitting creates the
--     matching row in `invoices` so the existing invoice / Stripe /
--     QuickBooks flow keeps working; when that invoice is paid the pay
--     app follows.
--   • pay_app_lines     — per application, per SOV line: work completed
--     this period and materials presently stored. Everything else on the
--     G703 (previous, total, % complete, balance, retainage) is computed
--     by lib/payAppMath.js.
--   • lien_waivers      — conditional/unconditional × progress/final, from a
--     sub (or supplier) to McLoud or from McLoud to the owner. The wording
--     is rendered ONCE, in SQL, when the waiver is requested and then
--     frozen — what a sub signs is exactly what's stored. Signing runs
--     through the audited e-signature path from migration 132.
--   • Enforcement, same three modes as the compliance vault (off / warn /
--     block, default 'warn' so nothing stops until you choose): a sub can't
--     be marked paid without a signed waiver on file, and can't be marked
--     paid with one still outstanding, unless staff record an override
--     reason. When a sub IS marked paid, an unconditional waiver is
--     requested automatically to close the loop.
--
-- WORDING: the templates below are generic and have NOT been reviewed by a
-- Missouri construction attorney. Have that done before relying on them or
-- offering them to other contractors — waiver requirements and language
-- vary by state. The template version is stored on every waiver.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Settings & flags
-- ═══════════════════════════════════════════════════════════════════════
alter table app_settings add column if not exists company_legal_name text not null default 'McLoud Contracting, LLC';
alter table app_settings add column if not exists default_retainage_percent numeric not null default 10;
alter table app_settings add column if not exists waiver_enforcement text not null default 'warn';
alter table app_settings add column if not exists waiver_auto_unconditional boolean not null default true;
alter table app_settings add column if not exists waiver_due_days integer not null default 5;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_waiver_enforcement_check') then
    alter table app_settings add constraint app_settings_waiver_enforcement_check
      check (waiver_enforcement in ('off', 'warn', 'block'));
  end if;
end $$;

-- Small residential jobs usually don't need waivers at all.
alter table jobs add column if not exists lien_waivers_optional boolean not null default false;

alter table work_orders add column if not exists waiver_override_reason text;
alter table work_orders add column if not exists waiver_override_by text;
alter table work_orders add column if not exists waiver_override_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Schedule of Values
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists pay_app_sov_lines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  sort_order integer not null default 0,
  item_no text,
  description text not null,
  kind text not null default 'base' check (kind in ('base', 'change_order')),
  change_order_id uuid references change_orders(id) on delete set null,
  scheduled_value numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists pay_app_sov_lines_job_idx on pay_app_sov_lines (job_id, sort_order);
create unique index if not exists pay_app_sov_lines_one_per_co on pay_app_sov_lines (change_order_id) where change_order_id is not null;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Pay applications
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists pay_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  application_no integer,
  period_from date,
  period_to date not null,

  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'paid', 'void')),

  -- G702 header
  owner_name text,
  owner_address text,
  project_name text,
  architect_name text,
  contract_date date,

  retainage_completed_percent numeric(5, 2) not null default 10 check (retainage_completed_percent between 0 and 100),
  retainage_stored_percent numeric(5, 2) not null default 10 check (retainage_stored_percent between 0 and 100),
  -- Cumulative retainage released to date (final billing). Reduces the
  -- retainage held; never below zero.
  retainage_release_to_date numeric(14, 2) not null default 0 check (retainage_release_to_date >= 0),

  notes text,
  signatures jsonb not null default '{}',
  snapshot jsonb,
  invoice_id uuid references invoices(id) on delete set null,

  submitted_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pay_applications_job_no_idx on pay_applications (job_id, application_no);
create index if not exists pay_applications_job_idx on pay_applications (job_id);

create or replace function trg_pay_applications_before_insert()
returns trigger
language plpgsql
as $$
declare
  s app_settings%rowtype;
  j jobs%rowtype;
begin
  if NEW.application_no is null then
    perform pg_advisory_xact_lock(hashtext('pay_app_no:' || NEW.job_id::text));
    select coalesce(max(application_no), 0) + 1 into NEW.application_no from pay_applications where job_id = NEW.job_id;
  end if;
  NEW.created_by := coalesce(NEW.created_by, auth.jwt() ->> 'email');
  return NEW;
end;
$$;

drop trigger if exists trg_pay_applications_before_insert on pay_applications;
create trigger trg_pay_applications_before_insert
  before insert on pay_applications
  for each row execute function trg_pay_applications_before_insert();

create table if not exists pay_app_lines (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pay_applications(id) on delete cascade,
  sov_line_id uuid not null references pay_app_sov_lines(id) on delete cascade,
  -- G703 column E: work completed in THIS period
  work_completed_this_period numeric(14, 2) not null default 0,
  -- G703 column F: materials presently stored (not in D or E)
  materials_stored numeric(14, 2) not null default 0,
  unique (application_id, sov_line_id)
);

-- Once an application leaves draft, its numbers are frozen (a submitted pay
-- app that quietly changes is worse than no pay app). Void it and make a new
-- one. Trusted contexts (SQL editor / service role) can still fix data.
create or replace function trg_pay_app_lines_freeze()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  app_id uuid := coalesce(NEW.application_id, OLD.application_id);
  app_status text;
begin
  if _is_trusted_context() then
    return coalesce(NEW, OLD);
  end if;
  select status into app_status from pay_applications where id = app_id;
  if app_status is not null and app_status <> 'draft' then
    raise exception 'This pay application has been submitted and can no longer be edited. Void it and create a new one to change the numbers.';
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_pay_app_lines_freeze on pay_app_lines;
create trigger trg_pay_app_lines_freeze
  before insert or update or delete on pay_app_lines
  for each row execute function trg_pay_app_lines_freeze();

-- SOV history protection: a line that a submitted (non-void) application
-- already bills against can't be edited or deleted. Adding new lines is fine.
create or replace function trg_pay_app_sov_protect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if _is_trusted_context() then
    return coalesce(NEW, OLD);
  end if;
  if exists (
    select 1 from pay_app_lines l
    join pay_applications a on a.id = l.application_id
    where l.sov_line_id = OLD.id and a.status not in ('draft', 'void')
  ) then
    if TG_OP = 'DELETE' then
      raise exception 'This Schedule of Values line is already billed on a submitted pay application and cannot be deleted';
    end if;
    if NEW.scheduled_value is distinct from OLD.scheduled_value then
      raise exception 'This line is already billed on a submitted pay application; change its value with a change order instead';
    end if;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_pay_app_sov_protect on pay_app_sov_lines;
create trigger trg_pay_app_sov_protect
  before update or delete on pay_app_sov_lines
  for each row execute function trg_pay_app_sov_protect();

-- Status guard + timestamps + updated_at
create or replace function trg_pay_applications_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv_status text;
begin
  NEW.updated_at := now();

  if NEW.status is distinct from OLD.status then
    if OLD.status = 'void' then
      raise exception 'A void pay application cannot be reopened';
    end if;
    if OLD.status = 'paid' and NEW.status <> 'paid' then
      raise exception 'A paid pay application cannot be changed';
    end if;
    if NEW.status = 'submitted' and NEW.submitted_at is null then NEW.submitted_at := now(); end if;
    if NEW.status = 'approved' and NEW.approved_at is null then NEW.approved_at := now(); end if;
    if NEW.status = 'paid' and NEW.paid_at is null then NEW.paid_at := now(); end if;
    if NEW.status = 'void' and NEW.invoice_id is not null then
      select status into inv_status from invoices where id = NEW.invoice_id;
      if inv_status in ('sent', 'paid') then
        raise exception 'The invoice for this pay application has already been sent; it cannot be voided here';
      end if;
    end if;
  end if;

  -- Header + retainage terms freeze at submission (snapshot/status still move).
  if OLD.status not in ('draft') and not _is_trusted_context() then
    if NEW.retainage_completed_percent is distinct from OLD.retainage_completed_percent
       or NEW.retainage_stored_percent is distinct from OLD.retainage_stored_percent
       or NEW.retainage_release_to_date is distinct from OLD.retainage_release_to_date
       or NEW.period_to is distinct from OLD.period_to
       or NEW.period_from is distinct from OLD.period_from
       or NEW.snapshot is distinct from OLD.snapshot then
      raise exception 'This pay application has been submitted; its figures are frozen';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_pay_applications_before_update on pay_applications;
create trigger trg_pay_applications_before_update
  before update on pay_applications
  for each row execute function trg_pay_applications_before_update();

-- Signatures on a pay application (G702 contractor certification) go
-- through the same audited path as contracts. Staff-only for now.
create or replace function trg_pay_applications_signature_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  old_p jsonb;
  new_p jsonb;
  actor_staff boolean := coalesce(is_admin(), false) or _is_trusted_context();
  snap jsonb;
  captured jsonb;
  had_old boolean;
begin
  if NEW.signatures is not distinct from OLD.signatures then
    return NEW;
  end if;
  if not actor_staff then
    raise exception 'Only staff can sign a pay application';
  end if;

  snap := (to_jsonb(NEW) - 'signatures');

  for k in
    select jsonb_object_keys(coalesce(OLD.signatures, '{}'::jsonb))
    union
    select jsonb_object_keys(coalesce(NEW.signatures, '{}'::jsonb))
  loop
    old_p := OLD.signatures -> k;
    new_p := NEW.signatures -> k;
    if new_p is not distinct from old_p then continue; end if;
    if k not in ('contractor', 'owner') then
      raise exception 'Unknown pay application signature role: %', k;
    end if;
    had_old := old_p is not null and jsonb_typeof(old_p) = 'object';
    if not had_old and (new_p is null or jsonb_typeof(new_p) <> 'object') then
      NEW.signatures := NEW.signatures - k;
      continue;
    end if;
    captured := _capture_signature('pay_app', NEW.id, NEW.job_id, k, old_p, new_p, snap,
      case when had_old and OLD.status <> 'draft' then 'Changed after the pay application was submitted' end);
    if captured is null then
      NEW.signatures := NEW.signatures - k;
    else
      NEW.signatures := jsonb_set(NEW.signatures, array[k], captured);
    end if;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_pay_applications_signature_audit on pay_applications;
create trigger trg_pay_applications_signature_audit
  before update of signatures on pay_applications
  for each row execute function trg_pay_applications_signature_audit();

-- When the linked invoice is paid, the pay application follows.
create or replace function trg_invoices_sync_pay_app()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'paid' and OLD.status is distinct from 'paid' then
    update pay_applications
    set status = 'paid', paid_at = coalesce(NEW.paid_at, now())
    where invoice_id = NEW.id and status in ('submitted', 'approved');
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_invoices_sync_pay_app on invoices;
create trigger trg_invoices_sync_pay_app
  after update of status on invoices
  for each row execute function trg_invoices_sync_pay_app();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Lien waivers
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists lien_waivers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  direction text not null check (direction in ('from_sub', 'to_owner')),
  company_id uuid references companies(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  pay_app_id uuid references pay_applications(id) on delete set null,

  waiver_type text not null check (waiver_type in ('conditional_progress', 'unconditional_progress', 'conditional_final', 'unconditional_final')),
  claimant_name text,
  through_date date not null,
  payment_amount numeric(14, 2) not null check (payment_amount >= 0),

  status text not null default 'requested' check (status in ('requested', 'signed', 'rejected', 'void', 'waived')),
  template_version text,
  body_text text,

  signature jsonb,
  signed_at timestamptz,
  reject_reason text,
  notes text,

  requested_by text,
  requested_at timestamptz not null default now(),
  due_date date,
  created_at timestamptz not null default now(),

  constraint lien_waivers_direction_company check (direction = 'to_owner' or company_id is not null)
);
create index if not exists lien_waivers_job_idx on lien_waivers (job_id, status);
create index if not exists lien_waivers_company_idx on lien_waivers (company_id, status);
create index if not exists lien_waivers_pay_app_idx on lien_waivers (pay_app_id);

-- Canonical wording. One place, so a waiver's text is identical whether staff
-- requested it by hand or the system generated it after a payment.
create or replace function render_lien_waiver_text(
  waiver_type_in text,
  claimant_in text,
  owner_in text,
  property_in text,
  contractor_in text,
  through_in date,
  amount_in numeric
)
returns text
language plpgsql
immutable
as $$
declare
  amt text := to_char(amount_in, 'FM$999,999,999,990.00');
  thru text := to_char(through_in, 'FMMonth FMDD, YYYY');
  title text;
  scope_text text;
  release_text text;
  is_final boolean := waiver_type_in like '%final';
begin
  title := case waiver_type_in
    when 'conditional_progress' then 'CONDITIONAL WAIVER AND RELEASE OF LIEN — PROGRESS PAYMENT'
    when 'unconditional_progress' then 'UNCONDITIONAL WAIVER AND RELEASE OF LIEN — PROGRESS PAYMENT'
    when 'conditional_final' then 'CONDITIONAL WAIVER AND RELEASE OF LIEN — FINAL PAYMENT'
    else 'UNCONDITIONAL WAIVER AND RELEASE OF LIEN — FINAL PAYMENT' end;

  scope_text := case when is_final
    then 'This release covers the final payment for all labor, services, equipment, and materials furnished by the Claimant to the project, including any retainage, and releases all lien and bond rights the Claimant has on the project.'
    else 'This release covers a progress payment only, for labor, services, equipment, and materials furnished through the date above. It does not cover retainage, pending modifications and changes, or any labor, services, equipment, or materials furnished after that date.' end;

  if waiver_type_in like 'conditional%' then
    release_text := 'Upon receipt by the Claimant of payment in the amount of ' || amt
      || ', and once that payment has cleared the bank on which it is drawn, this document becomes effective to release any mechanic''s lien, stop-payment notice, and bond right the Claimant may have on the project described above, to the extent of the labor, services, equipment, and materials furnished to ' || contractor_in || ' through ' || thru || '. This document is not effective until that payment has been received and has cleared.';
  else
    release_text := 'The Claimant acknowledges that it has been paid and has received ' || case when is_final then 'final payment' else 'a progress payment' end
      || ' in the amount of ' || amt || ', and waives and releases any mechanic''s lien, stop-payment notice, and bond right the Claimant may have on the project described above, to the extent of the labor, services, equipment, and materials furnished to ' || contractor_in || ' through ' || thru || '.';
  end if;

  return title || E'\n\n'
    || 'Project: ' || coalesce(nullif(btrim(property_in), ''), '(address not on file)') || E'\n'
    || 'Owner: ' || coalesce(nullif(btrim(owner_in), ''), '(owner not on file)') || E'\n'
    || 'Contractor: ' || contractor_in || E'\n'
    || 'Claimant: ' || claimant_in || E'\n'
    || 'Through date: ' || thru || E'\n'
    || 'Amount: ' || amt || E'\n\n'
    || release_text || E'\n\n'
    || scope_text || E'\n\n'
    || 'The Claimant certifies that it has paid, or will use the funds received from this payment to promptly pay in full, all of its laborers, subcontractors, and suppliers for the labor, services, equipment, and materials covered by this document. Before relying on this document, any recipient should verify evidence of payment to the Claimant.';
end;
$$;

create or replace function _waiver_type_label(t text)
returns text
language sql
immutable
as $$
  select case t
    when 'conditional_progress' then 'conditional progress'
    when 'unconditional_progress' then 'unconditional progress'
    when 'conditional_final' then 'conditional final'
    else 'unconditional final' end;
$$;

create or replace function trg_lien_waivers_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s app_settings%rowtype;
  j jobs%rowtype;
  comp companies%rowtype;
  prop text;
begin
  select * into s from app_settings where id = 1;
  select * into j from jobs where id = NEW.job_id;
  if j.id is null then
    raise exception 'Job not found';
  end if;

  if NEW.direction = 'from_sub' then
    select * into comp from companies where id = NEW.company_id;
    NEW.claimant_name := coalesce(nullif(btrim(NEW.claimant_name), ''), comp.company_name);
    NEW.due_date := coalesce(NEW.due_date, current_date + s.waiver_due_days);
  else
    NEW.claimant_name := coalesce(nullif(btrim(NEW.claimant_name), ''), s.company_legal_name);
  end if;

  prop := coalesce(nullif(btrim(j.project_address), ''),
    nullif(concat_ws(', ', nullif(j.project_street, ''), nullif(j.project_city, ''), nullif(j.project_state, ''), nullif(j.project_zip, '')), ''));

  if NEW.body_text is null or btrim(NEW.body_text) = '' then
    NEW.body_text := render_lien_waiver_text(
      NEW.waiver_type, NEW.claimant_name, coalesce(nullif(j.company_name, ''), j.customer_name), prop,
      s.company_legal_name, NEW.through_date, NEW.payment_amount
    );
  end if;
  NEW.template_version := coalesce(NEW.template_version, 'v1-generic');
  NEW.requested_by := coalesce(NEW.requested_by, auth.jwt() ->> 'email', 'system');
  NEW.status := 'requested';
  NEW.signature := null;
  NEW.signed_at := null;
  return NEW;
end;
$$;

drop trigger if exists trg_lien_waivers_before_insert on lien_waivers;
create trigger trg_lien_waivers_before_insert
  before insert on lien_waivers
  for each row execute function trg_lien_waivers_before_insert();

-- Tell the sub the moment a waiver is requested (bell + email via the
-- existing portal-notification webhook).
create or replace function trg_lien_waivers_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j_number text;
begin
  if NEW.direction = 'from_sub' and NEW.company_id is not null then
    select coalesce(job_number, estimate_number) into j_number from jobs where id = NEW.job_id;
    insert into portal_notifications (recipient_kind, company_id, job_id, category, message, link_path, source_id)
    values ('subcontractor', NEW.company_id, NEW.job_id, 'lien_waiver_requested',
      'McLoud Construction is requesting a ' || _waiver_type_label(NEW.waiver_type) || ' lien waiver for '
        || to_char(NEW.payment_amount, 'FM$999,999,990.00') || ' through ' || to_char(NEW.through_date, 'FMMon FMDD, YYYY')
        || case when j_number is not null then ' (job #' || j_number || ')' else '' end || '. Please review and sign.',
      '/sub-portal/waivers', NEW.id);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_lien_waivers_after_insert on lien_waivers;
create trigger trg_lien_waivers_after_insert
  after insert on lien_waivers
  for each row execute function trg_lien_waivers_after_insert();

-- Update rules: a waiver's terms freeze once it's signed; signing is
-- validated + audited; only staff can sign the owner-facing one.
create or replace function trg_lien_waivers_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_staff boolean := coalesce(is_admin(), false) or _is_trusted_context();
  captured jsonb;
  had_sig boolean := OLD.signature is not null and jsonb_typeof(OLD.signature) = 'object';
  has_sig boolean := NEW.signature is not null and jsonb_typeof(NEW.signature) = 'object';
  j_number text;
begin
  -- Terms and wording are immutable after the request goes out.
  if NEW.body_text is distinct from OLD.body_text
     or NEW.payment_amount is distinct from OLD.payment_amount
     or NEW.through_date is distinct from OLD.through_date
     or NEW.waiver_type is distinct from OLD.waiver_type
     or NEW.company_id is distinct from OLD.company_id
     or NEW.job_id is distinct from OLD.job_id
     or NEW.direction is distinct from OLD.direction then
    if not (_is_trusted_context()) then
      raise exception 'A lien waiver''s terms cannot be changed after it is requested. Void it and request a new one.';
    end if;
  end if;

  if OLD.status = 'signed' and NEW.status not in ('signed', 'void') then
    raise exception 'A signed lien waiver can only be voided';
  end if;
  if OLD.status = 'void' and NEW.status <> 'void' then
    raise exception 'A void lien waiver cannot be reopened';
  end if;

  if NEW.signature is distinct from OLD.signature then
    if had_sig then
      raise exception 'This lien waiver has already been signed';
    end if;
    if not has_sig then
      NEW.signature := null;
    else
      if OLD.status <> 'requested' then
        raise exception 'Only a waiver that is currently requested can be signed';
      end if;
      if NEW.direction = 'to_owner' and not actor_staff then
        raise exception 'Only staff can sign the owner waiver';
      end if;
      captured := _capture_signature(
        'lien_waiver', NEW.id, NEW.job_id,
        case when NEW.direction = 'from_sub' then 'sub' else 'contractor' end,
        OLD.signature, NEW.signature,
        to_jsonb(NEW) - 'signature', null
      );
      NEW.signature := captured;
      NEW.status := 'signed';
      NEW.signed_at := now();
    end if;
  end if;

  if NEW.status is distinct from OLD.status and NEW.status = 'signed' and NEW.signature is null then
    raise exception 'A lien waiver can only be marked signed by signing it';
  end if;

  -- Tell the office when a sub signs or pushes back.
  if NEW.direction = 'from_sub' and NEW.status is distinct from OLD.status and NEW.status in ('signed', 'rejected') then
    select coalesce(job_number, estimate_number) into j_number from jobs where id = NEW.job_id;
    insert into notifications (message, job_id)
    values (
      coalesce(NEW.claimant_name, 'A subcontractor')
        || case when NEW.status = 'signed' then ' signed a ' || _waiver_type_label(NEW.waiver_type) || ' lien waiver ('
                                              || to_char(NEW.payment_amount, 'FM$999,999,990.00') || ')'
                else ' questioned a ' || _waiver_type_label(NEW.waiver_type) || ' lien waiver'
                  || coalesce(': ' || left(NEW.reject_reason, 140), '') end
        || case when j_number is not null then ' on job #' || j_number else '' end || '.',
      NEW.job_id);
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_lien_waivers_before_update on lien_waivers;
create trigger trg_lien_waivers_before_update
  before update on lien_waivers
  for each row execute function trg_lien_waivers_before_update();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Sub-side RPCs
-- ═══════════════════════════════════════════════════════════════════════
create or replace function sign_lien_waiver(target_waiver_id uuid, signature_payload jsonb, confirmed_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w lien_waivers%rowtype;
begin
  select * into w from lien_waivers where id = target_waiver_id;
  if w.id is null or w.direction <> 'from_sub' or w.company_id is null then
    raise exception 'Waiver not found';
  end if;
  if not exists (
    select 1 from sub_portal_users where company_id = w.company_id and lower(email) = lower(auth.jwt() ->> 'email') and role = 'admin'
  ) then
    raise exception 'Not authorized to sign this waiver';
  end if;
  if w.status <> 'requested' then
    raise exception 'This waiver is no longer awaiting a signature';
  end if;
  if confirmed_amount is null or confirmed_amount <> w.payment_amount then
    raise exception 'The amount you confirmed does not match this waiver';
  end if;
  -- A release of lien rights is a legal document: the sub must have ticked
  -- the e-sign consent box, not just drawn a signature.
  if coalesce(signature_payload ->> 'consent', '') <> 'true' then
    raise exception 'Electronic signature consent is required to sign a lien waiver';
  end if;
  update lien_waivers set signature = signature_payload where id = target_waiver_id;
end;
$$;
grant execute on function sign_lien_waiver(uuid, jsonb, numeric) to authenticated;

create or replace function dispute_lien_waiver(target_waiver_id uuid, note_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w lien_waivers%rowtype;
begin
  select * into w from lien_waivers where id = target_waiver_id;
  if w.id is null or w.direction <> 'from_sub' or w.company_id is null then
    raise exception 'Waiver not found';
  end if;
  if not exists (
    select 1 from sub_portal_users where company_id = w.company_id and lower(email) = lower(auth.jwt() ->> 'email') and role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;
  if w.status <> 'requested' then
    raise exception 'This waiver is no longer awaiting a signature';
  end if;
  if nullif(btrim(note_in), '') is null then
    raise exception 'Tell us what needs to change';
  end if;
  update lien_waivers set status = 'rejected', reject_reason = btrim(note_in) where id = target_waiver_id;
end;
$$;
grant execute on function dispute_lien_waiver(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Enforcement on work orders being marked paid
-- ═══════════════════════════════════════════════════════════════════════
create or replace function trg_work_orders_waiver_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mode text;
  optional_job boolean;
  has_signed boolean;
  has_open boolean;
  fresh_override boolean;
  reason_text text;
begin
  if NEW.status <> 'paid' or NEW.status is not distinct from OLD.status or NEW.company_id is null then
    return NEW;
  end if;

  select waiver_enforcement into mode from app_settings where id = 1;
  if coalesce(mode, 'warn') <> 'block' then
    return NEW;
  end if;
  select coalesce(lien_waivers_optional, false) into optional_job from jobs where id = NEW.job_id;
  if optional_job then
    return NEW;
  end if;

  select exists (
    select 1 from lien_waivers w
    where w.direction = 'from_sub' and w.status in ('signed', 'waived')
      and (w.work_order_id = NEW.id or (w.job_id = NEW.job_id and w.company_id = NEW.company_id))
  ) into has_signed;
  select exists (
    select 1 from lien_waivers w
    where w.direction = 'from_sub' and w.status in ('requested', 'rejected')
      and (w.work_order_id = NEW.id or (w.job_id = NEW.job_id and w.company_id = NEW.company_id))
  ) into has_open;

  if has_signed and not has_open then
    return NEW;
  end if;

  fresh_override := (is_admin() or _is_trusted_context())
    and NEW.waiver_override_at is distinct from OLD.waiver_override_at
    and nullif(btrim(coalesce(NEW.waiver_override_reason, '')), '') is not null;

  if fresh_override then
    NEW.waiver_override_by := coalesce(auth.jwt() ->> 'email', 'system');
    insert into notifications (message, job_id)
    values ('Lien waiver override on a work order payment: ' || btrim(NEW.waiver_override_reason), NEW.job_id);
    return NEW;
  end if;

  reason_text := case when has_open then 'a lien waiver is still outstanding for this subcontractor' else 'no signed lien waiver is on file for this subcontractor' end;
  raise exception 'WAIVER_BLOCK: cannot mark paid — %', reason_text;
end;
$$;

drop trigger if exists trg_work_orders_waiver_gate on work_orders;
create trigger trg_work_orders_waiver_gate
  before update of status on work_orders
  for each row execute function trg_work_orders_waiver_gate();

-- When a sub is paid, ask for the unconditional waiver that closes the loop
-- (only if they signed a conditional one and no unconditional is pending or
-- signed yet).
create or replace function trg_work_orders_paid_waiver_followup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s app_settings%rowtype;
  optional_job boolean;
  cond lien_waivers%rowtype;
  target_type text;
begin
  if NEW.status <> 'paid' or OLD.status is not distinct from 'paid' or NEW.company_id is null then
    return NEW;
  end if;
  select * into s from app_settings where id = 1;
  if not coalesce(s.waiver_auto_unconditional, true) then
    return NEW;
  end if;
  select coalesce(lien_waivers_optional, false) into optional_job from jobs where id = NEW.job_id;
  if optional_job then
    return NEW;
  end if;

  select * into cond from lien_waivers w
  where w.direction = 'from_sub' and w.status = 'signed' and w.waiver_type like 'conditional%'
    and (w.work_order_id = NEW.id or (w.job_id = NEW.job_id and w.company_id = NEW.company_id))
  order by w.through_date desc, w.created_at desc
  limit 1;
  if cond.id is null then
    return NEW;
  end if;

  target_type := replace(cond.waiver_type, 'conditional', 'unconditional');
  if exists (
    select 1 from lien_waivers w
    where w.direction = 'from_sub' and w.company_id = cond.company_id and w.job_id = cond.job_id
      and w.waiver_type = target_type and w.status in ('requested', 'signed', 'waived')
      and w.through_date >= cond.through_date
  ) then
    return NEW;
  end if;

  insert into lien_waivers (job_id, direction, company_id, work_order_id, pay_app_id, waiver_type, through_date, payment_amount, notes)
  values (cond.job_id, 'from_sub', cond.company_id, NEW.id, cond.pay_app_id, target_type, cond.through_date, cond.payment_amount,
          'Requested automatically after this work order was marked paid.');
  return NEW;
end;
$$;

drop trigger if exists trg_work_orders_paid_waiver_followup on work_orders;
create trigger trg_work_orders_paid_waiver_followup
  after update of status on work_orders
  for each row execute function trg_work_orders_paid_waiver_followup();

-- ═══════════════════════════════════════════════════════════════════════
-- 7. RLS + realtime
-- ═══════════════════════════════════════════════════════════════════════
alter table pay_app_sov_lines enable row level security;
alter table pay_applications enable row level security;
alter table pay_app_lines enable row level security;
alter table lien_waivers enable row level security;

drop policy if exists "Admin can do everything on pay_app_sov_lines" on pay_app_sov_lines;
create policy "Admin can do everything on pay_app_sov_lines" on pay_app_sov_lines for all using (is_admin()) with check (is_admin());
drop policy if exists "Admin can do everything on pay_applications" on pay_applications;
create policy "Admin can do everything on pay_applications" on pay_applications for all using (is_admin()) with check (is_admin());
drop policy if exists "Admin can do everything on pay_app_lines" on pay_app_lines;
create policy "Admin can do everything on pay_app_lines" on pay_app_lines for all using (is_admin()) with check (is_admin());
drop policy if exists "Admin can do everything on lien_waivers" on lien_waivers;
create policy "Admin can do everything on lien_waivers" on lien_waivers for all using (is_admin()) with check (is_admin());

-- A sub sees only waivers requested from their own company. Writes go
-- through sign_lien_waiver / dispute_lien_waiver, never directly.
drop policy if exists "Sub can view own lien waivers" on lien_waivers;
create policy "Sub can view own lien waivers" on lien_waivers
  for select using (direction = 'from_sub' and company_id is not null and is_sub_portal_member(company_id));

do $$
declare
  t text;
begin
  foreach t in array array['pay_applications', 'pay_app_lines', 'pay_app_sov_lines', 'lien_waivers'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
