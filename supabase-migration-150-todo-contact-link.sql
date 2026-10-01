-- To-dos can be linked to a contact (picked in Drive Mode), so the Dashboard
-- can offer a one-tap mailto for "Email" to-dos. Deleting the contact just
-- unlinks the to-do.

alter table sales_todos
  add column if not exists contact_id uuid references contacts(id) on delete set null;

create index if not exists sales_todos_contact_idx on sales_todos (contact_id) where contact_id is not null;

-- Make the new column visible to the API right away.
notify pgrst, 'reload schema';
