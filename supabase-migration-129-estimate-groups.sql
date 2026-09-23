-- Run in Supabase SQL Editor after migration 128. Safe to re-run.
--
-- "Flexible estimates": a job's estimate can now include, on top of the
-- always-included base scope (jobs.scope_items, unchanged), two kinds of
-- customer-facing groups:
--
--   - Choose One  — mutually exclusive alternate approaches to one scope
--     area (e.g. "patch repair" vs "full replacement"). Customer must
--     pick exactly one.
--   - Alternate   — an independently toggleable optional item the
--     customer can include or leave out (e.g. defer to next budget year).
--
-- The customer picks interactively on the estimate document (mirrors the
-- Material Selections pattern — pick freely, then one final Submit locks
-- everything in). On submit, the selected/included items are flattened
-- into jobs.scope_items and job_financials.contract_price is updated to
-- base + selected total — so every existing surface (Contract page,
-- Invoicing, Budget, work order scope suggestions) keeps reading exactly
-- the same two fields it always has, with no changes needed anywhere
-- else. The pre-submit base scope/price is snapshotted first so an admin
-- can "unlock" and let the customer re-pick (the modified-estimate case)
-- without losing track of what the base was.
--
-- Anything the customer declines (an unpicked Choose One alternative, an
-- unchecked Alternate) becomes a review candidate on the admin side:
-- save it to the deferred_scope_items follow-up bucket, or discard it.

-- ─── Groups ───────────────────────────────────────────────────────────
create table if not exists estimate_groups (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  kind text not null check (kind in ('choose_one', 'alternate')),
  label text not null,
  description text,
  sort_order integer not null default 0,

  -- choose_one only — the choice the customer picked (FK added below,
  -- once estimate_group_choices exists).
  selected_choice_id uuid,

  -- alternate only — this group IS the option (no child choices table).
  price numeric,
  scope_items jsonb not null default '[]'::jsonb,
  included boolean not null default false,
  default_included boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estimate_groups_job_id_idx on estimate_groups (job_id);

-- ─── Choose One options ───────────────────────────────────────────────
create table if not exists estimate_group_choices (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references estimate_groups(id) on delete cascade,

  label text not null,
  description text,
  price numeric,
  scope_items jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists estimate_group_choices_group_id_idx on estimate_group_choices (group_id);

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'estimate_groups_selected_choice_fkey'
  ) then
    alter table estimate_groups
      add constraint estimate_groups_selected_choice_fkey
      foreign key (selected_choice_id) references estimate_group_choices(id) on delete set null;
  end if;
end $$;

-- ─── Base snapshot + lock state on jobs ──────────────────────────────
alter table jobs add column if not exists estimate_base_scope_items jsonb;
alter table jobs add column if not exists estimate_base_price numeric;
alter table jobs add column if not exists estimate_groups_submitted_at timestamptz;

-- ─── Deferred scope follow-up bucket ──────────────────────────────────
create table if not exists deferred_scope_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete set null,
  source_group_id uuid references estimate_groups(id) on delete set null,
  source_choice_id uuid references estimate_group_choices(id) on delete set null,

  label text not null,
  description text,
  price numeric,

  -- Snapshotted at capture time so the follow-up record stays useful
  -- even if the job/customer data changes or the job is later deleted.
  customer_name text,
  customer_contact text,
  customer_email text,
  customer_phone text,
  project_address text,

  status text not null default 'open' check (status in ('open', 'contacted', 'won', 'dead')),
  notes text,
  follow_up_at date,

  created_at timestamptz not null default now(),
  created_by_email text default (auth.jwt()->>'email')
);

create index if not exists deferred_scope_items_job_id_idx on deferred_scope_items (job_id);
create index if not exists deferred_scope_items_status_idx on deferred_scope_items (status);

-- ─── RLS ────────────────────────────────────────────────────────────
alter table estimate_groups enable row level security;
alter table estimate_group_choices enable row level security;
alter table deferred_scope_items enable row level security;

drop policy if exists "Admin full access to estimate_groups" on estimate_groups;
create policy "Admin full access to estimate_groups" on estimate_groups for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Customers can view groups on their own jobs" on estimate_groups;
create policy "Customers can view groups on their own jobs" on estimate_groups for select
  using (has_job_portal_access(job_id));

drop policy if exists "Admin full access to estimate_group_choices" on estimate_group_choices;
create policy "Admin full access to estimate_group_choices" on estimate_group_choices for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Customers can view choices on their own jobs" on estimate_group_choices;
create policy "Customers can view choices on their own jobs" on estimate_group_choices for select
  using (exists (
    select 1 from estimate_groups g where g.id = group_id and has_job_portal_access(g.job_id)
  ));

drop policy if exists "Admin full access to deferred_scope_items" on deferred_scope_items;
create policy "Admin full access to deferred_scope_items" on deferred_scope_items for all
  using (is_admin()) with check (is_admin());

drop trigger if exists set_estimate_groups_updated_at on estimate_groups;
create trigger set_estimate_groups_updated_at
  before update on estimate_groups
  for each row execute function set_updated_at();

-- ─── RPCs ───────────────────────────────────────────────────────────

