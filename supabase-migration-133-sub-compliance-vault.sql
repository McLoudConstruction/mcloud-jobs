-- Run in Supabase SQL Editor after migration 132. Safe to re-run.
--
-- SUB COMPLIANCE VAULT
--
-- Until now a sub's compliance lived as three columns on `companies`
-- (w9_storage_path, coi_storage_path, coi_expires_at — migration 029). That
-- meant: one insurance certificate only (no separate Workers' Comp or
-- Auto), no review step (a sub's self-upload replaced what the office had
-- on file the instant it landed — migration 114), no history, and nothing
-- that ever acted on an expiry date.
--
-- This adds a proper vault:
--   • sub_compliance_docs — one row per uploaded document, with type,
--     carrier, policy number, coverage amount, effective/expiry dates, and
--     a review status (pending_review / approved / rejected / superseded).
--   • Settings: which document types are required (globally, and per
--     company for e.g. a sole proprietor with no employees who is exempt
--     from Workers' Comp), an expiring-soon window, an optional minimum
--     General Liability amount, and an enforcement mode:
--         off   — vault is informational only
--         warn  — staff see warnings but nothing is blocked   (DEFAULT)
--         block — a non-compliant sub can't be issued a work order or
--                 marked paid unless staff record an override reason
--     Default is 'warn' so turning this on can't stop any work until you
--     deliberately choose to.
--   • sub_compliance_summary(company) — the single source of truth for a
--     company's status, used by the UI, the gate, and the reminders.
--   • run_compliance_reminders() — called from the daily cron: notifies the
--     sub (portal bell + email) at the expiring-soon window, at 7 days, and
--     on expiry, once each; and tells the office.
--   • The existing submit_sub_compliance_doc RPC is redefined (same
--     signature, so the currently-deployed Sub Portal keeps working) to
--     drop uploads into the review queue instead of overwriting the
--     office's records. Approved W-9/GL documents are mirrored back onto
--     the old companies columns so every screen that still reads them keeps
--     working.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Settings
-- ═══════════════════════════════════════════════════════════════════════
alter table app_settings add column if not exists compliance_required_types text[] not null default array['w9', 'coi_gl'];
alter table app_settings add column if not exists compliance_enforcement text not null default 'warn';
alter table app_settings add column if not exists compliance_expiring_days integer not null default 30;
alter table app_settings add column if not exists compliance_min_gl_amount numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_compliance_enforcement_check') then
    alter table app_settings add constraint app_settings_compliance_enforcement_check
      check (compliance_enforcement in ('off', 'warn', 'block'));
  end if;
end $$;

-- Per-company: null = follow the global list; empty array = nothing required.
alter table companies add column if not exists compliance_required_override text[];
-- For vendors/suppliers who are in Companies but aren't subject to this.
alter table companies add column if not exists compliance_exempt boolean not null default false;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. The vault
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists sub_compliance_docs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,

  doc_type text not null check (doc_type in ('w9', 'coi_gl', 'coi_wc', 'coi_auto', 'license', 'other')),
  storage_path text not null,
  file_name text,

  carrier text,
  policy_number text,
  coverage_amount numeric,
  effective_date date,
  expires_at date,

  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'superseded')),
  uploaded_by_kind text not null default 'staff' check (uploaded_by_kind in ('staff', 'sub', 'system')),
  uploaded_by_email text,
  reviewed_by_email text,
  reviewed_at timestamptz,
  reject_reason text,
  notes text,

  -- 0 = none sent, 1 = "expiring soon", 2 = "within 7 days", 3 = "expired"
  last_reminder_stage integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sub_compliance_docs_company_idx on sub_compliance_docs (company_id, doc_type, status);
create index if not exists sub_compliance_docs_expiry_idx on sub_compliance_docs (expires_at) where status = 'approved';

alter table sub_compliance_docs enable row level security;

drop policy if exists "Admin can do everything on sub_compliance_docs" on sub_compliance_docs;
create policy "Admin can do everything on sub_compliance_docs" on sub_compliance_docs
  for all using (is_admin()) with check (is_admin());

