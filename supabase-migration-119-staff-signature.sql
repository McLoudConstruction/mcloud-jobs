-- Run in Supabase SQL Editor after migration 118. Safe to re-run.
--
-- Adds a per-staff email signature, set centrally by the Owner in
-- Settings -> Users (same "Owner manages every staff field" pattern
-- already used there for full_name/role/password — see migration 079).
-- sendMail() (lib/sendMail.js) looks this up by the sending staff
-- member's email and appends it to every outbound email, so a customer
-- sees who they're actually talking to instead of a generic footer.
--
-- Stored as HTML (pasted from whatever the staff member already uses in
-- Gmail/Outlook, or built from a small upload here) rather than a
-- plain-text field, so an existing signature with a logo/formatting
-- can be dropped in as-is.

alter table staff_users add column if not exists signature_html text;

comment on column staff_users.signature_html is
  'Email signature HTML appended to every outbound email sent by this staff member (see lib/sendMail.js). Null/empty = no signature appended. Owner-managed, same RLS as the rest of this table.';