-- Records a tentative pick on a Choose One group. Customer can change
-- their mind freely until submit_estimate_groups locks the job.
create or replace function pick_estimate_group_choice(target_group_id uuid, target_choice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job_id uuid;
  group_kind text;
  locked_at timestamptz;
  choice_belongs boolean;
begin
  select eg.job_id, eg.kind, j.estimate_groups_submitted_at
  into target_job_id, group_kind, locked_at
  from estimate_groups eg
  join jobs j on j.id = eg.job_id
  where eg.id = target_group_id;

  if target_job_id is null then
    raise exception 'Group not found';
  end if;
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;
  if group_kind != 'choose_one' then
    raise exception 'This group is not a Choose One group';
  end if;
  if locked_at is not null then
    raise exception 'This estimate has already been submitted and can no longer be changed';
  end if;

  select exists (
    select 1 from estimate_group_choices where id = target_choice_id and group_id = target_group_id
  ) into choice_belongs;
  if not choice_belongs then
    raise exception 'That choice does not belong to this group';
  end if;

  update estimate_groups set selected_choice_id = target_choice_id where id = target_group_id;
end;
$$;

grant execute on function pick_estimate_group_choice(uuid, uuid) to authenticated;

-- Toggles an Alternate group's inclusion.
create or replace function toggle_estimate_alternate(target_group_id uuid, include_it boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job_id uuid;
  group_kind text;
  locked_at timestamptz;
begin
  select eg.job_id, eg.kind, j.estimate_groups_submitted_at
  into target_job_id, group_kind, locked_at
  from estimate_groups eg
  join jobs j on j.id = eg.job_id
  where eg.id = target_group_id;

  if target_job_id is null then
    raise exception 'Group not found';
  end if;
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;
  if group_kind != 'alternate' then
    raise exception 'This group is not an Alternate group';
  end if;
  if locked_at is not null then
    raise exception 'This estimate has already been submitted and can no longer be changed';
  end if;

  update estimate_groups set included = include_it where id = target_group_id;
end;
$$;

grant execute on function toggle_estimate_alternate(uuid, boolean) to authenticated;

-- Finalizes every group for the job: requires every Choose One group to
-- have a pick, then flattens the selected/included scope + price on top
-- of a one-time snapshot of the base (so an admin can later unlock and
-- restore exactly what the base was, for the "send a modified estimate"
-- case).
create or replace function submit_estimate_groups(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  incomplete_count int;
  base_scope jsonb;
  base_price numeric;
  already_locked timestamptz;
  addl_items jsonb;
  addl_price numeric;
begin
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;

  select estimate_groups_submitted_at into already_locked from jobs where id = target_job_id;
  if already_locked is not null then
    raise exception 'This estimate has already been submitted';
  end if;

  select count(*) into incomplete_count
  from estimate_groups
  where job_id = target_job_id and kind = 'choose_one' and selected_choice_id is null;

  if incomplete_count > 0 then
    raise exception 'Every Choose One group must have a selection before submitting';
  end if;

  -- Snapshot the base exactly as it stood the moment groups were first
  -- introduced, so a later "unlock" can restore it without guessing
  -- which lines were appended by this function.
  update jobs
  set estimate_base_scope_items = coalesce(estimate_base_scope_items, scope_items),
      estimate_base_price = coalesce(estimate_base_price, (select contract_price from job_financials where job_id = target_job_id))
  where id = target_job_id;

  select estimate_base_scope_items, coalesce(estimate_base_price, 0)
  into base_scope, base_price
  from jobs where id = target_job_id;

  -- Price: a plain sum per group/choice, computed separately from the
  -- item text expansion below so a multi-line choice's price is never
  -- counted once per line.
  select
    coalesce((
      select sum(c.price) from estimate_groups eg
      join estimate_group_choices c on c.id = eg.selected_choice_id
      where eg.job_id = target_job_id and eg.kind = 'choose_one'
    ), 0)
    + coalesce((
      select sum(eg2.price) from estimate_groups eg2
      where eg2.job_id = target_job_id and eg2.kind = 'alternate' and eg2.included = true
    ), 0)
  into addl_price;

  -- Scope text: every selected choice's / included alternate's own
  -- scope lines, each tagged with its group label; a choice/alternate
  -- with no line-item detail still contributes one label-only line so
  -- its price is never silently unexplained in the document.
  select coalesce(jsonb_agg(jsonb_build_object('text', line) order by grp_order, item_order), '[]'::jsonb)
  into addl_items
  from (
    select eg.sort_order as grp_order, coalesce(item.ord, 0) as item_order,
           '[' || eg.label || '] ' || c.label || case when item.val is not null then ': ' || (item.val->>'text') else '' end as line
    from estimate_groups eg
    join estimate_group_choices c on c.id = eg.selected_choice_id
    left join lateral jsonb_array_elements(c.scope_items) with ordinality as item(val, ord) on true
    where eg.job_id = target_job_id and eg.kind = 'choose_one'

    union all

    select eg.sort_order as grp_order, coalesce(item.ord, 0) as item_order,
           '[' || eg.label || ']' || case when item.val is not null then ' ' || (item.val->>'text') else '' end as line
    from estimate_groups eg
    left join lateral jsonb_array_elements(eg.scope_items) with ordinality as item(val, ord) on true
    where eg.job_id = target_job_id and eg.kind = 'alternate' and eg.included = true
  ) lines;

  update jobs
  set scope_items = base_scope || addl_items,
      estimate_groups_submitted_at = now()
  where id = target_job_id;

  update job_financials
  set contract_price = base_price + addl_price
  where job_id = target_job_id;
end;
$$;

grant execute on function submit_estimate_groups(uuid) to authenticated;

-- Realtime, same pattern as every other customer-facing table.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'estimate_groups'
  ) then
    alter publication supabase_realtime add table estimate_groups;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'estimate_group_choices'
  ) then
    alter publication supabase_realtime add table estimate_group_choices;
  end if;
end $$;
