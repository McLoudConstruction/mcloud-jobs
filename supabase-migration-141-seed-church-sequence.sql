-- Run in Supabase SQL Editor after migration 140. Safe to re-run.
--
-- Starter sequence for the church vertical: two emails, a phone call, and a
-- closing email over about two weeks. It is created INACTIVE so nothing can be
-- enrolled until you have read it, edited it, sent yourself a test, and
-- switched it on (Sales, then Outreach, then Sequences).
--
-- Re-running refreshes the starter copy, but only while the sequence is still
-- inactive and nobody has been enrolled in it. Once you activate it or enroll
-- anyone, this migration leaves it alone, so your edits are never overwritten.
--
-- Merge tags: {{first_name}}, {{property_name}}, {{sender_name}}. Your
-- signature, mailing address and an unsubscribe link are added automatically.

do $$
declare
  seq_id uuid;
begin
  -- Remove earlier drafts of this seed (including one that used a different
  -- name), but only if they are unused.
  delete from outreach_sequences s
  where (s.name = U&'Churches \2014 introduction' or s.name = 'Churches introduction')
    and not s.active
    and not exists (select 1 from outreach_enrollments e where e.sequence_id = s.id);

  if exists (select 1 from outreach_sequences where name = 'Churches introduction') then
    return;
  end if;

  insert into outreach_sequences (name, vertical, description, active)
  values (
    'Churches introduction',
    'church',
    'Two emails, a call, and a closing note over about two weeks. Open to projects of any size. Starter copy, so edit before switching on.',
    false
  )
  returning id into seq_id;

  insert into outreach_sequence_steps (sequence_id, step_number, step_type, delay_days, subject, body_text, task_note)
  values
  (seq_id, 1, 'email', 0,
   'Building projects at {{property_name}}',
   $body$Hi {{first_name}},

I'm {{sender_name}} with McLoud Construction, a Kansas City area contractor. We handle capital improvement work on commercial and community buildings, from the larger repair and replacement projects that get planned a year or two ahead down to the smaller fixes that can't wait.

I'm reaching out to churches in Jackson County because building work often falls to a small facilities team or a volunteer committee, and it helps to have a contractor you can call for either kind of job. If {{property_name}} has a project on the horizon, a repair that keeps getting pushed back, or parts of the building you know are aging out, I'd be glad to walk the property and give you a straight answer and a rough budget. No charge and no obligation.

Who's the right person to talk to about building projects? If that's you, just reply with a good time. If it's someone else, a name would be a big help.

Thank you,
{{sender_name}}$body$,
   null),

  (seq_id, 2, 'email', 4,
   'Following up on {{property_name}}',
   $body$Hi {{first_name}},

Following up on my earlier note about building projects at {{property_name}}. I know these emails land at busy times, so if the timing isn't right, no problem at all.

Big or small, I'm happy to look at anything you're unsure about and tell you honestly whether it needs attention now or can wait.

Thank you,
{{sender_name}}$body$,
   null),

  (seq_id, 3, 'task', 3,
   null, null,
   'Call the church office: ask who handles building maintenance and repairs, and mention my emails.'),

  (seq_id, 4, 'email', 7,
   'Last note from McLoud Construction',
   $body$Hi {{first_name}},

I'll stop reaching out after this so I don't fill your inbox. If a project comes up down the road, big or small, or you'd just like a second opinion on something, you can reach me at this address any time.

Wishing everyone at {{property_name}} a good rest of the season.

{{sender_name}}$body$,
   null);
end $$;
