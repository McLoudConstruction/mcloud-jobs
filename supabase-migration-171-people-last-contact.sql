-- Migration 171: when each person was last contacted.
--
-- Run after 170. Safe to run twice.
--
-- The People table and the contact popup show a small coloured dot beside each name:
--   green   contacted in the last 30 days
--   yellow  31 to 60 days ago
--   red     more than 60 days ago, or never
-- The app works out the colour. This function supplies the date.
--
-- What counts as contacted matches the "Last contacted" date on a property: something reached
-- the person or they replied. A missed call (no answer), a note, a bounce, an open or a click
-- does not count. Counted:
--   touches (staff or bot)   sent, connected, voicemail, replied, interested, not interested,
--                            unsubscribed, meeting set
--   sequence emails          sent, replied, unsubscribed
--   mailbox email            any message to or from the person, either direction
--
-- The same sources as the Touches panel on the person, matched the same way: by the person on
-- the record, or by any of their email addresses (email and billing email, any case).
-- Only people with at least one counted contact are returned. Anyone missing is "never".
--
-- Admin only, like the rest of the CRM functions.

create or replace function _crm_counts_as_contact(p_kind text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_kind, '') in (
    'sent', 'received', 'connected', 'voicemail', 'replied',
    'interested', 'not_interested', 'unsubscribed', 'meeting_set'
  );
$$;

create or replace function crm_people_last_contact()
returns table (contact_id uuid, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (coalesce(is_admin(), false) or _is_trusted_context()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  return query
  with addr as (
    select c.id as cid, a.email
    from contacts c
    cross join lateral unnest(_crm_emails(c.contact_email) || _crm_emails(c.billing_email)) as a(email)
  ), hits as (
    -- touches logged on the person
    select t.contact_id as cid, t.sent_at as at
    from outreach_touches t
    where t.contact_id is not null and _crm_counts_as_contact(t.outcome)
    union all
    -- touches logged against one of their addresses
    select ad.cid, t.sent_at
    from outreach_touches t
    join addr ad on ad.email = lower(t.to_email)
    where _crm_counts_as_contact(t.outcome)
    union all
    -- sequence emails to the person
    select en.contact_id, e.created_at
    from outreach_events e
    join outreach_enrollments en on en.id = e.enrollment_id
    where en.contact_id is not null and _crm_counts_as_contact(e.event_type)
    union all
    -- sequence emails to one of their addresses
    select ad.cid, e.created_at
    from outreach_events e
    join outreach_enrollments en on en.id = e.enrollment_id
    join addr ad on ad.email = lower(en.to_email)
    where _crm_counts_as_contact(e.event_type)
    union all
    -- mailbox email to or from one of their addresses
    select ad.cid, m.received_at
    from addr ad
    join email_messages m on m.participants @> array[ad.email]
  )
  select h.cid, max(h.at)
  from hits h
  group by h.cid;
end;
$$;

revoke all on function _crm_counts_as_contact(text) from public, anon;
revoke all on function crm_people_last_contact() from public, anon;
grant execute on function crm_people_last_contact() to authenticated;

-- Notes
--  * Rollback: drop function crm_people_last_contact(); drop function _crm_counts_as_contact(text);
--    The app then shows no dots and keeps working.
