-- Migration 142 — Punch list review workflow + customer blackout dates
--
-- PART A — Punch list as a reviewed, published list
--
--   Staff build the list (draft) → publish it to the customer (customer_review)
--   → the customer reviews it, can add items (with photos) and submits it
--   (approve as-is, or submit with additions) → it lands back on staff
--   (staff_review) → staff accept or decline the customer's additions and
--   publish the final, read-only list to everyone (final) → staff send it to
--   the subcontractors for scheduling (sent_to_subs_at), which starts a
--   "schedule these by <date>" clock set by app_settings.punch_schedule_days.
--
--   punch_lists holds that state, one row per job. Individual items stay in
--   punch_items (migration 137); customer-added ones carry
--   review_state = 'pending' until staff accept them.
--
--   Subs no longer see a punch item the moment it is assigned — only once the
--   list is final. (Warranty repairs are unchanged.)
--
-- PART B — Customer blackout dates
--
--   After the contract is signed a customer can enter dates they can't have
--   crews on site. A request with at least app_settings.blackout_notice_days
--   (default 14) of notice is applied to the published schedule automatically
--   (by /api/portal/blackout) and flagged for staff; anything shorter waits
--   for staff review before the schedule is touched. Either way staff review
--   the request and then submit it on to the subcontractors.
--
-- Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════
-- Settings
-- ═══════════════════════════════════════════════════════════════════════
alter table app_settings add column if not exists punch_schedule_days integer not null default 5;
alter table app_settings add column if not exists blackout_notice_days integer not null default 14;

-- ═══════════════════════════════════════════════════════════════════════
-- PART A — Punch list review
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists punch_lists (
  job_id uuid primary key references jobs(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'customer_review', 'staff_review', 'final')),
  customer_approved boolean,             -- true = approved with no additions; false = submitted with additions; null = not yet submitted
  customer_note text,
  published_to_customer_at timestamptz,
  customer_submitted_at timestamptz,
  final_published_at timestamptz,
  sent_to_subs_at timestamptz,
  schedule_by date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table punch_lists enable row level security;
drop policy if exists "Admin can do everything on punch_lists" on punch_lists;
create policy "Admin can do everything on punch_lists" on punch_lists for all using (is_admin()) with check (is_admin());
drop policy if exists "Customers can view a published punch list" on punch_lists;
create policy "Customers can view a published punch list" on punch_lists for select
  using (status <> 'draft' and has_job_portal_access(job_id));
drop policy if exists "Subs can view a final punch list" on punch_lists;
create policy "Subs can view a final punch list" on punch_lists for select
  using (status = 'final' and exists (
    select 1 from punch_items i where i.job_id = punch_lists.job_id and i.kind = 'punch'
      and i.assigned_company_id is not null and is_sub_portal_member(i.assigned_company_id)));

alter table punch_items add column if not exists review_state text not null default 'approved';
alter table punch_items drop constraint if exists punch_items_review_state_check;
alter table punch_items add constraint punch_items_review_state_check check (review_state in ('approved', 'pending'));

create or replace function _punch_list_final(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select status = 'final' from punch_lists where job_id = target_job_id), false);
$$;

-- Subs: punch items only once the list is final; warranty repairs as before.
drop policy if exists "Subs can view items assigned to them" on punch_items;
create policy "Subs can view items assigned to them" on punch_items for select using (
  assigned_company_id is not null
  and is_sub_portal_member(assigned_company_id)
  and (kind = 'warranty' or (review_state = 'approved' and _punch_list_final(job_id)))
);

-- The "assigned to you" notification for a punch item is now sent when the
-- list is sent to subs (punch_list_send_to_subs), not at assignment time —
-- otherwise a sub would be told about an item they aren't allowed to see yet.
-- Warranty repairs and customer-facing status updates are unchanged.
create or replace function trg_punch_items_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jnum text;
  addr text;
  status_text text;
