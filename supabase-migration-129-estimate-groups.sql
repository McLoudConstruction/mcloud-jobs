-- Run in Supabase SQL Editor after migration 128. Safe to re-run.
--
-- "Flexible estimates": two independent, combinable mechanics on top of a
-- job's base estimate:
--
--   - Scope Options — a whole-project fork: two or more ENTIRELY SEPARATE
--     scopes of work (each with its own full line-by-line scope and its
--     own price) for the same project, e.g. "Option A: patch repair" vs
--     "Option B: full replacement". Only one moves forward. This is a
--     property of the estimate itself, toggled at the top of the Scope
--     page (jobs.estimate_mode: 'single' or 'multi') — not a group nested
--     inside the estimate. Single mode is the default and behaves exactly
--     as the app always has (jobs.scope_items is the one scope).
--   - Alternates — independently toggleable optional add-ons layered on
--     top of whichever scope is in play (e.g. defer this to next budget
--     year). These stay a group concept (estimate_groups).
--
-- The customer picks interactively on the estimate document (mirrors the
-- Material Selections pattern — pick freely, then one final Submit locks
-- everything in). On submit, the selected scope option (if multi) and the
-- included alternates are flattened into jobs.scope_items, and
-- job_financials.contract_price is updated to match — so every existing
-- surface (Contract page, Invoicing, Budget, work order scope
-- suggestions) keeps reading exactly the same two fields it always has,
-- with no changes needed anywhere else. The pre-submit base scope/price
-- is snapshotted first so an admin can "unlock" and let the customer
-- re-pick (the modified-estimate case) without losing track of what the
-- base was.
--
-- Anything the customer doesn't end up with (an unpicked scope option, an
-- unchecked Alternate) becomes a review candidate on the admin side: save
-- it to the deferred_scope_items follow-up bucket, or discard it.

