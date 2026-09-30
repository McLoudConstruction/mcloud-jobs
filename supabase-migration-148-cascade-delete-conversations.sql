-- Run in Supabase SQL Editor after migration 147. Safe to re-run.
--
-- Deleting a job (project) now deletes its Inbox conversations too.
--
-- Customer portal chat (job_questions) and RFP messages (sub_messages tied to
-- an RFP, through rfp_recipients -> rfps -> jobs) already cascade. Two tables
-- did not: email_messages.job_id and sub_messages.job_id were "on delete set
-- null", so deleting a job left its emails and job tagged sub messages behind
-- as orphaned conversations under "System". Both become "on delete cascade".
--
-- Mail that was never tied to a job (sub applications, sign in links) has a
-- null job_id and is not touched. Sub messages with no job stay too.
--
-- Constraint names are looked up rather than assumed, since the originals were
-- unnamed inline foreign keys (migrations 106 and 114).

do $$
declare
  t text;
  c text;
begin
  foreach t in array array['email_messages', 'sub_messages'] loop
    for c in
      select con.conname
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
      where con.conrelid = t::regclass
        and con.contype = 'f'
        and con.confrelid = 'jobs'::regclass
        and att.attname = 'job_id'
    loop
      execute format('alter table %I drop constraint %I', t, c);
    end loop;

    execute format(
      'alter table %I add constraint %I foreign key (job_id) references jobs(id) on delete cascade',
      t, t || '_job_id_fkey'
    );
  end loop;
end $$;
