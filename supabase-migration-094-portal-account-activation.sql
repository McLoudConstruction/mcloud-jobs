-- Run in Supabase SQL Editor after migration 093. Safe to re-run.
--
-- Until now, "does this customer have portal access" was answered purely
-- by matching a freely-typed email string at query time — nothing ever
-- confirmed the person on the other end actually set up an account. This
-- table tracks a single per-person (per-email) activation record,
-- independent of any one job: a customer with two jobs only activates
-- once, and access continues to be decided by has_job_portal_access() as
-- before — this table is a record of "did they ever complete the account
-- setup flow", used to drive the invite/activate UX and the Portal Access
-- panel's status display.
--
-- Email is stored lowercased and trimmed so it's a stable join key
-- regardless of casing entered anywhere else in the app (see migration 093
-- for the same normalization applied to the RLS access check).

create table if not exists portal_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  invite_token uuid,
  invite_token_expires_at timestamptz,
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists portal_accounts_invite_token_idx on portal_accounts (invite_token);

alter table portal_accounts enable row level security;

-- Admin (staff) can read/manage every row — used by the Portal Access
-- panel to show activation status.
drop policy if exists "Admin full access to portal_accounts" on portal_accounts;
create policy "Admin full access to portal_accounts" on portal_accounts for all
  using (is_admin()) with check (is_admin());

-- No anon/customer policy at all — the activation page never queries this
-- table directly. It goes through /api/portal/activate, which uses the
-- service-role key to validate the token server-side. That's deliberate:
-- a directly-queryable-by-token row would let anyone who guesses or
-- intercepts a token enumerate accounts before providing a password.
