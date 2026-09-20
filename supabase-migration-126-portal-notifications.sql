-- Run in Supabase SQL Editor after migration 125. Safe to re-run.
--
-- The `notifications` table (migration 014) has never had a reader but
-- the office — its RLS only lets is_admin() select. Customers and subs
-- have had no notification log of their own at all, so "a customer/sub
-- gets a badge when X happens" needs a real table, not a slice of the
-- existing one.
--
-- portal_notifications is that table: one row per event, scoped to
-- either a customer (by job_id, via the same has_job_portal_access()
-- every other customer-facing policy already uses) or a subcontractor
-- (by company_id, via is_sub_portal_member()). Same AFTER INSERT →
-- pg_net webhook → email pattern as migration 111, so every row here
-- both lights up that portal's notification bell AND sends an email —
-- unlike the staff notifications table, there's no owner_notify-style
-- opt-out column here, because "you got a message" / "you were
-- awarded this RFP" *is* the point of the email, not a side effect of
-- an internal alert.

create table if not exists portal_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_kind text not null check (recipient_kind in ('customer', 'subcontractor')),
  job_id uuid references jobs(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  category text not null default 'general',
  message text not null,
  link_path text,
  source_id uuid, -- optional pointer back to the row that caused this (e.g. rfp_recipients.id) — lets the webhook re-look-up details instead of stuffing them all into the message
  meta jsonb not null default '{}'::jsonb, -- small bag of extra fields the webhook needs verbatim (e.g. {"decline_reason": "..."} for a failed payment) rather than parsing them back out of message
  read_at timestamptz,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint portal_notifications_recipient_check check (
    (recipient_kind = 'customer' and job_id is not null)
    or (recipient_kind = 'subcontractor' and company_id is not null)
  )
);

create index if not exists portal_notifications_job_id_idx on portal_notifications(job_id);
create index if not exists portal_notifications_company_id_idx on portal_notifications(company_id);

alter table portal_notifications enable row level security;

drop policy if exists "Admin can do everything on portal_notifications" on portal_notifications;
create policy "Admin can do everything on portal_notifications" on portal_notifications
  for all using (is_admin()) with check (is_admin());

-- No client-side insert policy for either side — every row here is
-- written by a security-definer trigger function below, which bypasses
-- RLS by design (same reasoning as send_sub_message writing directly
-- into notifications).

drop policy if exists "Customers can view their own portal notifications" on portal_notifications;
create policy "Customers can view their own portal notifications" on portal_notifications
  for select using (recipient_kind = 'customer' and has_job_portal_access(job_id));

drop policy if exists "Customers can mark their own portal notifications read" on portal_notifications;
create policy "Customers can mark their own portal notifications read" on portal_notifications
  for update using (recipient_kind = 'customer' and has_job_portal_access(job_id))
  with check (recipient_kind = 'customer' and has_job_portal_access(job_id));

drop policy if exists "Subs can view their own portal notifications" on portal_notifications;
create policy "Subs can view their own portal notifications" on portal_notifications
  for select using (recipient_kind = 'subcontractor' and is_sub_portal_member(company_id));

