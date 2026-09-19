-- Run in Supabase SQL Editor after migration 117.
-- Safe to re-run.
--
-- request_schedule_event only let a sub request against a job in
-- sub_visible_jobs — which requires an existing work_orders row, i.e. a
-- job they've already been given SOME work on. That's too strict for a
-- Meeting or Site Visit request: a sub asking to walk a site is often
-- how they win the bid in the first place, so they need to be able to
-- request one on a job they're only bidding (an RFP recipient), before
-- any work order exists. This widens the visibility check to also
-- accept a job the company is an RFP recipient on.

create or replace function request_schedule_event(
  target_company_id uuid,
  target_job_id uuid,
  event_type_in text,
  description_in text,
  requested_date_in date,
  requested_time_in time default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  new_id uuid;
  company_name_text text;
  event_label text;
  job_visible boolean;
begin
  if not is_sub_portal_member(target_company_id) then
    raise exception 'Not authorized';
  end if;

  select
    exists (select 1 from sub_visible_jobs where id = target_job_id)
    or exists (
      select 1 from rfp_recipients rr
      join rfps r on r.id = rr.rfp_id
      where rr.company_id = target_company_id and r.job_id = target_job_id
    )
  into job_visible;

  if target_job_id is null or not job_visible then
    raise exception 'That job is not visible to this company';
  end if;
  if requested_date_in is null then
    raise exception 'Pick a date';
  end if;

  insert into schedule_requests (company_id, job_id, event_type, description, requested_date, requested_time, requested_by_email)
  values (target_company_id, target_job_id, coalesce(nullif(trim(event_type_in), ''), 'meeting'), nullif(trim(description_in), ''), requested_date_in, requested_time_in, caller_email)
  returning id into new_id;

  select company_name into company_name_text from companies where id = target_company_id;
  event_label := coalesce(nullif(trim(description_in), ''), initcap(replace(coalesce(nullif(trim(event_type_in), ''), 'meeting'), '_', ' ')));
  insert into notifications (message, job_id)
  values (coalesce(company_name_text, 'A subcontractor') || ' requested a schedule event for ' || to_char(requested_date_in, 'Mon DD') || ': ' || left(event_label, 100), target_job_id);

  return new_id;
end;
$$;
