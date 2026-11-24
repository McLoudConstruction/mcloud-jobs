-- 051: Day 1 steps on a water loss: arrival safety check, work authorization, walkthrough (category).
-- Each completed step is one row that never changes. A later row for the same kind replaces it in the app
-- (the category can be raised mid-job, and the change stays in the history). Run once in the Supabase SQL Editor.

create table if not exists public.job_water_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('safety', 'authorization', 'walkthrough')),
  data jsonb not null default '{}'::jsonb,          -- safety: checks, source_stopped, asbestos flag; walkthrough: category and reason
  signer_name text,                                  -- authorization only
  signature_png text,                                -- authorization only
  customer_absent boolean not null default false,    -- authorization: customer not present, so no signature (an e-sign follow-up is needed)
  done_at timestamptz not null default now(),        -- the database's time, not the phone's
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists job_water_steps_job_idx on public.job_water_steps (job_id, kind, created_at desc);

-- An authorization needs a name and signature, or "customer not present". Time is always the database's.
create or replace function public.job_water_step_guard()
returns trigger language plpgsql as $$
begin
  new.done_at := now();
  if new.kind = 'authorization' then
    if new.customer_absent then
      new.signature_png := null;
      new.signer_name := null;
    elsif new.signature_png is null or btrim(coalesce(new.signer_name, '')) = '' then
      raise exception 'AUTHORIZATION_NEEDS_SIGNATURE';
    end if;
  else
    new.customer_absent := false;
    new.signature_png := null;
    new.signer_name := null;
  end if;
  return new;
end;
$$;
drop trigger if exists job_water_steps_guard on public.job_water_steps;
create trigger job_water_steps_guard before insert on public.job_water_steps
  for each row execute function public.job_water_step_guard();

alter table public.job_water_steps enable row level security;
create policy job_water_steps_select on public.job_water_steps for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
create policy job_water_steps_insert on public.job_water_steps for insert
  with check ((public.is_office_or_owner() or public.tech_assigned_to_job(job_id)) and public.job_open(job_id));
create policy job_water_steps_delete on public.job_water_steps for delete
  using (public.current_staff_role() = 'owner');
-- no update policy: a recorded step never changes
