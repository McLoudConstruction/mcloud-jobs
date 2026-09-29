-- Migration 141 — Estimating assemblies, margin/win-rate insight, sub scoring
--
-- Four independent pieces, all read-mostly on top of data you already have:
--
--   • assembly_templates / assembly_template_items — reusable Good/Better/Best
--     (labelled here as Low/Medium/High, your terms) scope-item kits for
--     Kitchen and Bath remodels. Staff manage these; applying one to a job
--     just copies its items into jobs.scope_items, no new machinery needed
--     for that part.
--
--   • estimate_margin_benchmark(job_type) — compares a job type's historical
--     margin (final contract price vs. what subcontractors were actually
--     paid on it) so a new estimate can be checked against your own past
--     jobs, not a market price book. Deliberately NOT built on a granular
--     per-item price list — sub pricing varies too much job to job for that
--     to mean anything; job-level margin history is the honest version.
--
--   • estimate_win_rate(job_type) — win/loss counts from jobs that were
--     actually priced (contract_price set) and reached a decision (won
--     forward, or marked Lost).
--
--   • sub_reliability_scores() — one line per sub combining what's already
--     tracked separately: compliance status, work-order decline rate, and
--     punch-item follow-through. No new tracking, just one view of it.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Assemblies
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists assembly_templates (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('kitchen', 'bath')),
  tier text not null check (tier in ('low', 'medium', 'high')),
  label text not null,
  description text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assembly_templates_cat_idx on assembly_templates (category, tier, sort_order);

alter table assembly_templates enable row level security;
drop policy if exists "Admin can do everything on assembly_templates" on assembly_templates;
create policy "Admin can do everything on assembly_templates" on assembly_templates for all using (is_admin()) with check (is_admin());
drop policy if exists "PM can view assembly_templates" on assembly_templates;
create policy "PM can view assembly_templates" on assembly_templates for select using (is_pm());

create table if not exists assembly_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references assembly_templates(id) on delete cascade,
  text text not null,
  price_low numeric,
  price_high numeric,
  sort_order int not null default 0
);
create index if not exists assembly_template_items_template_idx on assembly_template_items (template_id, sort_order);

alter table assembly_template_items enable row level security;
drop policy if exists "Admin can do everything on assembly_template_items" on assembly_template_items;
create policy "Admin can do everything on assembly_template_items" on assembly_template_items for all using (is_admin()) with check (is_admin());
drop policy if exists "PM can view assembly_template_items" on assembly_template_items;
create policy "PM can view assembly_template_items" on assembly_template_items for select using (is_pm());

do $$ begin
  alter publication supabase_realtime add table assembly_templates, assembly_template_items;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Price staleness — stamp when a job's contract price was last set/changed
-- ═══════════════════════════════════════════════════════════════════════
alter table job_financials add column if not exists priced_at timestamptz;
alter table app_settings add column if not exists estimate_staleness_days integer not null default 14;

create or replace function trg_job_financials_priced_at()
returns trigger
language plpgsql
as $$
begin
  if NEW.contract_price is distinct from OLD.contract_price then
    NEW.priced_at := now();
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_job_financials_priced_at on job_financials;
create trigger trg_job_financials_priced_at before update of contract_price on job_financials
  for each row execute function trg_job_financials_priced_at();

