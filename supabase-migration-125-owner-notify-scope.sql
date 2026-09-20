-- Run in Supabase SQL Editor after migration 124. Safe to re-run.
--
-- Two things:
-- 1. Lets a notification ring the staff bell WITHOUT also emailing
--    whoever's configured in Settings → Automation → "Send to". Every
--    existing notification (contract signed, payment received, over
--    budget, schedule stale, new lead, new sub application, sub
--    messages, schedule requests) keeps emailing the owner exactly as
--    before — the new column defaults to true, so nothing already
--    working changes. Only the high-volume, low-signal event added
--    below (field progress) is marked false.
-- 2. New staff-side bell events for actions that previously changed the
--    database in total silence: a work order being accepted/declined,
--    an RFP proposal coming in, a sub uploading their invoice, field
--    progress being updated, a customer or sub sending a message, and a
--    change order being signed or declined.

alter table notifications add column if not exists owner_notify boolean not null default true;

-- ═══════════════════════════════════════════════════════════════════════
-- Gate the existing owner-email webhook (migration 111) on the new flag.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function notify_owner_on_notification()
returns trigger as $$
begin
  if not new.owner_notify then
    return new;
  end if;
  perform net.http_post(
    url := 'https://jobs.mcloudconstruction.com/api/webhooks/notification-created',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer rVKyY75WfWTFNuq64HmY'
    ),
    body := jsonb_build_object('id', new.id, 'message', new.message, 'job_id', new.job_id)
  );
  return new;
end;
$$ language plpgsql security definer;
-- Trigger itself (migration 111) already fires on every insert; nothing
-- to redefine there, only the function body above.

-- ═══════════════════════════════════════════════════════════════════════
-- Work orders — accept / decline (bell + owner email) and field
-- progress (bell only — a job can flip through not_started → in_progress
-- → completed several times a week; that's office awareness, not an
-- inbox-worthy event).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function notify_on_work_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_name text;
  v_job_number text;
begin
  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    select company_name into v_company_name from companies where id = new.company_id;
    select coalesce(job_number, estimate_number, '') into v_job_number from jobs where id = new.job_id;
    insert into notifications (message, job_id, owner_notify)
    values (
      format('%s %s the work order for Job #%s%s.',
        coalesce(v_company_name, 'A subcontractor'),
        new.status,
        v_job_number,
        case when new.status = 'declined' and new.decline_reason is not null then ' — ' || new.decline_reason else '' end
      ),
      new.job_id,
      true
    );
  end if;

  if new.field_progress is distinct from old.field_progress and new.field_progress is not null then
    select company_name into v_company_name from companies where id = new.company_id;
    select coalesce(job_number, estimate_number, '') into v_job_number from jobs where id = new.job_id;
    insert into notifications (message, job_id, owner_notify)
    values (
      format('%s marked field progress "%s" on a work order for Job #%s.',
        coalesce(v_company_name, 'A subcontractor'),
        replace(new.field_progress, '_', ' '),
        v_job_number
      ),
      new.job_id,
      false
    );
  end if;

  if new.sub_invoice_uploaded_at is not null and old.sub_invoice_uploaded_at is null then
    select company_name into v_company_name from companies where id = new.company_id;
    select coalesce(job_number, estimate_number, '') into v_job_number from jobs where id = new.job_id;
    insert into notifications (message, job_id, owner_notify)
    values (
      format('%s uploaded their invoice for a work order on Job #%s.', coalesce(v_company_name, 'A subcontractor'), v_job_number),
      new.job_id,
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists work_orders_notify on work_orders;
create trigger work_orders_notify
  after update on work_orders
  for each row execute function notify_on_work_order_change();

-- ═══════════════════════════════════════════════════════════════════════
-- RFP proposals — a sub responding (bell + owner email).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function notify_on_rfp_proposal_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_name text;
  v_rfp_title text;
  v_job_id uuid;
  v_job_number text;
begin
  if new.responded_at is not null and old.responded_at is null then
    select company_name into v_company_name from companies where id = new.company_id;
    select r.title, r.job_id into v_rfp_title, v_job_id from rfps r where r.id = new.rfp_id;
    select coalesce(job_number, estimate_number, '') into v_job_number from jobs where id = v_job_id;
    insert into notifications (message, job_id, owner_notify)
    values (
      format('%s submitted a proposal for "%s" (Job #%s).', coalesce(v_company_name, 'A subcontractor'), coalesce(v_rfp_title, 'an RFP'), v_job_number),
      v_job_id,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists rfp_recipients_proposal_notify on rfp_recipients;
create trigger rfp_recipients_proposal_notify
  after update on rfp_recipients
  for each row execute function notify_on_rfp_proposal_submitted();

-- ═══════════════════════════════════════════════════════════════════════
-- Change orders — signing (co_signatures->owner appearing) or declining
-- (declined_at appearing) both go through a plain client-side UPDATE
-- (no dedicated RPC funnels them both), so this is a trigger rather than
-- something added inside a single function.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function notify_on_change_order_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_number text;
  v_customer_name text;
  v_co_title text;
begin
  select coalesce(job_number, estimate_number, ''), customer_name into v_job_number, v_customer_name from jobs where id = new.job_id;
  v_co_title := coalesce(nullif(trim(new.description), ''), 'a change order');

  if (new.co_signatures->'owner') is not null and (old.co_signatures->'owner') is null then
    insert into notifications (message, job_id, owner_notify)
    values (format('%s approved %s on Job #%s.', coalesce(v_customer_name, 'The customer'), v_co_title, v_job_number), new.job_id, true);
  end if;

  if new.declined_at is not null and old.declined_at is null then
    insert into notifications (message, job_id, owner_notify)
    values (
      format('%s declined %s on Job #%s%s.', coalesce(v_customer_name, 'The customer'), v_co_title, v_job_number,
        case when new.decline_reason is not null then ' — ' || new.decline_reason else '' end),
      new.job_id, true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists change_orders_decision_notify on change_orders;
create trigger change_orders_decision_notify
  after update on change_orders
  for each row execute function notify_on_change_order_decision();

-- ═══════════════════════════════════════════════════════════════════════
-- job_questions — a customer sending a message rings the staff bell
-- (+ owner email). Staff sending one is handled separately in migration
-- 126, which routes it to the customer's own new notification log instead.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function notify_staff_on_customer_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_number text;
  v_customer_name text;
begin
  if new.sender = 'customer' then
    select coalesce(job_number, estimate_number, ''), customer_name into v_job_number, v_customer_name from jobs where id = new.job_id;
    insert into notifications (message, job_id, owner_notify)
    values (
      format('%s sent a message on Job #%s: "%s"', coalesce(v_customer_name, 'A customer'), v_job_number, left(trim(new.message), 140)),
      new.job_id,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists job_questions_customer_notify on job_questions;
create trigger job_questions_customer_notify
  after insert on job_questions
  for each row execute function notify_staff_on_customer_question();
