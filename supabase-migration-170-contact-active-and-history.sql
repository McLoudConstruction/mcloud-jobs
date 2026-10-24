-- Migration 170: deactivate a contact, and keep a history of where contacts have worked.
--
-- Run after 169. Safe to run twice.
--
-- 1. Active or inactive
--    contacts.is_active (default true). An inactive person is someone you no longer deal with: they
--    left the industry, retired, or are simply dead weight. They stay in People with all their
--    touches and history, but:
--      * the People list hides them unless "Show inactive" is ticked (the app does that part)
--      * no automated email goes to them. _outreach_blocked_reason() now returns 'inactive', and
--        enrollment, the send queue and the bot API all use that one function. A shared address
--        (a group inbox) is blocked only when every person on it is inactive.
--      * inactive_since records when they were switched off. The database sets it, the app cannot.
--    Reactivating clears it. Nothing else about the person changes.
--
-- 2. Contact history
--    contact_history keeps one row per past job: company, position, the property or portfolio they
--    ran, a start and end month, and a note (who they worked with, why they left). The person's
--    current job stays in the usual fields on the person (company, position, property). When one of
--    those changes, the app offers to log the old job here.
--    Property management has high turnover and people move between the same few companies, so the
--    note and the company names are what let you say "you used to work with ...".
--    company_id is filled in by the app when the name matches a company in Companies, and is left
--    empty otherwise. Deleting a company only unlinks it, the name stays. Deleting a person removes
--    their history (the owner delete preview lists it, because it follows foreign keys).
--
-- Not changed: the bot API. A bot sees an inactive person as can_email false with blocked_reason
-- 'inactive'. It cannot set or clear the flag.

alter table contacts add column if not exists is_active boolean not null default true;
alter table contacts add column if not exists inactive_since timestamptz;
create index if not exists contacts_inactive_idx on contacts (id) where not is_active;

-- inactive_since belongs to the database. Whatever the app sends for it is ignored.
create or replace function _contacts_active_stamp()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.inactive_since := case when new.is_active then null else coalesce(new.inactive_since, now()) end;
  elsif new.is_active is distinct from old.is_active then
    new.inactive_since := case when new.is_active then null else now() end;
  else
    new.inactive_since := old.inactive_since;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_active_stamp on contacts;
create trigger contacts_active_stamp
  before insert or update on contacts
  for each row execute function _contacts_active_stamp();

-- ── No automated email to an inactive person ──
-- Same function as migration 167, with one added check (marked inactive).
create or replace function _outreach_blocked_reason(p_email text, p_property_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  addr text := lower(btrim(coalesce(p_email, '')));
  v text;
begin
  if addr = '' then return 'no_email'; end if;
  if exists (select 1 from outreach_suppressions s where s.email = addr) then return 'suppressed'; end if;
  if exists (select 1 from contacts c where lower(btrim(c.contact_email)) = addr and c.automated_emails_opt_out) then return 'opted_out'; end if;

  select c.email_blocked_reason into v
  from contacts c
  where lower(btrim(c.contact_email)) = addr and c.email_blocked_reason is not null
  order by c.email_blocked_at desc nulls last
  limit 1;
  if v is not null then return v; end if;

  -- A deactivated person. If the address is shared (a group inbox), it is blocked only when
  -- every person who uses it is inactive.
  if exists (select 1 from contacts c where lower(btrim(c.contact_email)) = addr)
     and not exists (select 1 from contacts c where lower(btrim(c.contact_email)) = addr and c.is_active) then
    return 'inactive';
  end if;

  if p_property_id is not null then
    select case when p.dnc_source = 'company' then 'company_do_not_contact' else 'do_not_contact' end into v
    from properties p where p.id = p_property_id and p.do_not_contact;
    if v is not null then return v; end if;
    if exists (select 1 from properties p join companies co on co.id = p.company_id where p.id = p_property_id and co.do_not_contact) then
      return 'company_do_not_contact';
    end if;
  end if;

  -- A person at a do not contact company, or at one of its properties.
  if exists (
    select 1
    from contacts c
    left join properties pr on pr.id = c.property_id
    join companies co on co.id = coalesce(c.company_id, pr.company_id)
    where lower(btrim(c.contact_email)) = addr and co.do_not_contact
  ) then
    return 'company_do_not_contact';
  end if;
  if exists (select 1 from companies co where co.do_not_contact and lower(btrim(co.contact_email)) = addr) then
    return 'company_do_not_contact';
  end if;
  return null;
end;
$$;

-- ── Contact history ──

create table if not exists contact_history (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  company_name text,
  company_id uuid references companies(id) on delete set null,
  position text,
  property_name text,
  started_on date,
  ended_on date,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_history_not_empty
    check (nullif(btrim(coalesce(company_name, '')), '') is not null or nullif(btrim(coalesce(position, '')), '') is not null),
  constraint contact_history_dates_in_order
    check (started_on is null or ended_on is null or started_on <= ended_on)
);

create index if not exists contact_history_contact_idx on contact_history (contact_id, ended_on desc nulls last, started_on desc nulls last);
create index if not exists contact_history_company_idx on contact_history (company_id) where company_id is not null;
create index if not exists contact_history_company_name_idx on contact_history (lower(btrim(company_name)));

alter table contact_history enable row level security;
drop policy if exists "Admin full access to contact_history" on contact_history;
create policy "Admin full access to contact_history" on contact_history for all
  using (is_admin()) with check (is_admin());

-- Notes
--  * Rollback: drop table contact_history; drop trigger contacts_active_stamp on contacts; drop function
--    _contacts_active_stamp(); alter table contacts drop column is_active, drop column inactive_since;
--    then re-run the _outreach_blocked_reason function from migration 167.