-- Backfill so existing priced jobs aren't flagged stale the instant this ships.
update job_financials set priced_at = updated_at where contract_price is not null and priced_at is null;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Margin benchmark — staff-only, by job type, from your own closed jobs
-- ═══════════════════════════════════════════════════════════════════════
create or replace function estimate_margin_benchmark(p_job_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n int;
  avg_pct numeric;
begin
  if not coalesce(is_admin(), false) and not coalesce(is_pm(), false) then raise exception 'Staff only'; end if;
  with base as (
    select f.contract_price,
      (select coalesce(sum(w.amount), 0) from work_orders w where w.job_id = j.id and w.status in ('accepted', 'issued')) as sub_cost
    from jobs j
    join job_financials f on f.job_id = j.id
    where j.job_type = p_job_type
      and j.stage in ('completed', 'invoiced', 'paid')
      and f.contract_price > 0
  )
  select count(*), avg((contract_price - sub_cost) / contract_price * 100) into n, avg_pct from base;
  if coalesce(n, 0) < 3 then
    return jsonb_build_object('sample_size', coalesce(n, 0), 'avg_margin_pct', null);
  end if;
  return jsonb_build_object('sample_size', n, 'avg_margin_pct', round(avg_pct, 1));
end;
$$;
revoke all on function estimate_margin_benchmark(text) from public, anon;
grant execute on function estimate_margin_benchmark(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Win rate — priced jobs that reached a decision
-- ═══════════════════════════════════════════════════════════════════════
create or replace function estimate_win_rate(p_job_type text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  won int;
  lost int;
begin
  if not coalesce(is_admin(), false) and not coalesce(is_pm(), false) then raise exception 'Staff only'; end if;
  select
    count(*) filter (where j.stage <> 'lost'),
    count(*) filter (where j.stage = 'lost')
  into won, lost
  from jobs j
  join job_financials f on f.job_id = j.id
  where f.contract_price > 0
    and j.stage not in ('new', 'inspected', 'proposal_delivered')
    and (p_job_type is null or j.job_type = p_job_type);
  return jsonb_build_object(
    'won', coalesce(won, 0), 'lost', coalesce(lost, 0),
    'win_rate_pct', case when coalesce(won, 0) + coalesce(lost, 0) > 0 then round(won::numeric / (won + lost) * 100, 1) else null end
  );
end;
$$;
revoke all on function estimate_win_rate(text) from public, anon;
grant execute on function estimate_win_rate(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Sub reliability — one score from signals already tracked separately
-- ═══════════════════════════════════════════════════════════════════════
create or replace function sub_reliability_scores()
returns table (
  company_id uuid, company_name text, compliance_overall text,
  work_orders_offered int, work_orders_declined int, decline_rate_pct numeric,
  punch_assigned int, punch_open int, punch_overdue int,
  score int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(is_admin(), false) and not coalesce(is_pm(), false) then raise exception 'Staff only'; end if;
  return query
  with wo as (
    select w.company_id,
      count(*)::int as offered,
      count(*) filter (where w.status = 'declined')::int as declined
    from work_orders w
    where w.company_id is not null
    group by w.company_id
  ),
  pu as (
    select p.assigned_company_id as company_id,
      count(*)::int as assigned,
      count(*) filter (where p.status in ('open', 'in_progress'))::int as open_now,
      count(*) filter (where p.status in ('open', 'in_progress') and p.due_date is not null and p.due_date < _app_today())::int as overdue
    from punch_items p
    where p.assigned_company_id is not null
    group by p.assigned_company_id
  ),
  comp as (
    select o.company_id, o.overall from sub_compliance_overview() o
  )
  select
    c.id, c.company_name,
    coalesce(comp.overall, 'exempt'),
    coalesce(wo.offered, 0), coalesce(wo.declined, 0),
    case when coalesce(wo.offered, 0) > 0 then round(wo.declined::numeric / wo.offered * 100, 1) else null end,
    coalesce(pu.assigned, 0), coalesce(pu.open_now, 0), coalesce(pu.overdue, 0),
    greatest(0, least(100, round(
      100
      - case comp.overall when 'noncompliant' then 30 when 'expiring' then 10 else 0 end
      - case when coalesce(wo.offered, 0) > 0 then least(30, (wo.declined::numeric / wo.offered) * 100 * 0.5) else 0 end
      - least(30, coalesce(pu.overdue, 0) * 10)
    )))::int
  from companies c
  left join wo on wo.company_id = c.id
  left join pu on pu.company_id = c.id
  left join comp on comp.company_id = c.id
  where c.company_type = 'Subcontractor'
  order by 10 asc nulls last, c.company_name;
end;
$$;
revoke all on function sub_reliability_scores() from public, anon;
grant execute on function sub_reliability_scores() to authenticated;
