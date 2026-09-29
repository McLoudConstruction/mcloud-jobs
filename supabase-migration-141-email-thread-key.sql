-- Migration 141 — Conversation threading for the Inbox
--
-- Every communication sent from the platform is filed into email_messages
-- (now done centrally in lib/sendMail.js), and replies are filed by the
-- inbound sync. thread_key groups them into one conversation per job +
-- subject, with "Re:"/"Fwd:" prefixes ignored so a reply lands in the
-- thread of the message it answers. Rules match normalizeSubjectForThread()
-- in lib/emailThreading.js. Safe to re-run.

alter table email_messages add column if not exists thread_key text;

-- Backfill existing rows.
update email_messages
set thread_key = job_id::text || ':' || lower(trim(regexp_replace(
      regexp_replace(coalesce(subject, ''), '^(\s*(re|fwd?|fw)\s*:\s*)+', '', 'i'),
      '\s+', ' ', 'g')))
where thread_key is null and job_id is not null;

create index if not exists email_messages_thread_idx on email_messages (thread_key, received_at);