-- ─── Scope Options (single/multi-option scope fork) ───────────────────
create table if not exists estimate_scope_options (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  label text not null,
  description text,
  scope_items jsonb not null default '[]'::jsonb,
  price numeric,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estimate_scope_options_job_id_idx on estimate_scope_options (job_id);

-- ─── Alternates ─────────────────────────────────────────────────────────
create table if not exists estimate_groups (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  kind text not null default 'alternate' check (kind in ('alternate')),
  label text not null,
  description text,
  sort_order integer not null default 0,

  -- this group IS the option (no child choices table) — customer
  -- independently includes or leaves it out.
  price numeric,
  scope_items jsonb not null default '[]'::jsonb,
  included boolean not null default false,
  default_included boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estimate_groups_job_id_idx on estimate_groups (job_id);

-- ─── Scope-fork mode + base snapshot + lock state on jobs ─────────────
alter table jobs add column if not exists estimate_mode text not null default 'single' check (estimate_mode in ('single', 'multi'));
alter table jobs add column if not exists estimate_base_scope_items jsonb;
alter table jobs add column if not exists estimate_base_price numeric;
alter table jobs add column if not exists estimate_groups_submitted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'jobs' and column_name = 'selected_scope_option_id'
  ) then
    alter table jobs add column selected_scope_option_id uuid references estimate_scope_options(id) on delete set null;
  end if;
end $$;

-- ─── Deferred scope follow-up bucket ──────────────────────────────────
create table if not exists deferred_scope_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete set null,
  source_group_id uuid references estimate_groups(id) on delete set null,
  source_scope_option_id uuid references estimate_scope_options(id) on delete set null,

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
alter table estimate_scope_options enable row level security;
alter table estimate_groups enable row level security;
alter table deferred_scope_items enable row level security;

drop policy if exists "Admin full access to estimate_scope_options" on estimate_scope_options;
create policy "Admin full access to estimate_scope_options" on estimate_scope_options for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Customers can view scope options on their own jobs" on estimate_scope_options;
create policy "Customers can view scope options on their own jobs" on estimate_scope_options for select
  using (has_job_portal_access(job_id));

drop policy if exists "Admin full access to estimate_groups" on estimate_groups;
create policy "Admin full access to estimate_groups" on estimate_groups for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Customers can view groups on their own jobs" on estimate_groups;
create policy "Customers can view groups on their own jobs" on estimate_groups for select
  using (has_job_portal_access(job_id));

drop policy if exists "Admin full access to deferred_scope_items" on deferred_scope_items;
create policy "Admin full access to deferred_scope_items" on deferred_scope_items for all
  using (is_admin()) with check (is_admin());

drop trigger if exists set_estimate_scope_options_updated_at on estimate_scope_options;
create trigger set_estimate_scope_options_updated_at
  before update on estimate_scope_options
  for each row execute function set_updated_at();

drop trigger if exists set_estimate_groups_updated_at on estimate_groups;
create trigger set_estimate_groups_updated_at
  before update on estimate_groups
  for each row execute function set_updated_at();

-- ─── RPCs ───────────────────────────────────────────────────────────

-- Records a tentative pick of a whole scope option (multi mode only).
-- Customer can change their mind freely until submit_estimate_groups
-- locks the job.
create or replace function pick_scope_option(target_job_id uuid, target_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_mode text;
  locked_at timestamptz;
  option_belongs boolean;
begin
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;

  select estimate_mode, estimate_groups_submitted_at into job_mode, locked_at
  from jobs where id = target_job_id;

  if job_mode is null then
    raise exception 'Job not found';
  end if;
  if job_mode != 'multi' then
    raise exception 'This job is not set up for multiple scope options';
  end if;
  if locked_at is not null then
    raise exception 'This estimate has already been submitted and can no longer be changed';
  end if;

  select exists (
    select 1 from estimate_scope_options where id = target_option_id and job_id = target_job_id
  ) into option_belongs;
  if not option_belongs then
    raise exception 'That option does not belong to this job';
  end if;

  update jobs set selected_scope_option_id = target_option_id where id = target_job_id;
end;
$$;

grant execute on function pick_scope_option(uuid, uuid) to authenticated;

-- Toggles an Alternate group's inclusion.
create or replace function toggle_estimate_alternate(target_group_id uuid, include_it boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job_id uuid;
  locked_at timestamptz;
begin
  select eg.job_id, j.estimate_groups_submitted_at
  into target_job_id, locked_at
  from estimate_groups eg
  join jobs j on j.id = eg.job_id
  where eg.id = target_group_id;

  if target_job_id is null then
    raise exception 'Group not found';
  end if;
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;
  if locked_at is not null then
    raise exception 'This estimate has already been submitted and can no longer be changed';
  end if;

  update estimate_groups set included = include_it where id = target_group_id;
end;
$$;

grant execute on function toggle_estimate_alternate(uuid, boolean) to authenticated;

-- Finalizes the estimate for the job: in multi mode, requires a scope
-- option to be picked and uses ITS scope/price as the base; in single
-- mode the base is jobs.scope_items/contract_price exactly as always.
-- Either way, included Alternates are added on top. The pre-submit base
-- is snapshotted once so an admin can later unlock and restore it.
create or replace function submit_estimate_groups(target_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_mode text;
  picked_option_id uuid;
  already_locked timestamptz;
  base_scope jsonb;
  base_price numeric;
  addl_items jsonb;
  addl_price numeric;
begin
  if not has_job_portal_access(target_job_id) then
    raise exception 'Not authorized';
  end if;

  select estimate_mode, selected_scope_option_id, estimate_groups_submitted_at
  into job_mode, picked_option_id, already_locked
  from jobs where id = target_job_id;

  if already_locked is not null then
    raise exception 'This estimate has already been submitted';
  end if;

  if job_mode = 'multi' and picked_option_id is null then
    raise exception 'Please choose a scope option before submitting';
  end if;

  -- Snapshot the base exactly as it stood the moment this estimate was
  -- first submitted, so a later "unlock" can restore it without guessing
  -- which lines were appended by this function.
  update jobs
  set estimate_base_scope_items = coalesce(estimate_base_scope_items, scope_items),
      estimate_base_price = coalesce(estimate_base_price, (select contract_price from job_financials where job_id = target_job_id))
  where id = target_job_id;

  if job_mode = 'multi' then
    select scope_items, coalesce(price, 0) into base_scope, base_price
    from estimate_scope_options where id = picked_option_id;
  else
    select estimate_base_scope_items, coalesce(estimate_base_price, 0)
    into base_scope, base_price
    from jobs where id = target_job_id;
  end if;

  -- Price: a plain sum per included alternate, computed separately from
  -- the item text expansion below so a multi-line alternate's price is
  -- never counted once per line.
  select coalesce(sum(price), 0) into addl_price
  from estimate_groups
  where job_id = target_job_id and included = true;

  -- Scope text: every included alternate's own scope lines, tagged with
  -- its label; an alternate with no line-item detail still contributes
  -- one label-only line so its price is never silently unexplained in
  -- the document.
  select coalesce(jsonb_agg(jsonb_build_object('text', line) order by grp_order, item_order), '[]'::jsonb)
  into addl_items
  from (
    select eg.sort_order as grp_order, coalesce(item.ord, 0) as item_order,
           '[' || eg.label || ']' || case when item.val is not null then ' ' || (item.val->>'text') else '' end as line
    from estimate_groups eg
    left join lateral jsonb_array_elements(eg.scope_items) with ordinality as item(val, ord) on true
    where eg.job_id = target_job_id and eg.included = true
  ) lines;

  update jobs
  set scope_items = coalesce(base_scope, '[]'::jsonb) || addl_items,
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
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'estimate_scope_options'
  ) then
    alter publication supabase_realtime add table estimate_scope_options;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'estimate_groups'
  ) then
    alter publication supabase_realtime add table estimate_groups;
  end if;
end $$;
