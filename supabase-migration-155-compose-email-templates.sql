-- Run in Supabase SQL Editor after migration 154. Safe to re-run.
--
-- Saved email templates for one click composing. A template is a name, a
-- subject line and a body. Clicking "Email" next to a contact, property or
-- company opens a new message in the person's own email provider (Gmail,
-- Outlook or their default mail app) with the subject and body already
-- filled in and the recipient addressed. Nothing is sent by this app.
--
-- Subject and body can hold merge fields that get filled in at click time:
--   {{first_name}} {{full_name}} {{company}} {{property}} {{sender_name}}
--
-- This is separate from lib/emailTemplates.js, which holds the automated
-- HTML emails the platform sends on its own.

create table if not exists email_compose_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null default '',
  body text not null default '',
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table email_compose_templates enable row level security;

drop policy if exists "Admin can do everything on email_compose_templates" on email_compose_templates;
create policy "Admin can do everything on email_compose_templates"
  on email_compose_templates for all using (is_admin()) with check (is_admin());

create index if not exists email_compose_templates_sort_idx on email_compose_templates (sort_order, name);

-- Starter templates, only added when the table is empty so re-running this
-- file never duplicates them or brings back ones that were deleted.
insert into email_compose_templates (name, subject, body, sort_order)
select v.name, v.subject, v.body, v.sort_order
from (values
  (
    'Intro email',
    'Quick introduction from McLoud Construction',
    E'Hi {{first_name}},\n\nMy name is {{sender_name}} and I run McLoud Construction. We handle capital improvement projects for commercial properties around the Kansas City area, and I wanted to introduce myself.\n\nIf you have any upcoming projects at {{property}}, I would be glad to walk the site and give you a no pressure look at options and budget.\n\nWould a short call or a quick visit work this week?\n\nThanks,\n{{sender_name}}\nMcLoud Construction',
    10
  ),
  (
    'Follow up',
    'Following up',
    E'Hi {{first_name}},\n\nI wanted to follow up on my last note. If the timing is not right, no problem at all. If there is anything coming up at {{property}} that you would like a second set of eyes on, I am happy to help.\n\nThanks,\n{{sender_name}}\nMcLoud Construction',
    20
  ),
  (
    'Thank you after a visit',
    'Thanks for your time',
    E'Hi {{first_name}},\n\nThank you for taking the time to meet with me today. I appreciate it. I will put together what we discussed and get it over to you shortly.\n\nIn the meantime, let me know if any questions come up.\n\nThanks,\n{{sender_name}}\nMcLoud Construction',
    30
  )
) as v(name, subject, body, sort_order)
where not exists (select 1 from email_compose_templates);
