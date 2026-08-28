-- Run in Supabase SQL Editor after migration 060. Safe to re-run.
--
-- New tables for the offline-capable PWA work: time entries and checklist
-- items, both designed to sync cleanly from a client that may have been
-- offline for a while. A few deliberate choices worth calling out:
--
-- 1. Every id is a client-assignable UUID (gen_random_uuid() is only the
--    *default* — the offline client can generate its own UUID the moment
--    a time entry or checklist toggle happens, and it'll match exactly
--    what the DB would have generated, so nothing collides on sync).
--
-- 2. Time entries are purely additive, same as job_updates/job_photos —
--    two people logging hours never conflicts, so there's nothing to
--    reconcile on sync.
--
-- 3. Checklist items are the one place a real conflict is possible (two
--    people toggling the same box while both offline). This uses
--    last-write-wins on the item itself, but every change is also logged
--    to checklist_item_history so nothing is silently lost — if a write
--    does get overwritten, the full history is still there to review.
--
-- 4. job_updates and job_photos never captured who created them. Adding
--    created_by_email to both here too, since offline attribution needs
--    it and there's no reason the existing features shouldn't have it.

-- ─── Time entries (one job has many; append-only) ───────────────────────
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  created_by_email text not null default (auth.jwt()->>'email'),
  entry_date date not null default current_date,
  hours numeric not null check (hours > 0),
  notes text,

  created_at timestamptz not null default now()
);

alter table time_entries enable row level security;

drop policy if exists "Admin can do everything on time_entries" on time_entries;
create policy "Admin can do everything on time_entries"
  on time_entries for all using (is_admin()) with check (is_admin());

-- ─── Checklist items (one job has many) ─────────────────────────────────
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  label text not null,
  sort_order integer not null default 0,

  is_complete boolean not null default false,
  completed_by_email text,
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table checklist_items enable row level security;

drop policy if exists "Admin can do everything on checklist_items" on checklist_items;
create policy "Admin can do everything on checklist_items"
  on checklist_items for all using (is_admin()) with check (is_admin());

-- Keep updated_at current automatically (reuses the trigger function
-- already defined in the base schema).
drop trigger if exists set_checklist_items_updated_at on checklist_items;
create trigger set_checklist_items_updated_at
  before update on checklist_items
  for each row execute function set_updated_at();

-- ─── Checklist history (audit trail for the one conflict-prone table) ───
create table if not exists checklist_item_history (
  id uuid primary key default gen_random_uuid(),
  checklist_item_id uuid not null references checklist_items(id) on delete cascade,

  changed_by_email text not null default (auth.jwt()->>'email'),
  previous_value boolean,
  new_value boolean not null,

  changed_at timestamptz not null default now()
);

alter table checklist_item_history enable row level security;

drop policy if exists "Admin can do everything on checklist_item_history" on checklist_item_history;
create policy "Admin can do everything on checklist_item_history"
  on checklist_item_history for all using (is_admin()) with check (is_admin());

-- ─── Attribution catch-up on existing tables ────────────────────────────
alter table job_updates add column if not exists created_by_email text;
alter table job_photos add column if not exists created_by_email text;

-- ─── Real-time (so an open tab/device sees changes immediately) ────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'time_entries'
  ) then
    alter publication supabase_realtime add table time_entries;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'checklist_items'
  ) then
    alter publication supabase_realtime add table checklist_items;
  end if;
end $$;