begin
  select coalesce(job_number, estimate_number), project_address into jnum, addr from jobs where id = NEW.job_id;

  if NEW.kind = 'warranty' and NEW.assigned_company_id is not null
     and (TG_OP = 'INSERT' or NEW.assigned_company_id is distinct from OLD.assigned_company_id)
     and NEW.status not in ('verified', 'declined') then
    insert into portal_notifications (recipient_kind, company_id, job_id, category, message, link_path, source_id)
    values ('subcontractor', NEW.assigned_company_id, NEW.job_id, 'punch_assigned',
      'A warranty repair was assigned to you'
        || coalesce(' on job #' || jnum, '') || coalesce(' (' || addr || ')', '') || ': ' || left(NEW.title, 120)
        || case when NEW.due_date is not null then ' — due ' || to_char(NEW.due_date, 'FMMon FMDD') else '' end || '.',
      '/sub-portal/punch', NEW.id);
  end if;

  if TG_OP = 'UPDATE' and NEW.customer_visible and NEW.status is distinct from OLD.status
     and NEW.status in ('in_progress', 'resolved', 'declined')
     and (NEW.kind = 'warranty' or _punch_list_final(NEW.job_id)) then
    status_text := case NEW.status
      when 'in_progress' then 'is being worked on'
      when 'resolved' then 'has been marked complete — please let us know if it looks right to you'
      else 'could not be accepted: ' || coalesce(NEW.declined_reason, 'see your portal for details') end;
    insert into portal_notifications (recipient_kind, job_id, category, message, link_path, source_id)
    values ('customer', NEW.job_id, case when NEW.kind = 'warranty' then 'warranty_update' else 'punch_update' end,
      'Update on "' || left(NEW.title, 100) || '": it ' || status_text || '.', '/customerportal/warranty', NEW.id);
  end if;
  return NEW;
end;
$$;

