-- ═══════════════════════════════════════════════════════════════════════
-- No-login share links.
--
-- Commercial clients (and anyone getting photos) shouldn't have to create
-- a portal account just to look at something. A share link is an
-- unguessable token in a URL that opens exactly ONE thing:
--   • kind 'proposal'      — the job's current estimate, or one specific
--                            saved proposal (proposal_id), view + download
--   • kind 'photo_folder'  — one named photo folder on a job, live (shows
--                            whatever is in the folder when opened)
--
-- Every link expires (30 days by default) and can be revoked. The table
-- has RLS on with an admin-only policy; the public pages never read it
-- directly — they go through /api/public/share/[token], which uses the
-- service-role client and returns only what that one link is for.
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  kind text not null check (kind in ('proposal', 'photo_folder')),
  job_id uuid not null references jobs(id) on delete cascade,
  proposal_id uuid references proposals(id) on delete cascade,
  folder text,

  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,

  created_by text,
  created_at timestamptz not null default now(),
  view_count integer not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,

  constraint share_links_photo_folder_needs_folder check (kind <> 'photo_folder' or folder is not null)
);

create index if not exists share_links_job_id_idx on share_links (job_id);

alter table share_links enable row level security;

drop policy if exists "Admin can do everything on share_links" on share_links;
create policy "Admin can do everything on share_links"
  on share_links for all using (is_admin()) with check (is_admin());
