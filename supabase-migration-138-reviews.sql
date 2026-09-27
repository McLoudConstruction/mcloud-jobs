-- Migration 138 — In-platform customer reviews
--
-- Every completed job gets a private review request. The customer rates the
-- project on a public, unguessable-link page (no login). What happens next:
--
--   • Every review is saved here and shown to staff, whatever the rating.
--   • Low ratings (≤ 3) flag "needs follow-up" so someone calls the customer.
--   • Google is offered on the thank-you page only when the rating is at or
--     above a setting (default 4 stars). Set it to 1 to ask everyone.
--   • Nothing goes on the website until staff publish it AND the customer
--     ticked "you may show this publicly". The website feed's average and
--     count always include EVERY submitted review, published or not, so the
--     site can never show a rosier picture than the real one.
--
-- Whether a request goes out at all is decided per job: it waits while there
-- are open punch items, an unanswered customer message, an opt-out or (if
-- switched on) an unpaid balance, and staff can suppress it outright.
--
-- Only jobs completed AFTER this migration are picked up (jobs.completed_at
-- comes from migration 137, which does not backfill), so old customers are
-- never emailed out of the blue.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Settings & job flags
-- ═══════════════════════════════════════════════════════════════════════
alter table app_settings add column if not exists review_auto_request boolean not null default true;
alter table app_settings add column if not exists review_request_delay_days integer not null default 3;
alter table app_settings add column if not exists review_reminder_days integer not null default 5;   -- 0 = no reminder
alter table app_settings add column if not exists review_google_min_rating integer not null default 4; -- 1 = offer Google to everyone
alter table app_settings add column if not exists review_hold_if_open_punch boolean not null default true;
alter table app_settings add column if not exists review_hold_if_unpaid boolean not null default false;
alter table app_settings add column if not exists review_max_hold_days integer not null default 45;
alter table app_settings add column if not exists review_google_url text;

alter table jobs add column if not exists review_suppressed boolean not null default false;
alter table jobs add column if not exists review_suppressed_reason text;
alter table jobs add column if not exists review_requested_at timestamptz; -- from migration 066; harmless here

-- ═══════════════════════════════════════════════════════════════════════
-- 2. reviews
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'submitted', 'skipped')),
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  reminder_sent_at timestamptz,
  submitted_at timestamptz,
  hold_reason text,
  skip_reason text,
  rating smallint check (rating between 1 and 5),
  category_ratings jsonb not null default '{}',
  comment text,
  reviewer_name text,
  display_name text,
  project_label text,
  publish_consent boolean not null default false,
  published boolean not null default false,
  published_at timestamptz,
  featured boolean not null default false,
  needs_follow_up boolean not null default false,
  follow_up_done_at timestamptz,
  staff_note text,
  google_prompted boolean not null default false,
  google_clicked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reviews_submitted_has_rating check (status <> 'submitted' or rating is not null),
  constraint reviews_publish_needs_consent check (not published or (publish_consent and status = 'submitted'))
);

create index if not exists reviews_status_idx on reviews (status, send_after);
create index if not exists reviews_published_idx on reviews (published, featured) where published;

alter table reviews enable row level security;
drop policy if exists "Admin can read reviews" on reviews;
create policy "Admin can read reviews" on reviews for select using (is_admin());
drop policy if exists "Admin can update reviews" on reviews;
create policy "Admin can update reviews" on reviews for update using (is_admin()) with check (is_admin());
-- No insert/delete policy: rows are created by the functions below, and a
-- review can't be deleted from the app (unpublish it instead).

do $$ begin
  alter publication supabase_realtime add table reviews;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- What the customer wrote can't be edited by anyone with an app login —
-- including staff. Only the submit function (which sets a transaction-local
-- flag) or the SQL editor / service role can touch those columns.
create or replace function reviews_guard()
returns trigger
language plpgsql
as $$
declare
  writer boolean := coalesce(current_setting('mcloud.review_write', true), '') = '1' or _is_trusted_context();
begin
  if TG_OP = 'DELETE' then
    if writer then return old; end if;
    raise exception 'Reviews cannot be deleted. Unpublish it instead.';
  end if;
  if TG_OP = 'INSERT' then return new; end if;
  if not writer then
    if new.job_id is distinct from old.job_id
       or new.token is distinct from old.token
       or new.rating is distinct from old.rating
       or new.category_ratings is distinct from old.category_ratings
       or new.comment is distinct from old.comment
       or new.reviewer_name is distinct from old.reviewer_name
       or new.submitted_at is distinct from old.submitted_at
       or new.publish_consent is distinct from old.publish_consent
       or new.needs_follow_up is distinct from old.needs_follow_up
       or new.google_prompted is distinct from old.google_prompted
       or new.google_clicked_at is distinct from old.google_clicked_at then
      raise exception 'A submitted review cannot be edited.';
    end if;
    if new.status is distinct from old.status
       and (new.status = 'submitted' or old.status = 'submitted') then
      raise exception 'A submitted review cannot change status.';
    end if;
  end if;
  if new.published and not old.published then new.published_at := coalesce(new.published_at, now()); end if;
  if not new.published then new.published_at := null; new.featured := false; end if;
  return new;
