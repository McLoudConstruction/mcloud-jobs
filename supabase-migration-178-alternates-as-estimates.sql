-- Run in Supabase SQL Editor after migration 177. Safe to re-run.
--
-- Alternates become full, separate estimates.
--
-- Before: an alternate (estimate_groups) was a name, a typed price and a box
-- of plain sentences. It could not be built the way the main estimate is.
--
-- Now an alternate carries everything the main estimate carries:
--   - its own scope sentences (estimate_groups.scope_items, already there)
--   - its own trade breakdown / action list (estimate_group_actions, new)
--   - its own cost build-up, margin and sales tax, so its price is computed
--     on the Cost and Pricing tabs the same way the main price is
--     (job_estimate_items.group_id, estimate_groups.estimate_*_percent and
--     projected_cost)
-- The customer can still include any one, several, or none of them.
--
-- Nothing else in the app has to learn that alternates exist. Alternate cost
-- lines and actions live apart from the base estimate, so Budget, Work
-- Orders, Schedule and the rest keep reading the base only. When the
-- customer submits, the alternates they included are copied into the base
-- (tagged merged_from_group_id), exactly as their scope lines and price
-- already were. Unlocking the estimate removes those copies again.

-- ─── Costing fields on an alternate (same trio an option has) ──────────
alter table estimate_groups add column if not exists estimate_margin_percent numeric;
alter table estimate_groups add column if not exists estimate_sales_tax_percent numeric;
alter table estimate_groups add column if not exists projected_cost numeric;

-- ─── Cost lines that belong to one alternate ───────────────────────────
-- group_id null = the base estimate (or a scope option, via option_id),
-- exactly as before. merged_from_group_id tags a base row that was copied
-- in from an included alternate when the customer submitted.
alter table job_estimate_items add column if not exists group_id uuid references estimate_groups(id) on delete cascade;
alter table job_estimate_items add column if not exists merged_from_group_id uuid;
create index if not exists job_estimate_items_group_id_idx on job_estimate_items (group_id);
create index if not exists job_estimate_items_merged_from_idx on job_estimate_items (merged_from_group_id) where merged_from_group_id is not null;

-- ─── Trade breakdown / action list per alternate ───────────────────────
-- Same shape as job_scope_actions. A separate table (not a column on
-- job_scope_actions) on purpose: Work Orders, Schedule, Milestones, the
-- plan takeoff and the AI describe route all read job_scope_actions for the
-- whole job, and none of them should see work the customer has not chosen.
create table if not exists estimate_group_actions (like job_scope_actions including all);
alter table estimate_group_actions add column if not exists group_id uuid not null references estimate_groups(id) on delete cascade;
create index if not exists estimate_group_actions_group_id_idx on estimate_group_actions (group_id);
create index if not exists estimate_group_actions_job_id_idx on estimate_group_actions (job_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'estimate_group_actions_job_id_fkey') then
    alter table estimate_group_actions
      add constraint estimate_group_actions_job_id_fkey foreign key (job_id) references jobs(id) on delete cascade;
  end if;
end $$;

-- Base rows copied in from an included alternate on submit.
alter table job_scope_actions add column if not exists merged_from_group_id uuid;
create index if not exists job_scope_actions_merged_from_idx on job_scope_actions (merged_from_group_id) where merged_from_group_id is not null;

alter table estimate_group_actions enable row level security;
drop policy if exists "Admin full access to estimate_group_actions" on estimate_group_actions;
create policy "Admin full access to estimate_group_actions" on estimate_group_actions for all
  using (is_admin()) with check (is_admin());

-- ─── Base projected cost snapshot ──────────────────────────────────────
-- Submit adds the included alternates' costs to jobs.projected_cost (the
-- Budget baseline). The base value is kept here so Unlock can put it back.
alter table jobs add column if not exists estimate_base_projected_cost numeric;

-- ─── Realtime ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'estimate_group_actions'
  ) then
    alter publication supabase_realtime add table estimate_group_actions;
  end if;
end $$;

-- ─── Submit: same as migration 129, plus the merge of included alternates ─
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
  base_cost numeric;
  addl_items jsonb;
  addl_price numeric;
  addl_cost numeric;
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
      estimate_base_price = coalesce(estimate_base_price, (select contract_price from job_financials where job_id = target_job_id)),
      estimate_base_projected_cost = coalesce(estimate_base_projected_cost, projected_cost)
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
  select coalesce(sum(price), 0), coalesce(sum(projected_cost), 0)
  into addl_price, addl_cost
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

  -- Budget baseline: only touched when an included alternate was costed,
  -- so jobs with no alternates behave exactly as before.
  if addl_cost > 0 then
    select case when job_mode = 'multi' then coalesce((select projected_cost from estimate_scope_options where id = picked_option_id), projected_cost)
                else estimate_base_projected_cost end
    into base_cost
    from jobs where id = target_job_id;
    update jobs set projected_cost = coalesce(base_cost, 0) + addl_cost where id = target_job_id;
  end if;

  -- Copy each included alternate's action list and cost lines into the base
  -- so Work Orders, Schedule and Budget see the work the customer chose.
  -- Clear any earlier copies first so a re-submit never doubles them up.
  delete from job_scope_actions where job_id = target_job_id and merged_from_group_id is not null;
  delete from job_estimate_items where job_id = target_job_id and merged_from_group_id is not null;

  insert into job_scope_actions (job_id, description, trade, unit_label, quantity, area, merged_from_group_id)
  select a.job_id, a.description, a.trade, a.unit_label, a.quantity, a.area, a.group_id
  from estimate_group_actions a
  join estimate_groups g on g.id = a.group_id
  where a.job_id = target_job_id and g.included = true;

  insert into job_estimate_items (job_id, category, cost_type, description, quantity, unit_label, unit_price, source, buffer_note, image_url, image_storage_path, image_source, merged_from_group_id)
  select i.job_id, i.category, i.cost_type, i.description, i.quantity, i.unit_label, i.unit_price, i.source, i.buffer_note, i.image_url, i.image_storage_path, i.image_source, i.group_id
  from job_estimate_items i
  join estimate_groups g on g.id = i.group_id
  where i.job_id = target_job_id and g.included = true;
end;
$$;

grant execute on function submit_estimate_groups(uuid) to authenticated;

-- Notes
-- Rollback: nothing outside this migration depends on it. To undo, drop
-- table estimate_group_actions and the added columns, and restore
-- submit_estimate_groups from migration 129.