drop policy if exists "Subs can mark their own portal notifications read" on portal_notifications;
create policy "Subs can mark their own portal notifications read" on portal_notifications
  for update using (recipient_kind = 'subcontractor' and is_sub_portal_member(company_id))
  with check (recipient_kind = 'subcontractor' and is_sub_portal_member(company_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portal_notifications'
  ) then
    alter publication supabase_realtime add table portal_notifications;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Mark-read helpers — mirror the mark_sub_messages_read /
-- mark_staff_messages_read pattern (migration 114) rather than opening a
-- second, looser UPDATE policy for bulk "mark all read" actions.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function mark_customer_notifications_read(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;
  update portal_notifications set read_at = now()
  where recipient_kind = 'customer' and job_id = target_job_id and read_at is null;
end;
$$;
grant execute on function mark_customer_notifications_read(uuid) to authenticated;

create or replace function mark_sub_notifications_read(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_sub_portal_member(target_company_id) then
    raise exception 'Not authorized';
  end if;
  update portal_notifications set read_at = now()
  where recipient_kind = 'subcontractor' and company_id = target_company_id and read_at is null;
end;
$$;
grant execute on function mark_sub_notifications_read(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Webhook fan-out — every insert here also emails the recipient. Reuses
-- the NOTIFICATION_WEBHOOK_SECRET already set up for migration 111
-- rather than introducing a second secret to configure.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function notify_portal_recipient()
returns trigger as $$
begin
  perform net.http_post(
    url := 'https://jobs.mcloudconstruction.com/api/webhooks/portal-notification-created',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer rVKyY75WfWTFNuq64HmY'
    ),
    body := jsonb_build_object(
      'id', new.id,
      'recipient_kind', new.recipient_kind,
      'job_id', new.job_id,
      'company_id', new.company_id,
      'category', new.category,
      'message', new.message,
      'source_id', new.source_id,
      'meta', new.meta
    )
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists portal_notifications_notify_recipient on portal_notifications;
create trigger portal_notifications_notify_recipient
  after insert on portal_notifications
  for each row execute function notify_portal_recipient();

-- ═══════════════════════════════════════════════════════════════════════
-- Source #1 — RFP awarded. rfps.awarded_company_id / rfp_recipients each
-- get their status flipped to 'awarded' by award_rfp() (migration 113);
-- this only needs to watch rfp_recipients, since every recipient row
-- (awarded or not) lives there and the awarded one is the only company
-- that should hear about it.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function notify_sub_on_rfp_awarded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rfp_title text;
  v_job_id uuid;
begin
  if new.status = 'awarded' and old.status is distinct from 'awarded' then
    select title, job_id into v_rfp_title, v_job_id from rfps where id = new.rfp_id;
    insert into portal_notifications (recipient_kind, company_id, job_id, category, message, link_path, source_id)
    values (
      'subcontractor',
      new.company_id,
      v_job_id,
      'rfp_awarded',
      format('You''ve been awarded "%s".', coalesce(v_rfp_title, 'an RFP')),
      '/sub-portal/rfps',
      new.rfp_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists rfp_recipients_awarded_notify on rfp_recipients;
create trigger rfp_recipients_awarded_notify
  after update on rfp_recipients
  for each row execute function notify_sub_on_rfp_awarded();

-- ═══════════════════════════════════════════════════════════════════════
-- Source #2 — a message arriving. Each direction already has its own
-- table/insert path; this just adds the customer/sub-facing half that
-- was missing (the staff-facing half — sub → staff, customer → staff —
-- is migration 125's job, since that one rings the EXISTING staff bell).
-- ═══════════════════════════════════════════════════════════════════════
create or replace function notify_customer_on_staff_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender = 'admin' then
    insert into portal_notifications (recipient_kind, job_id, category, message, link_path)
    values ('customer', new.job_id, 'message', 'You received a new message from McLoud Construction. Visit your Portal to see it.', '/customerportal/inbox');
  end if;
  return new;
end;
$$;

drop trigger if exists job_questions_staff_notify on job_questions;
create trigger job_questions_staff_notify
  after insert on job_questions
  for each row execute function notify_customer_on_staff_message();

create or replace function notify_sub_on_staff_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender = 'staff' then
    insert into portal_notifications (recipient_kind, company_id, job_id, category, message, link_path)
    values ('subcontractor', new.company_id, new.job_id, 'message', 'You received a new message from McLoud Construction. Visit your Portal to see it.', '/sub-portal/messages');
  end if;
  return new;
end;
$$;

drop trigger if exists sub_messages_staff_notify on sub_messages;
create trigger sub_messages_staff_notify
  after insert on sub_messages
  for each row execute function notify_sub_on_staff_message();
