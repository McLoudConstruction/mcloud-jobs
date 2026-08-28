-- Run in Supabase SQL Editor after migration 062. Safe to re-run.
--
-- checklist_item_history (added in 061) was designed to be written to
-- manually alongside every checklist_items update. That's fragile — an
-- offline client queuing a checklist toggle would need to remember to
-- write two rows, in the right order, every time. A trigger makes this
-- automatic and impossible to forget: any change to is_complete gets
-- logged regardless of which code path touched the row.

create or replace function log_checklist_item_change()
returns trigger
language plpgsql
as $$
begin
  if new.is_complete is distinct from old.is_complete then
    insert into checklist_item_history (checklist_item_id, changed_by_email, previous_value, new_value)
    values (new.id, coalesce(new.completed_by_email, auth.jwt()->>'email'), old.is_complete, new.is_complete);
  end if;
  return new;
end;
$$;

drop trigger if exists log_checklist_item_change_trigger on checklist_items;
create trigger log_checklist_item_change_trigger
  after update on checklist_items
  for each row execute function log_checklist_item_change();