drop policy if exists "Sub can view own compliance docs" on sub_compliance_docs;
create policy "Sub can view own compliance docs" on sub_compliance_docs
  for select using (is_sub_portal_member(company_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sub_compliance_docs'
  ) then
    alter publication supabase_realtime add table sub_compliance_docs;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. On approval: supersede the older approved doc of the same type, and
--    mirror W-9 / General Liability back onto the legacy companies columns
--    so the existing Subcontractors screens and the marketing/application
--    flows that read them keep working untouched.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function trg_sub_compliance_docs_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status <> 'approved' then
    return NEW;
  end if;

  update sub_compliance_docs
  set status = 'superseded'
  where company_id = NEW.company_id and doc_type = NEW.doc_type and status = 'approved' and id <> NEW.id;

  if NEW.doc_type = 'w9' then
    update companies set w9_storage_path = NEW.storage_path where id = NEW.company_id;
  elsif NEW.doc_type = 'coi_gl' then
    update companies set coi_storage_path = NEW.storage_path, coi_expires_at = NEW.expires_at where id = NEW.company_id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sub_compliance_docs_after_write on sub_compliance_docs;
create trigger trg_sub_compliance_docs_after_write
  after insert or update of status on sub_compliance_docs
  for each row execute function trg_sub_compliance_docs_after_write();

-- Existing W-9 / COI on file become approved vault entries (once).
insert into sub_compliance_docs (company_id, doc_type, storage_path, expires_at, status, uploaded_by_kind, reviewed_by_email, reviewed_at, notes)
select c.id, 'w9', c.w9_storage_path, null, 'approved', 'staff', 'backfill', now(), 'Backfilled from the pre-vault W-9 on file'
from companies c
where c.w9_storage_path is not null and c.w9_storage_path <> ''
  and not exists (select 1 from sub_compliance_docs d where d.company_id = c.id and d.doc_type = 'w9');

insert into sub_compliance_docs (company_id, doc_type, storage_path, expires_at, status, uploaded_by_kind, reviewed_by_email, reviewed_at, notes)
select c.id, 'coi_gl', c.coi_storage_path, c.coi_expires_at, 'approved', 'staff', 'backfill', now(), 'Backfilled from the pre-vault COI on file'
from companies c
where c.coi_storage_path is not null and c.coi_storage_path <> ''
  and not exists (select 1 from sub_compliance_docs d where d.company_id = c.id and d.doc_type = 'coi_gl');

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Status — the one place "is this sub compliant?" is decided
-- ═══════════════════════════════════════════════════════════════════════
create or replace function sub_compliance_summary(target_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s app_settings%rowtype;
  c companies%rowtype;
  req text[];
  t text;
  best sub_compliance_docs%rowtype;
  pending_id uuid;
  rejected_id uuid;
  st text;
  items jsonb := '[]'::jsonb;
  overall text := 'compliant';
  days_left integer;
begin
  if not (is_admin() or is_sub_portal_member(target_company_id) or _is_trusted_context()) then
    raise exception 'Not authorized';
  end if;

  select * into s from app_settings where id = 1;
  select * into c from companies where id = target_company_id;
  if c.id is null then
    return null;
  end if;
  if c.compliance_exempt then
    return jsonb_build_object('overall', 'exempt', 'required', '[]'::jsonb);
  end if;

  req := coalesce(c.compliance_required_override, s.compliance_required_types, array['w9', 'coi_gl']);

  foreach t in array req loop
    -- A document with no expiry (a W-9) never expires; otherwise prefer the
    -- one that's still valid, then the latest-expiring.
    select * into best
    from sub_compliance_docs d
    where d.company_id = target_company_id and d.doc_type = t and d.status = 'approved'
    order by (coalesce(d.expires_at, 'infinity'::date) < current_date), coalesce(d.expires_at, 'infinity'::date) desc
    limit 1;

    select d.id into pending_id from sub_compliance_docs d
      where d.company_id = target_company_id and d.doc_type = t and d.status = 'pending_review'
      order by d.created_at desc limit 1;
    select d.id into rejected_id from sub_compliance_docs d
      where d.company_id = target_company_id and d.doc_type = t and d.status = 'rejected'
      order by d.created_at desc limit 1;

    days_left := null;
    if best.id is not null then
      if best.expires_at is not null then
        days_left := best.expires_at - current_date;
      end if;
      if best.expires_at is not null and best.expires_at < current_date then
        st := 'expired';
      elsif t = 'coi_gl' and s.compliance_min_gl_amount is not null and coalesce(best.coverage_amount, 0) < s.compliance_min_gl_amount then
        st := 'insufficient';
      elsif best.expires_at is not null and best.expires_at <= current_date + s.compliance_expiring_days then
        st := 'expiring';
      else
        st := 'ok';
      end if;
    elsif pending_id is not null then
      st := 'pending';
    elsif rejected_id is not null then
      st := 'rejected';
    else
      st := 'missing';
    end if;

    if st in ('missing', 'expired', 'rejected', 'insufficient', 'pending') then
      overall := 'noncompliant';
    elsif st = 'expiring' and overall = 'compliant' then
      overall := 'expiring';
    end if;

    items := items || jsonb_build_array(jsonb_build_object(
      'doc_type', t,
      'status', st,
      'doc_id', best.id,
      'expires_at', best.expires_at,
      'days_left', days_left,
      'carrier', best.carrier,
      'coverage_amount', best.coverage_amount,
      'pending_doc_id', pending_id,
      'renewal_pending', (best.id is not null and pending_id is not null)
    ));
    best := null;
  end loop;

  return jsonb_build_object('overall', overall, 'required', items);
end;
$$;
grant execute on function sub_compliance_summary(uuid) to authenticated;

create or replace function sub_compliance_overview()
returns table (company_id uuid, company_name text, overall text, summary jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_admin() or _is_trusted_context()) then
    raise exception 'Not authorized';
  end if;
  return query
    select c.id, c.company_name, x.j ->> 'overall', x.j
    from companies c
    cross join lateral (select sub_compliance_summary(c.id) as j) x
    where c.company_type = 'Subcontractor'
    order by c.company_name;
end;
$$;
grant execute on function sub_compliance_overview() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Sub-side upload → review queue
-- ═══════════════════════════════════════════════════════════════════════
create or replace function submit_sub_compliance_doc_v2(
  target_company_id uuid,
  doc_type_in text,
  storage_path_in text,
  file_name_in text default null,
  expires_at_in date default null,
  carrier_in text default null,
  policy_number_in text default null,
  coverage_amount_in numeric default null,
  effective_date_in date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt() ->> 'email';
  new_id uuid;
  company_name_text text;
  type_label text;
begin
  if doc_type_in not in ('w9', 'coi_gl', 'coi_wc', 'coi_auto', 'license', 'other') then
    raise exception 'Invalid document type';
  end if;
  if not exists (
    select 1 from sub_portal_users where company_id = target_company_id and email = caller_email and role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;
  -- The file must be in this company's own compliance folder — otherwise
  -- an upload could point at another company's document.
  if storage_path_in is null or storage_path_in not like ('compliance/' || target_company_id::text || '/%') then
    raise exception 'Upload path does not belong to this company';
  end if;
  if doc_type_in in ('coi_gl', 'coi_wc', 'coi_auto', 'license') and expires_at_in is null then
    raise exception 'An expiration date is required for this document';
  end if;

  insert into sub_compliance_docs (
    company_id, doc_type, storage_path, file_name, expires_at, carrier, policy_number, coverage_amount, effective_date,
    status, uploaded_by_kind, uploaded_by_email
  ) values (
    target_company_id, doc_type_in, storage_path_in, left(file_name_in, 300), expires_at_in, left(carrier_in, 200),
    left(policy_number_in, 100), coverage_amount_in, effective_date_in,
    'pending_review', 'sub', caller_email
  ) returning id into new_id;

  select company_name into company_name_text from companies where id = target_company_id;
  type_label := case doc_type_in
    when 'w9' then 'W-9' when 'coi_gl' then 'General Liability certificate' when 'coi_wc' then 'Workers'' Comp certificate'
    when 'coi_auto' then 'Auto certificate' when 'license' then 'license' else 'document' end;
  insert into notifications (message)
  values (coalesce(company_name_text, 'A subcontractor') || ' uploaded a ' || type_label || ' for review.');

  return new_id;
end;
$$;
grant execute on function submit_sub_compliance_doc_v2(uuid, text, text, text, date, text, text, numeric, date) to authenticated;

-- Same signature the deployed Sub Portal already calls (migration 114).
-- Now routes into the review queue instead of overwriting the office's
-- records directly.
create or replace function submit_sub_compliance_doc(target_company_id uuid, kind text, storage_path_in text, expires_at_in date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if kind not in ('w9', 'coi') then
    raise exception 'Invalid document type';
  end if;
  perform submit_sub_compliance_doc_v2(
    target_company_id,
    case when kind = 'w9' then 'w9' else 'coi_gl' end,
    storage_path_in, null, expires_at_in
  );
end;
$$;
grant execute on function submit_sub_compliance_doc(uuid, text, text, date) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Staff review
-- ═══════════════════════════════════════════════════════════════════════
create or replace function review_sub_compliance_doc(
  target_doc_id uuid,
  approve boolean,
  reject_reason_in text default null,
  expires_at_in date default null,
  carrier_in text default null,
  policy_number_in text default null,
  coverage_amount_in numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d sub_compliance_docs%rowtype;
  reviewer text := auth.jwt() ->> 'email';
  type_label text;
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;
  select * into d from sub_compliance_docs where id = target_doc_id;
  if d.id is null then
    raise exception 'Document not found';
  end if;
  if d.status <> 'pending_review' then
    raise exception 'This document has already been reviewed';
  end if;

  type_label := case d.doc_type
    when 'w9' then 'W-9' when 'coi_gl' then 'General Liability certificate' when 'coi_wc' then 'Workers'' Comp certificate'
    when 'coi_auto' then 'Auto certificate' when 'license' then 'license' else 'document' end;

  if approve then
    if d.doc_type in ('coi_gl', 'coi_wc', 'coi_auto', 'license') and coalesce(expires_at_in, d.expires_at) is null then
      raise exception 'An expiration date is required to approve this document';
    end if;
    update sub_compliance_docs
    set status = 'approved', reviewed_by_email = reviewer, reviewed_at = now(), reject_reason = null,
        expires_at = coalesce(expires_at_in, expires_at),
        carrier = coalesce(nullif(btrim(carrier_in), ''), carrier),
        policy_number = coalesce(nullif(btrim(policy_number_in), ''), policy_number),
        coverage_amount = coalesce(coverage_amount_in, coverage_amount),
        last_reminder_stage = 0
    where id = target_doc_id;

    insert into portal_notifications (recipient_kind, company_id, category, message, link_path, source_id)
    values ('subcontractor', d.company_id, 'compliance_reviewed', 'Your ' || type_label || ' was approved. Thank you!', '/sub-portal/settings', d.id);
  else
    if nullif(btrim(reject_reason_in), '') is null then
      raise exception 'Give a reason so the subcontractor knows what to fix';
    end if;
    update sub_compliance_docs
    set status = 'rejected', reviewed_by_email = reviewer, reviewed_at = now(), reject_reason = btrim(reject_reason_in)
    where id = target_doc_id;

    insert into portal_notifications (recipient_kind, company_id, category, message, link_path, source_id)
    values ('subcontractor', d.company_id, 'compliance_reviewed',
      'Your ' || type_label || ' couldn''t be accepted: ' || btrim(reject_reason_in) || ' Please upload a corrected copy.', '/sub-portal/settings', d.id);
  end if;
end;
$$;
grant execute on function review_sub_compliance_doc(uuid, boolean, text, date, text, text, numeric) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Enforcement — work orders can't be issued to, or paid out to, a
--    non-compliant sub when the mode is 'block', unless staff record why.
-- ═══════════════════════════════════════════════════════════════════════
alter table work_orders add column if not exists compliance_override_reason text;
alter table work_orders add column if not exists compliance_override_by text;
alter table work_orders add column if not exists compliance_override_at timestamptz;

create or replace function trg_work_orders_compliance_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mode text;
  summary jsonb;
  gaps text;
  fresh_override boolean;
begin
  if NEW.status not in ('issued', 'paid') or NEW.status is not distinct from OLD.status or NEW.company_id is null then
    return NEW;
  end if;

  select compliance_enforcement into mode from app_settings where id = 1;
  if coalesce(mode, 'warn') <> 'block' then
    return NEW;
  end if;

  summary := sub_compliance_summary(NEW.company_id);
  if summary is null or summary ->> 'overall' <> 'noncompliant' then
    return NEW;
  end if;

  -- An override counts only if it was supplied in THIS update (a stale one
  -- from an earlier transition doesn't carry over), by staff, with a reason.
  fresh_override := (is_admin() or _is_trusted_context())
    and NEW.compliance_override_at is distinct from OLD.compliance_override_at
    and nullif(btrim(coalesce(NEW.compliance_override_reason, '')), '') is not null;

  if fresh_override then
    NEW.compliance_override_by := coalesce(auth.jwt() ->> 'email', 'system');
    insert into notifications (message, job_id)
    values ('Compliance override on a work order (' || NEW.status || '): ' || btrim(NEW.compliance_override_reason), NEW.job_id);
    return NEW;
  end if;

  select string_agg(
    (case r ->> 'doc_type' when 'w9' then 'W-9' when 'coi_gl' then 'General Liability' when 'coi_wc' then 'Workers'' Comp'
      when 'coi_auto' then 'Auto' when 'license' then 'License' else 'Document' end) || ' (' || (r ->> 'status') || ')', ', ')
  into gaps
  from jsonb_array_elements(summary -> 'required') r
  where r ->> 'status' in ('missing', 'expired', 'rejected', 'insufficient', 'pending');

  raise exception 'COMPLIANCE_BLOCK: this subcontractor is not compliant — %', coalesce(gaps, 'documents outstanding');
end;
$$;

drop trigger if exists trg_work_orders_compliance_gate on work_orders;
create trigger trg_work_orders_compliance_gate
  before update of status on work_orders
  for each row execute function trg_work_orders_compliance_gate();

-- ═══════════════════════════════════════════════════════════════════════
-- 8. Reminders — called once a day from the daily-automations cron.
--    Service-role only.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function run_compliance_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s app_settings%rowtype;
  d record;
  sent integer := 0;
  stage integer;
  label text;
  sub_msg text;
  when_text text;
begin
  if not _is_trusted_context() then
    raise exception 'Not authorized';
  end if;
  select * into s from app_settings where id = 1;

  for d in
    select dd.id, dd.company_id, dd.doc_type, dd.expires_at, dd.last_reminder_stage, c.company_name,
           c.compliance_exempt, coalesce(c.compliance_required_override, s.compliance_required_types) as req
    from sub_compliance_docs dd
    join companies c on c.id = dd.company_id
    where dd.status = 'approved' and dd.expires_at is not null
  loop
    continue when d.compliance_exempt or not (d.doc_type = any (d.req));

    stage := case
      when d.expires_at < current_date then 3
      when d.expires_at <= current_date + 7 then 2
      when d.expires_at <= current_date + s.compliance_expiring_days then 1
      else 0 end;
    continue when stage = 0 or stage <= d.last_reminder_stage;

    label := case d.doc_type when 'w9' then 'W-9' when 'coi_gl' then 'General Liability certificate'
      when 'coi_wc' then 'Workers'' Comp certificate' when 'coi_auto' then 'Auto certificate'
      when 'license' then 'license' else 'document' end;
    when_text := to_char(d.expires_at, 'Mon DD, YYYY');

    if stage = 3 then
      sub_msg := 'Your ' || label || ' expired on ' || when_text || '. Please upload a current one so we can keep scheduling and paying you.';
    else
      sub_msg := 'Your ' || label || ' expires on ' || when_text || '. Please upload the renewed copy.';
    end if;

    insert into portal_notifications (recipient_kind, company_id, category, message, link_path, source_id)
    values ('subcontractor', d.company_id, case when stage = 3 then 'compliance_expired' else 'compliance_expiring' end,
            sub_msg, '/sub-portal/settings', d.id);

    insert into notifications (message)
    values (d.company_name || ': ' || label || case when stage = 3 then ' expired ' else ' expires ' end || when_text || '.');

    update sub_compliance_docs set last_reminder_stage = stage where id = d.id;
    sent := sent + 1;
  end loop;

  return sent;
end;
$$;

revoke all on function run_compliance_reminders() from public, anon, authenticated;
grant execute on function run_compliance_reminders() to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. Legacy writers keep feeding the vault.
--    Several places still write the old companies.w9_storage_path /
--    coi_storage_path / coi_expires_at columns directly (approving a
--    subcontractor application copies them over; a cached copy of the old
--    Subcontractors screen; anything added later). Without this, a sub
--    added that way would show as "missing" in the vault even though a
--    W-9 is plainly on file. A new/changed path becomes an approved vault
--    entry (staff-set, so no review step); an expiry-only edit updates the
--    matching entry. The mirror-back in section 3 lands on the same values,
--    so this can't loop.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function trg_companies_compliance_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.w9_storage_path is not null and NEW.w9_storage_path <> ''
     and (TG_OP = 'INSERT' or NEW.w9_storage_path is distinct from OLD.w9_storage_path) then
    if not exists (
      select 1 from sub_compliance_docs
      where company_id = NEW.id and doc_type = 'w9' and storage_path = NEW.w9_storage_path and status = 'approved'
    ) then
      insert into sub_compliance_docs (company_id, doc_type, storage_path, status, uploaded_by_kind, reviewed_by_email, reviewed_at, notes)
      values (NEW.id, 'w9', NEW.w9_storage_path, 'approved', 'staff', 'sync', now(), 'Synced from the Company record');
    end if;
  end if;

  if NEW.coi_storage_path is not null and NEW.coi_storage_path <> ''
     and (TG_OP = 'INSERT' or NEW.coi_storage_path is distinct from OLD.coi_storage_path) then
    if not exists (
      select 1 from sub_compliance_docs
      where company_id = NEW.id and doc_type = 'coi_gl' and storage_path = NEW.coi_storage_path and status = 'approved'
    ) then
      insert into sub_compliance_docs (company_id, doc_type, storage_path, expires_at, status, uploaded_by_kind, reviewed_by_email, reviewed_at, notes)
      values (NEW.id, 'coi_gl', NEW.coi_storage_path, NEW.coi_expires_at, 'approved', 'staff', 'sync', now(), 'Synced from the Company record');
    end if;
  elsif TG_OP = 'UPDATE' and NEW.coi_storage_path is not null and NEW.coi_expires_at is distinct from OLD.coi_expires_at then
    update sub_compliance_docs
    set expires_at = NEW.coi_expires_at, last_reminder_stage = 0
    where company_id = NEW.id and doc_type = 'coi_gl' and storage_path = NEW.coi_storage_path
      and status = 'approved' and expires_at is distinct from NEW.coi_expires_at;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_companies_compliance_sync on companies;
create trigger trg_companies_compliance_sync
  after insert or update of w9_storage_path, coi_storage_path, coi_expires_at on companies
  for each row execute function trg_companies_compliance_sync();
