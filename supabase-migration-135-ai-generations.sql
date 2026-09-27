-- Migration 135 — AI usage log
--
-- Every call to the new staff-only AI routes (/api/ai/*) writes one row here.
-- It is what the per-user hourly rate limit counts, and gives a simple record
-- of what was generated, for which job, and how many tokens it used. It stores
-- NO prompt or output text — only metadata — so it never becomes a second copy
-- of customer conversations.
--
-- Rows are written by the server with the service role. Staff can read them;
-- nobody can change or delete them from the app.

create table if not exists ai_generations (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  feature text not null,
  job_id uuid,
  model text,
  input_tokens integer,
  output_tokens integer,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ai_generations_staff_recent on ai_generations (staff_id, created_at desc);
create index if not exists ai_generations_created on ai_generations (created_at desc);

alter table ai_generations enable row level security;

drop policy if exists "Admin can read ai_generations" on ai_generations;
create policy "Admin can read ai_generations" on ai_generations for select using (is_admin());
