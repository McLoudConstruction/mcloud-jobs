-- 159: cost types on estimate cost lines, and keep jobs.project_address in sync.
--
-- 1. job_estimate_items.cost_type: 'subcontractor' | 'labor' | 'supervision'.
--    These lines keep category = 'labor' so budget and totals are unchanged.
-- 2. jobs.project_address was only written when the Customer card was saved,
--    never when a job was created, so estimates showed no jobsite address
--    even though the structured fields were filled in. A trigger now composes
--    it from project_street/unit/city/state/zip whenever those change, and a
--    backfill fixes existing jobs.

alter table job_estimate_items add column if not exists cost_type text not null default 'subcontractor';
alter table job_estimate_items drop constraint if exists job_estimate_items_cost_type_check;
alter table job_estimate_items add constraint job_estimate_items_cost_type_check
  check (cost_type in ('subcontractor', 'labor', 'supervision'));

create or replace function compose_project_address(
  street text, unit text, city text, state text, zip text
) returns text language sql immutable as $$
  select nullif(btrim(concat_ws(', ',
    nullif(concat_ws(', ', nullif(btrim(coalesce(street, '')), ''), nullif(btrim(coalesce(unit, '')), '')), ''),
    nullif(concat_ws(' ',
      nullif(concat_ws(', ', nullif(btrim(coalesce(city, '')), ''), nullif(btrim(coalesce(state, '')), '')), ''),
      nullif(btrim(coalesce(zip, '')), '')), '')
  )), '');
$$;

create or replace function jobs_sync_project_address() returns trigger language plpgsql as $$
declare composed text;
begin
  composed := compose_project_address(NEW.project_street, NEW.project_unit, NEW.project_city, NEW.project_state, NEW.project_zip);
  if composed is not null and (
       TG_OP = 'INSERT'
       or NEW.project_street is distinct from OLD.project_street
       or NEW.project_unit   is distinct from OLD.project_unit
       or NEW.project_city   is distinct from OLD.project_city
       or NEW.project_state  is distinct from OLD.project_state
       or NEW.project_zip    is distinct from OLD.project_zip
       or coalesce(NEW.project_address, '') = ''
     ) then
    NEW.project_address := composed;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_jobs_sync_project_address on jobs;
create trigger trg_jobs_sync_project_address
  before insert or update on jobs
  for each row execute function jobs_sync_project_address();

-- Backfill jobs that have structured address fields but no composed address.
update jobs
   set project_address = compose_project_address(project_street, project_unit, project_city, project_state, project_zip)
 where coalesce(project_address, '') = ''
   and compose_project_address(project_street, project_unit, project_city, project_state, project_zip) is not null;
