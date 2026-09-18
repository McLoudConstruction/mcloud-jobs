-- Run in Supabase SQL Editor after migration 114. Safe to re-run.
--
-- Two things:
-- 1. Structured RFP proposals — replaces the single free-text box with
--    a proposal-document upload plus a few real fields (duration, bid
--    amount, exclusions/inclusions) so a bid actually reads like a bid.
-- 2. Per-RFP messaging — sub_messages can now be tagged to a specific
--    rfp_recipient, not just a company/job, so a question asked from an
--    RFP shows up coded to that RFP on the staff side instead of
--    dropping into the general company thread.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Structured proposal fields on rfp_recipients
-- ═══════════════════════════════════════════════════════════════════════
alter table rfp_recipients add column if not exists proposal_amount numeric(12,2);
alter table rfp_recipients add column if not exists proposal_duration text;
alter table rfp_recipients add column if not exists proposal_exclusions text;

comment on column rfp_recipients.proposal_text is 'Optional free-text notes accompanying the structured proposal fields — no longer the primary way a sub responds.';
comment on column rfp_recipients.proposal_files is 'The proposal document(s) uploaded via "Upload Proposal" — [{name, storage_path}].';
comment on column rfp_recipients.proposal_amount is 'Bid amount in dollars.';
comment on column rfp_recipients.proposal_duration is 'Expected project duration as the sub described it, e.g. "3 weeks" or "10 business days".';
comment on column rfp_recipients.proposal_exclusions is 'Anything out of the norm the sub is including or excluding from the bid.';

-- submit_rfp_proposal grows the new fields, all optional/nullable so a
-- partially-filled draft never fails to save. Signature adds params
-- after the existing ones so nothing else that calls this breaks.
create or replace function submit_rfp_proposal(
  target_recipient_id uuid,
  proposal_text_in text,
  proposal_files_in jsonb,
  proposal_amount_in numeric default null,
  proposal_duration_in text default null,
  proposal_exclusions_in text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  target_company_id uuid;
  is_authorized boolean;
begin
  select company_id into target_company_id from rfp_recipients where id = target_recipient_id;
  if target_company_id is null then
    raise exception 'Request not found';
  end if;
  -- Admin login only (same "money things" split as accept/decline work order) — crew is view-only.
  select exists (
    select 1 from sub_portal_users
    where company_id = target_company_id and email = caller_email and role = 'admin'
  ) into is_authorized;
  if not is_authorized then
    raise exception 'Not authorized to respond to this request';
  end if;

  update rfp_recipients
  set proposal_text = proposal_text_in,
      proposal_files = coalesce(proposal_files_in, '[]'::jsonb),
      proposal_amount = proposal_amount_in,
      proposal_duration = nullif(trim(proposal_duration_in), ''),
      proposal_exclusions = nullif(trim(proposal_exclusions_in), ''),
      responded_at = now(),
      status = case when status in ('sent', 'viewed') then 'responded' else status end
  where id = target_recipient_id;
end;
$$;
grant execute on function submit_rfp_proposal(uuid, text, jsonb, numeric, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Per-RFP messaging — sub_messages gains an optional rfp_recipient_id.
--    Kept alongside (not instead of) job_id: a message can be about an
--    RFP without staff having to open that RFP to know that.
-- ═══════════════════════════════════════════════════════════════════════
alter table sub_messages add column if not exists rfp_recipient_id uuid references rfp_recipients(id) on delete cascade;

create index if not exists sub_messages_rfp_recipient_id_idx on sub_messages(rfp_recipient_id);

-- send_sub_message grows an optional target_rfp_recipient_id, appended
-- last so the sub-portal's general Messages page (which doesn't pass
-- one) keeps working unchanged. When given, it's verified to belong to
-- the calling company and its job_id is used automatically so the
-- message still shows up in the right job context too.
create or replace function send_sub_message(
  target_company_id uuid,
  target_job_id uuid,
  message_in text,
  target_rfp_recipient_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  company_name_text text;
  resolved_job_id uuid := target_job_id;
begin
  if not is_sub_portal_member(target_company_id) then
    raise exception 'Not authorized';
  end if;
  if message_in is null or trim(message_in) = '' then
    raise exception 'Message cannot be empty';
  end if;

  if target_rfp_recipient_id is not null then
    if not exists (
      select 1 from rfp_recipients
      where id = target_rfp_recipient_id and company_id = target_company_id
    ) then
      raise exception 'That request is not visible to this company';
    end if;
    if resolved_job_id is null then
      select r.job_id into resolved_job_id from rfps r
      join rfp_recipients rr on rr.rfp_id = r.id
      where rr.id = target_rfp_recipient_id;
    end if;
  end if;

  if resolved_job_id is not null and not exists (select 1 from sub_visible_jobs where id = resolved_job_id) then
    raise exception 'That job is not visible to this company';
  end if;

  insert into sub_messages (company_id, job_id, sender, sender_email, message, rfp_recipient_id)
  values (target_company_id, resolved_job_id, 'sub', caller_email, trim(message_in), target_rfp_recipient_id);

  select company_name into company_name_text from companies where id = target_company_id;
  insert into notifications (message, job_id)
  values (coalesce(company_name_text, 'A subcontractor') || ': ' || left(trim(message_in), 140), resolved_job_id);
end;
$$;
grant execute on function send_sub_message(uuid, uuid, text, uuid) to authenticated;
