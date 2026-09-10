-- Run in Supabase SQL Editor after migration 080. Safe to re-run.
--
-- Lets a job have multiple saved proposals instead of the single
-- scope_items/additional_terms/contract_price baked directly onto the
-- jobs row. Each proposal is a full, independent, named snapshot you can
-- edit and send on its own link. One proposal per job can be marked
-- "Selected" — that's the one whose scope/terms/price get mirrored back
-- onto the jobs/job_financials row, so every existing surface (the
-- Contract page, the main /proposal document, PortalFeed, the
-- Scope/Terms tab, work order scope suggestions) keeps working exactly
-- as it does today without any changes, always reflecting whichever
-- proposal is currently Selected.

create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  name text not null default 'Proposal',
  scope_items jsonb not null default '[]'::jsonb,
  additional_terms jsonb not null default '[]'::jsonb,
  contract_price numeric,

  sent_at timestamptz,
  viewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table jobs add column if not exists selected_proposal_id uuid references proposals(id) on delete set null;

alter table proposals enable row level security;

-- Admin: full access, including delete.
drop policy if exists "Admin can do everything on proposals" on proposals;
create policy "Admin can do everything on proposals"
  on proposals for all using (is_admin()) with check (is_admin());

-- Customer: read-only, and only proposals that have actually been sent —
-- matches the sent-tracking gate already used for job_updates (migration
-- 019). A saved draft proposal is never visible through a guessed URL.
drop policy if exists "Customers can view sent proposals on their own jobs" on proposals;
create policy "Customers can view sent proposals on their own jobs"
  on proposals for select using (
    sent_at is not null and has_job_portal_access(job_id)
  );

drop trigger if exists set_proposals_updated_at on proposals;
create trigger set_proposals_updated_at
  before update on proposals
  for each row execute function set_updated_at();

-- Marks a specific proposal as viewed the first time its public link is
-- opened by the customer — mirrors mark_proposal_viewed, scoped to one
-- proposal instead of the whole job. security definer so a customer
-- session (which only has the read policy above) can still set this.
create or replace function mark_proposal_doc_viewed(target_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update proposals
  set viewed_at = now()
  where id = target_proposal_id and viewed_at is null;
end;
$$;

-- Realtime, matching the pattern used for jobs/job_financials/etc.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'proposals'
  ) then
    alter publication supabase_realtime add table proposals;
  end if;
end $$;

-- One-time backfill: every job that already has scope items, terms, or a
-- price gets a single "Proposal 1" row created from its current data and
-- immediately marked Selected, so existing jobs keep behaving exactly as
-- they do today the moment this ships — nothing to redo by hand.
do $$
declare
  j record;
  new_id uuid;
begin
  for j in
    select id, scope_items, additional_terms
    from jobs
    where selected_proposal_id is null
      and (
        coalesce(jsonb_array_length(scope_items), 0) > 0
        or coalesce(jsonb_array_length(additional_terms), 0) > 0
        or exists (select 1 from job_financials f where f.job_id = jobs.id and f.contract_price is not null)
      )
  loop
    insert into proposals (job_id, name, scope_items, additional_terms, contract_price, sent_at)
    select j.id, 'Proposal 1', coalesce(j.scope_items, '[]'::jsonb), coalesce(j.additional_terms, '[]'::jsonb),
           f.contract_price, jb.proposal_sent_at
    from jobs jb
    left join job_financials f on f.job_id = jb.id
    where jb.id = j.id
    returning id into new_id;

    update jobs set selected_proposal_id = new_id where id = j.id;
  end loop;
end $$;
