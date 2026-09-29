-- Migration 143 — One due date for the whole punch list; punch items created
-- from an Internal Update
--
--   • punch_lists.due_date — the date the whole punch list should be finished
--     by. It replaces setting a due date item by item: setting it stamps every
--     open punch item, and new items pick it up as they're added. (Warranty
--     repairs keep their own per-item due date.)
--   • punch_items.update_id — set when an item was created from a "Punch List"
--     Internal Update, so the two stay linked. Deleting the update leaves the
--     items in place.
--
-- Sending the list to subs still starts the "schedule these within N days"
-- clock (app_settings.punch_schedule_days → punch_lists.schedule_by); the
-- due date is when the work itself should be done. Safe to re-run.

alter table punch_lists add column if not exists due_date date;
alter table punch_items add column if not exists update_id uuid references job_updates(id) on delete set null;
create index if not exists punch_items_update_idx on punch_items (update_id) where update_id is not null;

-- New punch items inherit the list's due date.
create or replace function trg_punch_items_inherit_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.kind = 'punch' and NEW.due_date is null then
    select due_date into NEW.due_date from punch_lists where job_id = NEW.job_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_punch_items_inherit_due on punch_items;
create trigger trg_punch_items_inherit_due
  before insert on punch_items
  for each row execute function trg_punch_items_inherit_due();

-- Staff: set (or clear) the punch list's due date; stamps the open items.
create or replace function punch_list_set_due(target_job_id uuid, due_in date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(is_admin(), false) then raise exception 'Not authorized'; end if;
  insert into punch_lists (job_id, due_date) values (target_job_id, due_in)
  on conflict (job_id) do update set due_date = due_in, updated_at = now();
  update punch_items set due_date = due_in
  where job_id = target_job_id and kind = 'punch' and status in ('open', 'in_progress');
end;
$$;
grant execute on function punch_list_set_due(uuid, date) to authenticated;

-- Sending to subs no longer invents per-item due dates: items already carry
-- the list's due date. The message tells subs both dates.
create or replace function punch_list_send_to_subs(target_job_id uuid)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  days integer;
  by_date date;
  list_due date;
  jnum text;
  addr text;
  rec record;
begin
  if not coalesce(is_admin(), false) then raise exception 'Not authorized'; end if;
  if not _punch_list_final(target_job_id) then raise exception 'Publish the final list first'; end if;

  select coalesce(punch_schedule_days, 5) into days from app_settings where id = 1;
  by_date := _app_today() + coalesce(days, 5);
  select due_date into list_due from punch_lists where job_id = target_job_id;

  update punch_lists set sent_to_subs_at = now(), schedule_by = by_date, updated_at = now() where job_id = target_job_id;
  if list_due is not null then
    update punch_items set due_date = list_due
    where job_id = target_job_id and kind = 'punch' and status in ('open', 'in_progress');
  end if;

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
        || ' by ' || to_char(by_date, 'FMMon FMDD')
        || case when list_due is not null then '; the whole list is due complete by ' || to_char(list_due, 'FMMon FMDD') else '' end
        || '. Open your punch list to see the items and photos.',
      '/sub-portal/punch');
  end loop;
  return by_date;
end;
$$;
grant execute on function punch_list_send_to_subs(uuid) to authenticated;