-- ── Staff: publish the draft list to the customer ───────────────────────
create or replace function punch_list_publish_to_customer(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not coalesce(is_admin(), false) then raise exception 'Not authorized'; end if;
  select count(*) into n from punch_items where job_id = target_job_id and kind = 'punch' and status <> 'declined';
  if n = 0 then raise exception 'Add at least one punch item before publishing the list'; end if;

  insert into punch_lists (job_id, status, published_to_customer_at)
  values (target_job_id, 'customer_review', now())
  on conflict (job_id) do update set
    status = 'customer_review', published_to_customer_at = now(),
    customer_approved = null, customer_note = null, customer_submitted_at = null,
    final_published_at = null, sent_to_subs_at = null, schedule_by = null, updated_at = now();

  update punch_items set customer_visible = true where job_id = target_job_id and kind = 'punch';

  insert into portal_notifications (recipient_kind, job_id, category, message, link_path)
  values ('customer', target_job_id, 'punch_review',
    'Your punch list is ready for your review. Please look it over, add anything we missed (photos help), and let us know when you are done.',
    '/customerportal/warranty');
end;
$$;
grant execute on function punch_list_publish_to_customer(uuid) to authenticated;

-- ── Customer: add an item while the list is out for review ──────────────
create or replace function customer_add_punch_item(target_job_id uuid, title_in text, description_in text default null, location_in text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  n integer;
begin
  if not coalesce(has_job_portal_access(target_job_id), false) then raise exception 'Not authorized'; end if;
  if not exists (select 1 from punch_lists where job_id = target_job_id and status = 'customer_review') then
    raise exception 'This punch list is not open for additions right now';
  end if;
  if nullif(btrim(coalesce(title_in, '')), '') is null then raise exception 'Please describe the item in a few words'; end if;
  select count(*) into n from punch_items where job_id = target_job_id and kind = 'punch' and reported_by_kind = 'customer';
  if n >= 50 then raise exception 'That is the maximum number of additions — please submit the list and message us about anything else'; end if;

  insert into punch_items (job_id, kind, title, description, location, reported_by_kind, reported_by_email, customer_visible, review_state)
  values (target_job_id, 'punch', left(btrim(title_in), 200), nullif(btrim(coalesce(description_in, '')), ''), nullif(btrim(coalesce(location_in, '')), ''),
          'customer', auth.jwt() ->> 'email', true, 'pending')
  returning id into new_id;
  return new_id;
end;
$$;
grant execute on function customer_add_punch_item(uuid, text, text, text) to authenticated;

-- ── Customer: remove an addition they made (before submitting) ──────────
create or replace function customer_remove_punch_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i punch_items%rowtype;
begin
  select * into i from punch_items where id = target_item_id;
  if i.id is null or i.kind <> 'punch' or i.reported_by_kind <> 'customer' or i.review_state <> 'pending'
     or not coalesce(has_job_portal_access(i.job_id), false)
     or not exists (select 1 from punch_lists where job_id = i.job_id and status = 'customer_review') then
    raise exception 'Not authorized';
  end if;
  delete from punch_items where id = i.id;
end;
$$;
grant execute on function customer_remove_punch_item(uuid) to authenticated;

-- ── Customer: submit the reviewed list (approve, or send back additions) ─
create or replace function customer_submit_punch_review(target_job_id uuid, note_in text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  added integer;
  jnum text;
begin
  if not coalesce(has_job_portal_access(target_job_id), false) then raise exception 'Not authorized'; end if;
  if not exists (select 1 from punch_lists where job_id = target_job_id and status = 'customer_review') then
    raise exception 'This punch list is not waiting on your review';
  end if;
  select count(*) into added from punch_items where job_id = target_job_id and kind = 'punch' and review_state = 'pending';

  update punch_lists set status = 'staff_review', customer_approved = (added = 0),
    customer_note = nullif(btrim(coalesce(note_in, '')), ''), customer_submitted_at = now(), updated_at = now()
  where job_id = target_job_id;

  select coalesce(job_number, estimate_number) into jnum from jobs where id = target_job_id;
  insert into notifications (message, job_id)
  values (case when added = 0
      then 'Customer approved the punch list' || coalesce(' on job #' || jnum, '') || ' — ready for your final review.'
      else 'Customer added ' || added || ' item' || case when added = 1 then '' else 's' end || ' to the punch list' || coalesce(' on job #' || jnum, '') || ' — needs your review.' end,
    target_job_id);
  return added = 0;
end;
$$;
grant execute on function customer_submit_punch_review(uuid, text) to authenticated;

-- ── Staff: publish the final, read-only list to customer + subs ─────────
create or replace function punch_list_publish_final(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  jnum text;
  addr text;
  rec record;
begin
  if not coalesce(is_admin(), false) then raise exception 'Not authorized'; end if;
  if exists (select 1 from punch_items where job_id = target_job_id and kind = 'punch' and review_state = 'pending') then
    raise exception 'Accept or decline the customer''s added items before publishing the final list';
  end if;
  if not exists (select 1 from punch_items where job_id = target_job_id and kind = 'punch' and status <> 'declined') then
    raise exception 'The list has no items to publish';
  end if;

  insert into punch_lists (job_id, status, final_published_at)
  values (target_job_id, 'final', now())
  on conflict (job_id) do update set status = 'final', final_published_at = now(), updated_at = now();

  update punch_items set customer_visible = true where job_id = target_job_id and kind = 'punch';

  select coalesce(job_number, estimate_number), project_address into jnum, addr from jobs where id = target_job_id;

  insert into portal_notifications (recipient_kind, job_id, category, message, link_path)
  values ('customer', target_job_id, 'punch_final',
    'The final punch list for your project' || coalesce(' at ' || addr, '') || ' is published. You can follow each item''s progress in your portal.',
    '/customerportal/warranty');

  for rec in
    select distinct assigned_company_id from punch_items
    where job_id = target_job_id and kind = 'punch' and assigned_company_id is not null and status not in ('verified', 'declined')
  loop
    insert into portal_notifications (recipient_kind, company_id, job_id, category, message, link_path)
    values ('subcontractor', rec.assigned_company_id, target_job_id, 'punch_final',
      'The final punch list is published' || coalesce(' for job #' || jnum, '') || coalesce(' (' || addr || ')', '')
        || '. Your assigned items are in your portal — a scheduling request will follow.',
      '/sub-portal/punch');
  end loop;
end;
$$;
grant execute on function punch_list_publish_final(uuid) to authenticated;

-- ── Staff: send the final list to the subs for scheduling ───────────────
create or replace function punch_list_send_to_subs(target_job_id uuid)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  days integer;
  by_date date;
  jnum text;
  addr text;
  rec record;
begin
  if not coalesce(is_admin(), false) then raise exception 'Not authorized'; end if;
  if not _punch_list_final(target_job_id) then raise exception 'Publish the final list first'; end if;

  select coalesce(punch_schedule_days, 5) into days from app_settings where id = 1;
  by_date := _app_today() + coalesce(days, 5);

  update punch_lists set sent_to_subs_at = now(), schedule_by = by_date, updated_at = now() where job_id = target_job_id;
  update punch_items set due_date = coalesce(due_date, by_date)
  where job_id = target_job_id and kind = 'punch' and assigned_company_id is not null and status in ('open', 'in_progress');

  select coalesce(job_number, estimate_number), project_address into jnum, addr from jobs where id = target_job_id;
  for rec in
    select assigned_company_id, count(*) as n from punch_items
    where job_id = target_job_id and kind = 'punch' and assigned_company_id is not null and status in ('open', 'in_progress')
    group by assigned_company_id
  loop
    insert into portal_notifications (recipient_kind, company_id, job_id, category, message, link_path)
    values ('subcontractor', rec.assigned_company_id, target_job_id, 'punch_schedule_request',
      'Please schedule your ' || rec.n || ' punch list item' || case when rec.n = 1 then '' else 's' end
        || coalesce(' on job #' || jnum, '') || coalesce(' (' || addr || ')', '')
        || ' by ' || to_char(by_date, 'FMMon FMDD') || '. Open your punch list to see the items and photos.',
      '/sub-portal/punch');
  end loop;
  return by_date;
end;
$$;
grant execute on function punch_list_send_to_subs(uuid) to authenticated;

-- ── Staff: pull a published list back to draft to make changes ──────────
create or replace function punch_list_reopen(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(is_admin(), false) then raise exception 'Not authorized'; end if;
  update punch_lists set status = 'draft', customer_approved = null, customer_submitted_at = null,
    final_published_at = null, sent_to_subs_at = null, schedule_by = null, updated_at = now()
  where job_id = target_job_id;
end;
$$;
grant execute on function punch_list_reopen(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'punch_lists') then
    alter publication supabase_realtime add table punch_lists;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- PART B — Customer blackout dates
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists customer_blackout_dates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  -- auto_applied  : 2+ weeks' notice; the schedule was shifted automatically, awaiting staff review
  -- needs_review  : under 2 weeks' notice; the schedule has NOT been touched yet
  -- approved      : staff approved a needs_review request and the schedule was shifted
  -- sent_to_subs  : staff reviewed it and submitted it to the subcontractors
  -- declined      : staff could not accommodate it (the customer sees the note)
  -- withdrawn     : the customer cancelled it before staff acted on it
  status text not null default 'needs_review' check (status in ('auto_applied', 'needs_review', 'approved', 'sent_to_subs', 'declined', 'withdrawn')),
  notice_days integer,
  requested_by_email text,
  schedule_shift_note text,           -- what the automatic/approved shift did, e.g. "3 phases moved 4 workdays"
  staff_note text,
  reviewed_by_email text,
  reviewed_at timestamptz,
  sent_to_subs_at timestamptz,
  created_at timestamptz not null default now(),
  constraint customer_blackout_range check (end_date >= start_date and end_date - start_date <= 60)
);
create index if not exists customer_blackout_job_idx on customer_blackout_dates (job_id, start_date);

alter table customer_blackout_dates enable row level security;
drop policy if exists "Admin can do everything on customer_blackout_dates" on customer_blackout_dates;
create policy "Admin can do everything on customer_blackout_dates" on customer_blackout_dates for all using (is_admin()) with check (is_admin());
drop policy if exists "Customers can view their blackout dates" on customer_blackout_dates;
create policy "Customers can view their blackout dates" on customer_blackout_dates for select using (has_job_portal_access(job_id));

create or replace function _contract_signed(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select contract_finalized_at is not null from jobs where id = target_job_id), false);
$$;

-- Customer adds a blackout request. Returns the new row's id and status so
-- the calling route knows whether to shift the schedule now.
create or replace function add_customer_blackout(target_job_id uuid, start_in date, end_in date, reason_in text default null)
returns table (id uuid, status text, notice_days integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  min_notice integer;
  notice integer;
  new_status text;
  new_id uuid;
  jnum text;
begin
  if not coalesce(has_job_portal_access(target_job_id), false) then raise exception 'Not authorized'; end if;
  if not _contract_signed(target_job_id) then
    raise exception 'Blackout dates can be added once your contract is signed';
  end if;
  if start_in is null or end_in is null or end_in < start_in then raise exception 'Choose a valid date range'; end if;
  if end_in - start_in > 60 then raise exception 'That range is too long — please add it in smaller pieces or message us'; end if;
  if start_in < _app_today() then raise exception 'Blackout dates must be in the future'; end if;
  if (select count(*) from customer_blackout_dates b where b.job_id = target_job_id and b.status in ('auto_applied', 'needs_review', 'approved')) >= 25 then
    raise exception 'You have several open blackout requests — please message us about anything else';
  end if;

  select coalesce(blackout_notice_days, 14) into min_notice from app_settings where app_settings.id = 1;
  notice := start_in - _app_today();
  new_status := case when notice >= coalesce(min_notice, 14) then 'auto_applied' else 'needs_review' end;

  insert into customer_blackout_dates (job_id, start_date, end_date, reason, status, notice_days, requested_by_email)
  values (target_job_id, start_in, end_in, nullif(btrim(coalesce(reason_in, '')), ''), new_status, notice, auth.jwt() ->> 'email')
  returning customer_blackout_dates.id into new_id;

  select coalesce(job_number, estimate_number) into jnum from jobs where jobs.id = target_job_id;
  insert into notifications (message, job_id)
  values ('Customer blackout dates' || coalesce(' on job #' || jnum, '') || ': ' || to_char(start_in, 'FMMon FMDD') || ' – ' || to_char(end_in, 'FMMon FMDD')
    || case when new_status = 'auto_applied' then ' (2+ weeks out — schedule moved automatically, please review)' else ' (under notice period — needs your review before the schedule changes)' end,
    target_job_id);

  return query select new_id, new_status, notice;
end;
$$;
grant execute on function add_customer_blackout(uuid, date, date, text) to authenticated;

-- Customer cancels a request staff haven't acted on. (A blackout that has
-- already shifted the schedule is left for staff to unwind.)
create or replace function withdraw_customer_blackout(target_blackout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b customer_blackout_dates%rowtype;
begin
  select * into b from customer_blackout_dates where id = target_blackout_id;
  if b.id is null or not coalesce(has_job_portal_access(b.job_id), false) then raise exception 'Not authorized'; end if;
  if b.status <> 'needs_review' then
    raise exception 'This request has already been acted on — please message us to change it';
  end if;
  update customer_blackout_dates set status = 'withdrawn' where id = b.id;
end;
$$;
grant execute on function withdraw_customer_blackout(uuid) to authenticated;

-- Staff: submit a reviewed blackout to the subs who are working the job.
create or replace function submit_blackout_to_subs(target_blackout_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  b customer_blackout_dates%rowtype;
  jnum text;
  addr text;
  n integer := 0;
  rec record;
begin
  if not coalesce(is_admin(), false) then raise exception 'Not authorized'; end if;
  select * into b from customer_blackout_dates where id = target_blackout_id;
  if b.id is null then raise exception 'Not found'; end if;
  if b.status not in ('auto_applied', 'approved') then
    raise exception 'Review and approve this request before sending it to the subs';
  end if;

  select coalesce(job_number, estimate_number), project_address into jnum, addr from jobs where id = b.job_id;
  for rec in
    select distinct wo.company_id from work_orders wo
    where wo.job_id = b.job_id and wo.company_id is not null and wo.status in ('issued', 'accepted')
  loop
    insert into portal_notifications (recipient_kind, company_id, job_id, category, message, link_path)
    values ('subcontractor', rec.company_id, b.job_id, 'schedule_change',
      'The customer' || coalesce(' on job #' || jnum, '') || coalesce(' (' || addr || ')', '') || ' is not available '
        || to_char(b.start_date, 'FMMon FMDD') || case when b.end_date <> b.start_date then ' – ' || to_char(b.end_date, 'FMMon FMDD') else '' end
        || '. The schedule has been adjusted — please check your calendar for your new dates.',
      '/sub-portal/calendar');
    n := n + 1;
  end loop;

  update customer_blackout_dates set status = 'sent_to_subs', sent_to_subs_at = now(),
    reviewed_by_email = coalesce(reviewed_by_email, auth.jwt() ->> 'email'), reviewed_at = coalesce(reviewed_at, now())
  where id = b.id;
  return n;
end;
$$;
grant execute on function submit_blackout_to_subs(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customer_blackout_dates') then
    alter publication supabase_realtime add table customer_blackout_dates;
  end if;
end $$;