end;
$$;

drop trigger if exists trg_reviews_guard on reviews;
create trigger trg_reviews_guard before update or delete on reviews
  for each row execute function reviews_guard();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Should this job be asked right now?
-- ═══════════════════════════════════════════════════════════════════════
-- Returns null when it's fine to send, otherwise a short code saying why not.
create or replace function review_hold_reason(p_job uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jobs%rowtype;
  s app_settings%rowtype;
begin
  select * into j from jobs where id = p_job;
  if j.id is null then return 'no_job'; end if;
  select * into s from app_settings where id = 1;
  if j.completed_at is null or j.stage not in ('completed', 'invoiced', 'paid') then return 'not_complete'; end if;
  if j.review_suppressed then return 'suppressed'; end if;
  if nullif(btrim(coalesce(j.customer_email, '')), '') is null then return 'no_email'; end if;
  if exists (select 1 from contacts c where lower(c.contact_email) = lower(j.customer_email) and c.automated_emails_opt_out) then
    return 'opted_out';
  end if;
  if coalesce(s.review_hold_if_open_punch, true)
     and exists (select 1 from punch_items p where p.job_id = p_job and p.status in ('open', 'in_progress', 'resolved')) then
    return 'open_punch';
  end if;
  if exists (
    select 1 from job_questions q
    where q.job_id = p_job and q.sender = 'customer' and q.responded_at is null
      and not exists (select 1 from job_questions a where a.job_id = p_job and a.sender = 'admin' and a.created_at > q.created_at)
  ) then
    return 'unanswered_message';
  end if;
  if coalesce(s.review_hold_if_unpaid, false) and j.stage <> 'paid' then return 'unpaid'; end if;
  return null;
end;
$$;

revoke all on function review_hold_reason(uuid) from public, anon;
grant execute on function review_hold_reason(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Scheduling (called by the daily cron with the service role)
-- ═══════════════════════════════════════════════════════════════════════
create or replace function _review_caller_ok()
returns boolean
language sql
stable
as $$ select coalesce(is_admin(), false) or _is_trusted_context(); $$;

-- Creates the 'scheduled' review row for newly completed jobs.
create or replace function ensure_review_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  s app_settings%rowtype;
begin
  if not _review_caller_ok() then raise exception 'Not allowed'; end if;
  select * into s from app_settings where id = 1;
  if not coalesce(s.review_auto_request, true) then return 0; end if;
  perform set_config('mcloud.review_write', '1', true);
  with ins as (
    insert into reviews (job_id, send_after, project_label)
    select j.id, j.completed_at + make_interval(days => greatest(coalesce(s.review_request_delay_days, 3), 0)), nullif(btrim(coalesce(j.job_type, '')), '')
    from jobs j
    where j.completed_at is not null
      and j.stage in ('completed', 'invoiced', 'paid')
      and not j.review_suppressed
      and j.review_requested_at is null
      and not exists (select 1 from reviews r where r.job_id = j.id)
    returning 1
  )
  select count(*) into n from ins;
  return n;
end;
$$;

-- Atomically picks the reviews that are due, marks them sent, and returns what
-- the caller needs to email them. Held ones stay scheduled (with the reason
-- recorded); ones held past the maximum are skipped so they don't linger.
create or replace function claim_review_sends(max_n integer default 25)
returns table (review_id uuid, job_id uuid, token text, customer_name text, customer_email text, job_number text, project_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r reviews%rowtype;
  hold text;
  s app_settings%rowtype;
  claimed integer := 0;
begin
  if not _review_caller_ok() then raise exception 'Not allowed'; end if;
  select * into s from app_settings where id = 1;
  perform set_config('mcloud.review_write', '1', true);
  for r in
    select * from reviews where status = 'scheduled' and send_after <= now() order by send_after for update skip locked
  loop
    exit when claimed >= greatest(max_n, 0);
    hold := review_hold_reason(r.job_id);
    if hold is null then
      update reviews set status = 'sent', sent_at = now(), hold_reason = null where id = r.id;
      update jobs set review_requested_at = coalesce(review_requested_at, now()) where id = r.job_id;
      insert into portal_notifications (recipient_kind, job_id, category, message, link_path, source_id)
      values ('customer', r.job_id, 'review_request', 'We''d love your feedback on your project.', '/review/' || r.token, r.id);
      claimed := claimed + 1;
      return query select r.id, r.job_id, r.token, j.customer_name, j.customer_email, j.job_number, r.project_label from jobs j where j.id = r.job_id;
    elsif hold in ('suppressed', 'opted_out', 'no_email') or r.send_after + make_interval(days => coalesce(s.review_max_hold_days, 45)) < now() then
      update reviews set status = 'skipped', skip_reason = case when hold in ('suppressed', 'opted_out', 'no_email') then hold else 'held_too_long:' || hold end, hold_reason = hold where id = r.id;
    else
      update reviews set hold_reason = hold where id = r.id;
    end if;
  end loop;
end;
$$;

-- One reminder to anyone who hasn't answered after N days.
create or replace function claim_review_reminders(max_n integer default 25)
returns table (review_id uuid, job_id uuid, token text, customer_name text, customer_email text, job_number text, project_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r reviews%rowtype;
  days integer;
  claimed integer := 0;
begin
  if not _review_caller_ok() then raise exception 'Not allowed'; end if;
  select coalesce(review_reminder_days, 0) into days from app_settings where id = 1;
  if coalesce(days, 0) <= 0 then return; end if;
  perform set_config('mcloud.review_write', '1', true);
  for r in
    select * from reviews where status = 'sent' and reminder_sent_at is null and sent_at <= now() - make_interval(days => days) order by sent_at for update skip locked
  loop
    exit when claimed >= greatest(max_n, 0);
    if review_hold_reason(r.job_id) in ('suppressed', 'opted_out', 'no_email', 'open_punch', 'unanswered_message') then
      -- A problem surfaced after the first email; don't nag.
      update reviews set reminder_sent_at = now() where id = r.id;
    else
      update reviews set reminder_sent_at = now() where id = r.id;
      claimed := claimed + 1;
      return query select r.id, r.job_id, r.token, j.customer_name, j.customer_email, j.job_number, r.project_label from jobs j where j.id = r.job_id;
    end if;
  end loop;
end;
$$;

-- If the email itself failed, put the request back so tomorrow's run retries.
create or replace function unclaim_review_send(p_review uuid, p_reminder boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _review_caller_ok() then raise exception 'Not allowed'; end if;
  perform set_config('mcloud.review_write', '1', true);
  if p_reminder then
    update reviews set reminder_sent_at = null where id = p_review and status = 'sent';
  else
    update reviews set status = 'scheduled', sent_at = null where id = p_review and status = 'sent';
  end if;
end;
$$;

-- Staff pressing "Send now": creates/opens the request immediately, ignoring
-- holds (a person decided). Returns the token so the browser can email it.
create or replace function staff_send_review_now(p_job uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r reviews%rowtype;
  j jobs%rowtype;
begin
  if not coalesce(is_admin(), false) then raise exception 'Staff only'; end if;
  select * into j from jobs where id = p_job;
  if j.id is null then raise exception 'Project not found'; end if;
  if nullif(btrim(coalesce(j.customer_email, '')), '') is null then raise exception 'This project has no customer email.'; end if;
  perform set_config('mcloud.review_write', '1', true);
  select * into r from reviews where job_id = p_job for update;
  if r.id is null then
    insert into reviews (job_id, status, sent_at, project_label)
    values (p_job, 'sent', now(), nullif(btrim(coalesce(j.job_type, '')), ''))
    returning * into r;
  elsif r.status = 'submitted' then
    raise exception 'This customer has already submitted a review.';
  elsif r.status <> 'sent' then
    update reviews set status = 'sent', sent_at = now(), skip_reason = null, hold_reason = null where id = r.id returning * into r;
  end if;
  update jobs set review_requested_at = coalesce(review_requested_at, now()) where id = p_job;
  return r.token;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. The customer's public page (link with an unguessable token, no login)
-- ═══════════════════════════════════════════════════════════════════════
create or replace function _review_google_url()
returns text
language sql
stable
security definer
set search_path = public
as $$ select coalesce(nullif(btrim(coalesce((select review_google_url from app_settings where id = 1), '')), ''), 'https://g.page/r/CSWyXady1jZxEBM/review'); $$;

create or replace function _review_display_name(p_reviewer text, p_customer text)
returns text
language plpgsql
immutable
as $$
declare
  n text := nullif(btrim(coalesce(p_reviewer, '')), '');
  parts text[];
begin
  n := coalesce(n, nullif(btrim(coalesce(p_customer, '')), ''));
  if n is null then return 'A McLoud customer'; end if;
  parts := regexp_split_to_array(n, '\s+');
  if array_length(parts, 1) = 1 then return parts[1]; end if;
  return parts[1] || ' ' || upper(left(parts[array_length(parts, 1)], 1)) || '.';
end;
$$;

create or replace function get_review_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r reviews%rowtype;
  j jobs%rowtype;
  min_rating integer;
begin
  select * into r from reviews where token = p_token and status in ('sent', 'submitted');
  if r.id is null then return jsonb_build_object('found', false); end if;
  select * into j from jobs where id = r.job_id;
  select coalesce(review_google_min_rating, 4) into min_rating from app_settings where id = 1;
  return jsonb_build_object(
    'found', true,
    'submitted', r.status = 'submitted',
    'first_name', split_part(btrim(coalesce(j.customer_name, '')), ' ', 1),
    'project_label', r.project_label,
    'rating', r.rating,
    'show_google', r.status = 'submitted' and r.rating >= min_rating and _review_google_url() is not null,
    'google_url', case when r.status = 'submitted' and r.rating >= min_rating then _review_google_url() end
  );
end;
$$;

create or replace function submit_review_by_token(
  p_token text, p_rating integer, p_categories jsonb, p_comment text, p_name text, p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r reviews%rowtype;
  j jobs%rowtype;
  cats jsonb := '{}'::jsonb;
  k text;
  v integer;
  min_rating integer;
  cmt text := nullif(btrim(coalesce(p_comment, '')), '');
  nm text := nullif(btrim(coalesce(p_name, '')), '');
  show_google boolean;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Please choose a star rating from 1 to 5.'; end if;
  select * into r from reviews where token = p_token and status in ('sent', 'submitted') for update;
  if r.id is null then raise exception 'This review link is not valid.'; end if;
  if r.status = 'submitted' then raise exception 'This review has already been submitted. Thank you!'; end if;
  if cmt is not null and length(cmt) > 2000 then raise exception 'Please keep your comments under 2,000 characters.'; end if;
  if nm is not null and length(nm) > 80 then nm := left(nm, 80); end if;
  if p_categories is not null and jsonb_typeof(p_categories) = 'object' then
    foreach k in array array['communication', 'quality', 'schedule', 'value'] loop
      if p_categories ? k then
        begin v := (p_categories ->> k)::integer; exception when others then v := null; end;
        if v between 1 and 5 then cats := cats || jsonb_build_object(k, v); end if;
      end if;
    end loop;
  end if;
  select * into j from jobs where id = r.job_id;
  select coalesce(review_google_min_rating, 4) into min_rating from app_settings where id = 1;

  perform set_config('mcloud.review_write', '1', true);
  update reviews set
    status = 'submitted', submitted_at = now(), rating = p_rating, category_ratings = cats,
    comment = cmt, reviewer_name = nm,
    display_name = _review_display_name(nm, j.customer_name),
    publish_consent = coalesce(p_consent, false) and cmt is not null,
    needs_follow_up = p_rating <= 3,
    hold_reason = null
  where id = r.id;

  show_google := p_rating >= min_rating and _review_google_url() is not null;
  if show_google then update reviews set google_prompted = true where id = r.id; end if;

  insert into notifications (message, job_id)
  values (case when p_rating <= 3
      then 'Low review (' || p_rating || ' stars) from ' || coalesce(nullif(j.customer_name, ''), 'a customer') || ' on job ' || coalesce(j.job_number, '') || ' — please follow up.'
      else 'New review: ' || p_rating || ' stars from ' || coalesce(nullif(j.customer_name, ''), 'a customer') || ' on job ' || coalesce(j.job_number, '') || '.' end,
    r.job_id);

  return jsonb_build_object('ok', true, 'rating', p_rating, 'low', p_rating <= 3,
    'show_google', show_google, 'google_url', case when show_google then _review_google_url() end);
end;
$$;

create or replace function log_review_google_click(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('mcloud.review_write', '1', true);
  update reviews set google_clicked_at = coalesce(google_clicked_at, now())
   where token = p_token and status = 'submitted' and google_prompted;
end;
$$;

revoke all on function get_review_by_token(text), submit_review_by_token(text, integer, jsonb, text, text, boolean), log_review_google_click(text) from public;
grant execute on function get_review_by_token(text), submit_review_by_token(text, integer, jsonb, text, text, boolean), log_review_google_click(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Website feed (called only by the server route with the service role)
-- ═══════════════════════════════════════════════════════════════════════
create or replace function get_published_reviews(max_n integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not _is_trusted_context() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'count', (select count(*) from reviews where status = 'submitted'),
    'average', (select round(avg(rating)::numeric, 2) from reviews where status = 'submitted'),
    'reviews', coalesce((
      select jsonb_agg(x) from (
        select display_name as name, project_label as project, rating, comment, category_ratings as categories, submitted_at as date, featured
        from reviews
        where published and publish_consent and status = 'submitted' and comment is not null
        order by featured desc, submitted_at desc
        limit greatest(least(max_n, 50), 1)
      ) x
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function get_published_reviews(integer) from public, anon, authenticated;
grant execute on function get_published_reviews(integer) to service_role;
