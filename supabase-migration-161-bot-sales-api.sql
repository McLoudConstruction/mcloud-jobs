-- Run in Supabase SQL Editor after migration 160. Safe to re-run.
--
-- Bot API, sales side only.
--
-- Lets outside bots (n8n, scripts, other AI agents) read leads, read prospects,
-- add prospects and log outreach, and nothing else. No bot ever gets a login
-- session or the service role key.
--
-- How the boundary is enforced
--   * A bot holds a long random key (mcb_...). Only its SHA-256 hash is stored.
--   * The Next.js routes under /api/bot/sales call the functions below using the
--     public anon key. The anon role has no table access at all (every table is
--     admin only through RLS), it can only EXECUTE the bot_sales_* functions,
--     and each of those checks the key itself. So even a bug in a route cannot
--     reach jobs, financials, subcontractors, settings or any other table.
--   * The functions only ever touch: opportunities (read), properties and
--     contacts (read, plus insert of new prospects), outreach_touches (insert),
--     the suppression list and outreach enrollments (stop only, so a bounce or
--     unsubscribe seen by a bot also protects the platform's own sequences).
--   * Rate limit, audit log, idempotency and revoke are all in the database, so
--     they apply however a function is reached.
--
-- Terms used by the API
--   lead      a row in opportunities (website requests, site requests, manual leads)
--   prospect  a row in properties, with the people on it in contacts. This is the
--             same prospect database the Outreach sequences already use, so a
--             prospect a bot adds can be enrolled in a sequence by staff as usual.
--   touch     one outreach contact made outside the platform (a bot's own email,
--             a call, a text, a mailing). Stored in the new outreach_touches table.
--
-- Owner tools (Settings, Bots tab): create a key (shown once), list keys, revoke.
-- Every bot created prospect and person carries created_by_bot_id, so one bot's
-- work can always be found, reviewed or removed:
--   select * from properties where created_by_bot_id = '<key id>';

-- ─── 1. Tables ──────────────────────────────────────────────────────────
create table if not exists bot_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,          -- sha256 hex of the full key. The key itself is never stored.
  key_prefix text not null,               -- first 12 characters, only to recognise a key in the list
  scopes text[] not null default array['sales'],
  active boolean not null default true,
  rate_limit_per_min integer not null default 60 check (rate_limit_per_min between 1 and 600),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists bot_keys_name_live_idx on bot_keys (lower(name)) where revoked_at is null;

create table if not exists bot_audit_log (
  id bigint generated always as identity primary key,
  bot_key_id uuid references bot_keys(id) on delete cascade,
  bot_name text,
  action text not null,                   -- me, leads.list, prospects.list, prospects.create, outreach.log
  status text not null,                   -- ok or rejected
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists bot_audit_log_key_time_idx on bot_audit_log (bot_key_id, created_at desc);
create index if not exists bot_audit_log_time_idx on bot_audit_log (created_at desc);

-- A retried POST with the same Idempotency-Key gets the first answer back
-- instead of doing the work twice.
create table if not exists bot_idempotency (
  bot_key_id uuid not null references bot_keys(id) on delete cascade,
  idem_key text not null,
  action text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (bot_key_id, idem_key)
);

-- Outreach made outside the platform, logged by bots (and usable by staff later).
create table if not exists outreach_touches (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  to_email text,
  channel text not null,
  direction text not null default 'outbound',
  outcome text not null,
  note text,
  sent_at timestamptz not null default now(),
  bot_key_id uuid references bot_keys(id) on delete set null,
  bot_name text,                          -- kept so history still reads right after a key is deleted
  created_at timestamptz not null default now()
);
create index if not exists outreach_touches_property_idx on outreach_touches (property_id, sent_at desc);
create index if not exists outreach_touches_email_idx on outreach_touches (lower(to_email)) where to_email is not null;
create index if not exists outreach_touches_bot_idx on outreach_touches (bot_key_id, created_at desc) where bot_key_id is not null;

-- Who created a record, so a bot's work is always traceable.
alter table properties add column if not exists created_by_bot_id uuid references bot_keys(id) on delete set null;
alter table contacts add column if not exists created_by_bot_id uuid references bot_keys(id) on delete set null;
create index if not exists properties_bot_idx on properties (created_by_bot_id) where created_by_bot_id is not null;
create index if not exists contacts_bot_idx on contacts (created_by_bot_id) where created_by_bot_id is not null;

-- ─── 2. Row level security ──────────────────────────────────────────────
-- bot_keys, bot_audit_log and bot_idempotency have no policies on purpose:
-- nothing but the security definer functions below can read or write them.
alter table bot_keys enable row level security;
alter table bot_audit_log enable row level security;
alter table bot_idempotency enable row level security;
alter table outreach_touches enable row level security;

drop policy if exists "Admin can do everything on outreach_touches" on outreach_touches;
create policy "Admin can do everything on outreach_touches"
  on outreach_touches for all using (is_admin()) with check (is_admin());

-- ─── 3. Internal helpers (not callable from the API) ────────────────────
create or replace function _bot_caller_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _is_trusted_context()
      or exists (select 1 from staff_users s where s.id = auth.uid() and s.role = 'owner' and s.status = 'active');
$$;

-- Everything a bot is allowed to send or filter on, in one place. The API tells
-- bots to read this from GET /api/bot/sales, so they never have to guess.
-- known_verticals mirrors lib/verticals.js. A vertical outside the list is still
-- accepted if it is a lowercase slug, matching how the app already treats it.
create or replace function _bot_enums()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'channels', jsonb_build_array('email', 'call', 'text', 'mail', 'other'),
    'directions', jsonb_build_array('outbound', 'inbound'),
    'outcomes', jsonb_build_array('sent', 'replied', 'bounced', 'interested', 'not_interested', 'unsubscribed', 'no_answer', 'voicemail', 'meeting_set', 'wrong_contact'),
    'lead_stages', jsonb_build_array('prospecting', 'contacted', 'site_request', 'proposal', 'won', 'lost', 'converted'),
    'prospect_stages', jsonb_build_array('prospecting', 'contacted', 'proposal', 'won', 'lost'),
    'tiers', jsonb_build_array('A', 'B', 'C'),
    'known_verticals', jsonb_build_array('multi_family', 'hotel_lodging', 'office', 'retail', 'recreational', 'church', 'residential')
  );
$$;

create or replace function _bot_err(p_status integer, p_code text, p_msg text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('ok', false, 'status', p_status, 'code', p_code, 'error', p_msg) || coalesce(p_extra, '{}'::jsonb);
$$;

-- Checks the key, its scope, expiry and rate limit. Returns the key row, or an
-- error object to hand straight back. Nothing is written for a bad key, so
-- guessing keys cannot fill the audit log.
create or replace function _bot_gate(p_key text, p_scope text, out bot bot_keys, out err jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  h text;
  used integer;
begin
  err := null;
  if p_key is null or length(p_key) < 20 or length(p_key) > 200 or left(p_key, 4) <> 'mcb_' then
    bot := null;
    err := _bot_err(401, 'unauthorized', 'Missing or malformed bot key. Send it as: Authorization: Bearer mcb_...');
    return;
  end if;
  h := encode(sha256(convert_to(p_key, 'utf8')), 'hex');
  select * into bot from bot_keys where key_hash = h;
  if not found or not bot.active or bot.revoked_at is not null then
    bot := null;
    err := _bot_err(401, 'unauthorized', 'Invalid or revoked bot key.');
    return;
  end if;
  if bot.expires_at is not null and bot.expires_at <= now() then
    bot := null;
    err := _bot_err(401, 'key_expired', 'This bot key has expired. Ask the owner for a new one.');
    return;
  end if;
  if not (p_scope = any(bot.scopes)) then
    bot := null;
    err := _bot_err(403, 'forbidden', format('This key does not have the %s scope.', p_scope));
    return;
  end if;
  select count(*) into used from bot_audit_log a where a.bot_key_id = bot.id and a.created_at > now() - interval '1 minute';
  if used >= bot.rate_limit_per_min then
    err := _bot_err(429, 'rate_limited', format('Rate limit reached (%s requests per minute). Wait a minute, then retry.', bot.rate_limit_per_min), jsonb_build_object('retry_after_seconds', 30));
    bot := null;
    return;
  end if;
  if bot.last_used_at is null or bot.last_used_at < now() - interval '1 minute' then
    update bot_keys set last_used_at = now() where id = bot.id;
  end if;
end;
$$;

create or replace function _bot_log(p_bot bot_keys, p_action text, p_status text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into bot_audit_log (bot_key_id, bot_name, action, status, detail)
  values (p_bot.id, p_bot.name, p_action, p_status, coalesce(p_detail, '{}'::jsonb));
  -- Light housekeeping, about once per hundred calls.
  if random() < 0.01 then
    delete from bot_audit_log where created_at < now() - interval '90 days';
    delete from bot_idempotency where created_at < now() - interval '7 days';
  end if;
end;
$$;

-- Logs a rejected request (so it still counts toward the rate limit) and returns the error.
create or replace function _bot_reject(p_bot bot_keys, p_action text, p_status integer, p_code text, p_msg text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _bot_log(p_bot, p_action, 'rejected', jsonb_build_object('code', p_code, 'error', p_msg));
  return _bot_err(p_status, p_code, p_msg, p_extra);
end;
$$;

create or replace function _bot_unknown_keys(p jsonb, allowed text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(k order by k), '{}'::text[]) from jsonb_object_keys(p) as k where k <> all(allowed);
$$;

create or replace function _bot_bool(p text)
returns boolean
language sql
immutable
as $$
  select case lower(btrim(coalesce(p, ''))) when 'true' then true when '1' then true when 'false' then false when '0' then false else null end;
$$;

-- Letters and digits only, lowercase. Used to compare names and cities.
create or replace function _bot_norm(p text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

-- Same, after folding the usual street words, so "123 Main Street" matches "123 Main St".
create or replace function _bot_norm_street(p text)
returns text
language sql
immutable
as $$
  select _bot_norm(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(coalesce(p, '')), '\m(street)\M', 'st', 'g'),
          '\m(avenue)\M', 'ave', 'g'),
        '\m(road)\M', 'rd', 'g'),
      '\m(drive)\M', 'dr', 'g'),
    '\m(boulevard)\M', 'blvd', 'g')
  );
$$;

create or replace function _bot_digits(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
$$;

-- Input readers. A bad value raises BK422, which the calling function turns
-- into a 422 response. They run before anything is written.
create or replace function _bot_text(b jsonb, k text, maxlen integer, required boolean default false)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  if b ? k and jsonb_typeof(b -> k) not in ('string', 'number', 'null') then
    raise exception '% must be text.', k using errcode = 'BK422';
  end if;
  v := nullif(btrim(b ->> k), '');
  if v is null and required then
    raise exception '% is required.', k using errcode = 'BK422';
  end if;
  if v is not null and length(v) > maxlen then
    raise exception '% is too long (max % characters).', k, maxlen using errcode = 'BK422';
  end if;
  return v;
end;
$$;

create or replace function _bot_email(b jsonb, k text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(_bot_text(b, k, 254));
begin
  if v is not null and v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception '% is not a valid email address.', k using errcode = 'BK422';
  end if;
  return v;
end;
$$;

create or replace function _bot_phone(b jsonb, k text)
returns text
language plpgsql
immutable
as $$
declare
  v text := _bot_text(b, k, 40);
begin
  if v is not null and length(_bot_digits(v)) < 7 then
    raise exception '% needs at least 7 digits.', k using errcode = 'BK422';
  end if;
  return v;
end;
$$;

-- ─── 4. Owner tools (called from Settings, Bots tab) ────────────────────
create or replace function bot_key_create(p_name text, p_rate_limit integer default 60, p_expires_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  secret text;
  new_id uuid;
begin
  if not _bot_caller_is_owner() then raise exception 'Only an owner can manage bot keys.'; end if;
  if nm !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,39}$' then
    raise exception 'Give the bot a name of 2 to 40 characters: letters, numbers, spaces, hyphens or underscores.';
  end if;
  if p_rate_limit is null or p_rate_limit < 1 or p_rate_limit > 600 then
    raise exception 'Rate limit must be between 1 and 600 requests per minute.';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'The expiry date must be in the future.'; end if;
  if exists (select 1 from bot_keys k where lower(k.name) = lower(nm) and k.revoked_at is null) then
    raise exception 'A live bot key named "%" already exists. Revoke it first or pick another name.', nm;
  end if;

  -- Two random UUIDs, hex only: 244 bits from the database's secure generator.
  secret := 'mcb_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into bot_keys (name, key_hash, key_prefix, rate_limit_per_min, expires_at, created_by)
  values (nm, encode(sha256(convert_to(secret, 'utf8')), 'hex'), left(secret, 12), p_rate_limit, p_expires_at, auth.uid())
  returning id into new_id;

  return jsonb_build_object('id', new_id, 'name', nm, 'key', secret, 'prefix', left(secret, 12));
end;
$$;

create or replace function bot_key_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not _bot_caller_is_owner() then raise exception 'Only an owner can manage bot keys.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k.id,
      'name', k.name,
      'prefix', k.key_prefix,
      'scopes', k.scopes,
      'live', (k.active and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())),
      'revoked_at', k.revoked_at,
      'expires_at', k.expires_at,
      'rate_limit_per_min', k.rate_limit_per_min,
      'last_used_at', k.last_used_at,
      'created_at', k.created_at,
      'calls_24h', (select count(*) from bot_audit_log a where a.bot_key_id = k.id and a.created_at > now() - interval '24 hours'),
      'prospects_created', (select count(*) from properties p where p.created_by_bot_id = k.id),
      'touches_logged', (select count(*) from outreach_touches t where t.bot_key_id = k.id)
    ) order by k.created_at desc)
    from bot_keys k
  ), '[]'::jsonb);
end;
$$;

create or replace function bot_key_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _bot_caller_is_owner() then raise exception 'Only an owner can manage bot keys.'; end if;
  update bot_keys set active = false, revoked_at = coalesce(revoked_at, now()) where id = p_id;
  if not found then raise exception 'Bot key not found.'; end if;
end;
$$;

create or replace function bot_activity(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not _bot_caller_is_owner() then raise exception 'Only an owner can manage bot keys.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'bot_name', r.bot_name, 'action', r.action, 'status', r.status, 'detail', r.detail, 'created_at', r.created_at
    ) order by r.created_at desc, r.id desc)
    from (select * from bot_audit_log order by created_at desc, id desc limit greatest(least(coalesce(p_limit, 50), 200), 1)) r
  ), '[]'::jsonb);
end;
$$;

-- ─── 5. Bot functions (called by the routes with the anon key) ──────────

-- GET /api/bot/sales: who am I, what are my limits, what values are allowed.
create or replace function bot_sales_me(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  used integer;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;
  select count(*) into used from bot_audit_log a where a.bot_key_id = k.id and a.created_at > now() - interval '1 minute';
  perform _bot_log(k, 'me', 'ok');
  return jsonb_build_object(
    'ok', true,
    'bot', jsonb_build_object('name', k.name, 'scopes', k.scopes, 'expires_at', k.expires_at),
    'limits', jsonb_build_object('requests_per_minute', k.rate_limit_per_min, 'used_in_last_minute', used, 'max_page_size', 200, 'default_page_size', 50),
    'allowed_values', _bot_enums()
  );
end;
$$;

-- GET /api/bot/sales/leads
create or replace function bot_sales_leads_list(p_key text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  unknown text[];
  v_limit integer := 50;
  v_stage text;
  v_source text;
  v_vertical text;
  v_ptype text;
  v_q text;
  v_created timestamptz;
  v_updated timestamptz;
  v_cursor text;
  v_dec text;
  v_cur_ts timestamptz;
  v_cur_id uuid;
  v_items jsonb;
  v_more boolean;
  v_next text;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if jsonb_typeof(f) <> 'object' then
    return _bot_reject(k, 'leads.list', 422, 'invalid_filters', 'Filters must be a JSON object.');
  end if;
  unknown := _bot_unknown_keys(f, array['stage', 'source', 'vertical', 'project_type', 'q', 'created_since', 'updated_since', 'limit', 'cursor']);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'leads.list', 422, 'unknown_filter',
      format('Unknown filter: %s.', array_to_string(unknown, ', ')),
      jsonb_build_object('allowed', jsonb_build_array('stage', 'source', 'vertical', 'project_type', 'q', 'created_since', 'updated_since', 'limit', 'cursor')));
  end if;

  begin
    if f ? 'limit' then
      v_limit := (f ->> 'limit')::integer;
      if v_limit < 1 or v_limit > 200 then
        return _bot_reject(k, 'leads.list', 422, 'invalid_filter', 'limit must be between 1 and 200.');
      end if;
    end if;
  exception when invalid_text_representation then
    return _bot_reject(k, 'leads.list', 422, 'invalid_filter', 'limit must be a whole number between 1 and 200.');
  end;

  v_stage := nullif(lower(btrim(f ->> 'stage')), '');
  if v_stage is not null and not ((_bot_enums() -> 'lead_stages') ? v_stage) then
    return _bot_reject(k, 'leads.list', 422, 'invalid_filter', format('Unknown stage "%s".', v_stage), jsonb_build_object('allowed', _bot_enums() -> 'lead_stages'));
  end if;
  v_ptype := nullif(lower(btrim(f ->> 'project_type')), '');
  if v_ptype is not null and v_ptype not in ('residential', 'commercial') then
    return _bot_reject(k, 'leads.list', 422, 'invalid_filter', 'project_type must be residential or commercial.');
  end if;
  v_source := nullif(lower(btrim(f ->> 'source')), '');
  v_vertical := nullif(lower(btrim(f ->> 'vertical')), '');
  v_q := nullif(lower(btrim(f ->> 'q')), '');
  if length(coalesce(v_q, '')) > 100 then
    return _bot_reject(k, 'leads.list', 422, 'invalid_filter', 'q is too long (max 100 characters).');
  end if;

  begin
    v_created := (f ->> 'created_since')::timestamptz;
    v_updated := (f ->> 'updated_since')::timestamptz;
  exception when others then
    return _bot_reject(k, 'leads.list', 422, 'invalid_filter', 'created_since and updated_since must be ISO 8601 dates, like 2026-10-01 or 2026-10-01T12:00:00Z.');
  end;

  v_cursor := nullif(btrim(f ->> 'cursor'), '');
  if v_cursor is not null then
    begin
      v_dec := convert_from(decode(v_cursor, 'hex'), 'utf8');
      v_cur_ts := split_part(v_dec, '|', 1)::timestamptz;
      v_cur_id := split_part(v_dec, '|', 2)::uuid;
    exception when others then
      return _bot_reject(k, 'leads.list', 422, 'invalid_filter', 'cursor is not valid. Use the next_cursor value from the previous page.');
    end;
  end if;

  with page as (
    select o.*, row_number() over (order by o.updated_at, o.id) as rn
    from opportunities o
    where (v_stage is null or o.stage = v_stage)
      and (v_source is null or lower(o.source) = v_source)
      and (v_vertical is null or lower(o.lead_vertical) = v_vertical)
      and (v_ptype is null or o.project_type = v_ptype)
      and (v_created is null or o.created_at >= v_created)
      and (v_updated is null or o.updated_at >= v_updated)
      and (v_q is null or position(v_q in lower(concat_ws(' ', o.company, o.project, o.contact_name, o.contact_email, o.site_address))) > 0)
      and (v_cur_ts is null or (o.updated_at, o.id) > (v_cur_ts, v_cur_id))
    order by o.updated_at, o.id
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', pg.id,
      'stage', pg.stage,
      'company', pg.company,
      'project', pg.project,
      'project_type', pg.project_type,
      'anticipated_timeline', pg.anticipated_timeline,
      'contact_name', pg.contact_name,
      'contact_email', pg.contact_email,
      'contact_phone', pg.contact_phone,
      'can_email', (pg.contact_email is not null and btrim(pg.contact_email) <> '' and _outreach_blocked_reason(pg.contact_email, pg.property_id) is null),
      'source', pg.source,
      'vertical', pg.lead_vertical,
      'utm_source', pg.utm_source,
      'utm_medium', pg.utm_medium,
      'utm_campaign', pg.utm_campaign,
      'landing_path', pg.landing_path,
      'referrer', pg.referrer,
      'referral_name', pg.referral_name,
      'site_address', pg.site_address,
      'prospect_id', pg.property_id,
      'loss_reason', pg.loss_reason,
      'notes', pg.notes,
      'date_taken', pg.date_taken,
      'created_at', pg.created_at,
      'updated_at', pg.updated_at
    ) order by pg.rn) filter (where pg.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit,
    (array_agg(encode(convert_to(pg.updated_at::text || '|' || pg.id::text, 'utf8'), 'hex') order by pg.rn) filter (where pg.rn = v_limit))[1]
  into v_items, v_more, v_next
  from page pg;

  perform _bot_log(k, 'leads.list', 'ok', jsonb_build_object('returned', jsonb_array_length(v_items)));
  return jsonb_build_object('ok', true, 'items', v_items, 'count', jsonb_array_length(v_items), 'next_cursor', case when v_more then v_next else null end);
end;
$$;

-- GET /api/bot/sales/prospects
create or replace function bot_sales_prospects_list(p_key text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  allowed text[] := array['stage', 'vertical', 'tier', 'city', 'state', 'type', 'q', 'email', 'can_email', 'contacted', 'created_since', 'limit', 'cursor'];
  unknown text[];
  v_limit integer := 50;
  v_stage text;
  v_vertical text;
  v_tier text;
  v_city text;
  v_state text;
  v_type text;
  v_q text;
  v_email text;
  v_can boolean;
  v_contacted boolean;
  v_created timestamptz;
  v_cursor text;
  v_dec text;
  v_cur_ts timestamptz;
  v_cur_id uuid;
  v_items jsonb;
  v_more boolean;
  v_next text;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if jsonb_typeof(f) <> 'object' then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filters', 'Filters must be a JSON object.');
  end if;
  unknown := _bot_unknown_keys(f, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'prospects.list', 422, 'unknown_filter', format('Unknown filter: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  begin
    if f ? 'limit' then
      v_limit := (f ->> 'limit')::integer;
      if v_limit < 1 or v_limit > 200 then
        return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'limit must be between 1 and 200.');
      end if;
    end if;
  exception when invalid_text_representation then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'limit must be a whole number between 1 and 200.');
  end;

  v_stage := nullif(lower(btrim(f ->> 'stage')), '');
  if v_stage is not null and not ((_bot_enums() -> 'prospect_stages') ? v_stage) then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', format('Unknown stage "%s".', v_stage), jsonb_build_object('allowed', _bot_enums() -> 'prospect_stages'));
  end if;
  v_tier := nullif(upper(btrim(f ->> 'tier')), '');
  if v_tier is not null and not ((_bot_enums() -> 'tiers') ? v_tier) then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', format('Unknown tier "%s".', v_tier), jsonb_build_object('allowed', _bot_enums() -> 'tiers'));
  end if;
  v_vertical := nullif(lower(btrim(f ->> 'vertical')), '');
  v_city := nullif(_bot_norm(f ->> 'city'), '');
  v_state := nullif(_bot_norm(f ->> 'state'), '');
  v_type := nullif(lower(btrim(f ->> 'type')), '');
  v_q := nullif(lower(btrim(f ->> 'q')), '');
  v_email := nullif(lower(btrim(f ->> 'email')), '');
  if length(coalesce(v_q, '')) > 100 or length(coalesce(v_email, '')) > 254 then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'q or email is too long.');
  end if;

  if f ? 'can_email' then
    v_can := _bot_bool(f ->> 'can_email');
    if v_can is null then return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'can_email must be true or false.'); end if;
  end if;
  if f ? 'contacted' then
    v_contacted := _bot_bool(f ->> 'contacted');
    if v_contacted is null then return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'contacted must be true or false.'); end if;
  end if;

  begin
    v_created := (f ->> 'created_since')::timestamptz;
  exception when others then
    return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'created_since must be an ISO 8601 date, like 2026-10-01 or 2026-10-01T12:00:00Z.');
  end;

  v_cursor := nullif(btrim(f ->> 'cursor'), '');
  if v_cursor is not null then
    begin
      v_dec := convert_from(decode(v_cursor, 'hex'), 'utf8');
      v_cur_ts := split_part(v_dec, '|', 1)::timestamptz;
      v_cur_id := split_part(v_dec, '|', 2)::uuid;
    exception when others then
      return _bot_reject(k, 'prospects.list', 422, 'invalid_filter', 'cursor is not valid. Use the next_cursor value from the previous page.');
    end;
  end if;

  with base as (
    select p.*,
      (not p.do_not_contact and (
        (p.contact_email is not null and btrim(p.contact_email) <> '' and _outreach_blocked_reason(p.contact_email, p.id) is null)
        or exists (
          select 1 from contacts c
          where c.property_id = p.id and c.contact_email is not null and btrim(c.contact_email) <> ''
            and _outreach_blocked_reason(c.contact_email, p.id) is null
        )
      )) as emailable
    from properties p
    where (v_stage is null or p.prospect_stage = v_stage)
      and (v_vertical is null or lower(p.prospect_vertical) = v_vertical)
      and (v_tier is null or p.prospect_tier = v_tier)
      and (v_city is null or _bot_norm(p.property_city) = v_city)
      and (v_state is null or _bot_norm(p.property_state) = v_state)
      and (v_type is null or lower(p.property_type) = v_type)
      and (v_created is null or p.created_at >= v_created)
      and (v_contacted is null or (p.last_contacted_at is not null) = v_contacted)
      and (v_q is null or position(v_q in lower(concat_ws(' ', p.property_name, p.property_city, p.contact_name, p.contact_email, p.management_company))) > 0)
      and (v_email is null
           or lower(btrim(p.contact_email)) = v_email
           or exists (select 1 from contacts c where c.property_id = p.id and lower(btrim(c.contact_email)) = v_email))
      and (v_cur_ts is null or (p.created_at, p.id) > (v_cur_ts, v_cur_id))
  ), page as (
    select b.*, row_number() over (order by b.created_at, b.id) as rn
    from base b
    where (v_can is null or b.emailable = v_can)
    order by b.created_at, b.id
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', pg.id,
      'name', pg.property_name,
      'type', pg.property_type,
      'vertical', pg.prospect_vertical,
      'tier', pg.prospect_tier,
      'stage', pg.prospect_stage,
      'source', pg.prospect_source,
      'street', pg.property_street,
      'unit', pg.property_unit,
      'city', pg.property_city,
      'state', pg.property_state,
      'zip', pg.property_zip,
      'management_company', pg.management_company,
      'year_built', pg.year_built,
      'sq_ft', pg.sq_ft,
      'notes', pg.notes,
      'do_not_contact', pg.do_not_contact,
      'can_email', pg.emailable,
      'last_contacted_at', pg.last_contacted_at,
      'last_visited_at', pg.last_visited_at,
      'next_action_at', pg.next_action_at,
      'next_action_note', pg.next_action_note,
      'contact', jsonb_build_object(
        'name', pg.contact_name,
        'email', pg.contact_email,
        'phone', pg.contact_phone,
        'can_email', (not pg.do_not_contact and pg.contact_email is not null and btrim(pg.contact_email) <> '' and _outreach_blocked_reason(pg.contact_email, pg.id) is null)
      ),
      'people', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'first_name', c.first_name, 'last_name', c.last_name,
          'email', c.contact_email, 'phone', c.contact_phone, 'position', c.position, 'role', c.role,
          'can_email', (not pg.do_not_contact and c.contact_email is not null and btrim(c.contact_email) <> '' and _outreach_blocked_reason(c.contact_email, pg.id) is null)
        ) order by c.name)
        from contacts c where c.property_id = pg.id
      ), '[]'::jsonb),
      'touches', (
        select jsonb_build_object('count', count(*), 'last_at', max(t.sent_at), 'last_outcome', (array_agg(t.outcome order by t.sent_at desc))[1])
        from outreach_touches t where t.property_id = pg.id
      ),
      'created_at', pg.created_at
    ) order by pg.rn) filter (where pg.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit,
    (array_agg(encode(convert_to(pg.created_at::text || '|' || pg.id::text, 'utf8'), 'hex') order by pg.rn) filter (where pg.rn = v_limit))[1]
  into v_items, v_more, v_next
  from page pg;

  perform _bot_log(k, 'prospects.list', 'ok', jsonb_build_object('returned', jsonb_array_length(v_items)));
  return jsonb_build_object('ok', true, 'items', v_items, 'count', jsonb_array_length(v_items), 'next_cursor', case when v_more then v_next else null end);
end;
$$;

-- POST /api/bot/sales/prospects
-- Creates a prospect (a property with its contact), or returns the existing one.
create or replace function bot_sales_prospect_create(p_key text, p_body jsonb, p_idem text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  b jsonb := p_body;
  allowed text[] := array['name', 'type', 'vertical', 'tier', 'street', 'unit', 'city', 'state', 'zip', 'management_company',
                          'year_built', 'sq_ft', 'notes', 'contact_name', 'contact_email', 'contact_phone', 'contact_position'];
  unknown text[];
  v_idem text := nullif(btrim(p_idem), '');
  v_hash text;
  v_prior record;
  v_msg text;

  v_name text; v_type text; v_vertical text; v_tier text;
  v_street text; v_unit text; v_city text; v_state text; v_zip text; v_mgmt text;
  v_year text; v_sqft text; v_notes text;
  v_cname text; v_cemail text; v_cphone text; v_cposition text;

  n_name text; n_street text; n_city text;
  v_id uuid;
  v_status text := 'created';
  v_matched text;
  v_contact_added boolean := false;
  v_contact_id uuid;
  v_first text; v_last text;
  v_similar jsonb;
  v_resp jsonb;
  v_can boolean;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if b is null or jsonb_typeof(b) <> 'object' then
    return _bot_reject(k, 'prospects.create', 422, 'invalid_body', 'Send a JSON object. Required field: name.');
  end if;
  unknown := _bot_unknown_keys(b, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'prospects.create', 422, 'unknown_field', format('Unknown field: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  -- Same Idempotency-Key as an earlier call: give the first answer back.
  if v_idem is not null then
    if v_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
      return _bot_reject(k, 'prospects.create', 422, 'invalid_idempotency_key', 'Idempotency-Key must be 8 to 128 characters: letters, numbers, and _ . : -');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('bot_idem:' || k.id::text || ':' || v_idem, 0));
    v_hash := md5(b::text);
    select * into v_prior from bot_idempotency i where i.bot_key_id = k.id and i.idem_key = v_idem;
    if found then
      if v_prior.action <> 'prospects.create' or v_prior.request_hash <> v_hash then
        return _bot_reject(k, 'prospects.create', 422, 'idempotency_conflict', 'That Idempotency-Key was already used for a different request.');
      end if;
      perform _bot_log(k, 'prospects.create', 'ok', jsonb_build_object('replay', true));
      return v_prior.response || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  begin
    v_name := _bot_text(b, 'name', 200, true);
    v_type := _bot_text(b, 'type', 100);
    v_vertical := lower(_bot_text(b, 'vertical', 40));
    if v_vertical is not null and v_vertical !~ '^[a-z0-9_]{2,40}$' then
      raise exception 'vertical must be a lowercase key like church or multi_family.' using errcode = 'BK422';
    end if;
    v_tier := upper(_bot_text(b, 'tier', 1));
    if v_tier is not null and not ((_bot_enums() -> 'tiers') ? v_tier) then
      raise exception 'tier must be A, B or C.' using errcode = 'BK422';
    end if;
    v_street := _bot_text(b, 'street', 200);
    v_unit := _bot_text(b, 'unit', 50);
    v_city := _bot_text(b, 'city', 100);
    v_state := _bot_text(b, 'state', 30);
    v_zip := _bot_text(b, 'zip', 12);
    v_mgmt := _bot_text(b, 'management_company', 200);
    v_year := _bot_text(b, 'year_built', 20);
    v_sqft := _bot_text(b, 'sq_ft', 20);
    v_notes := _bot_text(b, 'notes', 2000);
    v_cname := _bot_text(b, 'contact_name', 200);
    v_cemail := _bot_email(b, 'contact_email');
    v_cphone := _bot_phone(b, 'contact_phone');
    v_cposition := _bot_text(b, 'contact_position', 100);
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'prospects.create', 422, 'invalid_field', v_msg);
  end;

  n_name := _bot_norm(v_name);
  n_street := _bot_norm_street(v_street);
  n_city := _bot_norm(v_city);
  if n_name = '' then
    return _bot_reject(k, 'prospects.create', 422, 'invalid_field', 'name must contain letters or numbers.');
  end if;

  -- Two calls for the same place at the same time must not both insert.
  perform pg_advisory_xact_lock(hashtextextended('bot_prospect:' || n_name || ':' || coalesce(nullif(n_street, ''), n_city), 0));

  -- Hard duplicate: same name AND (same street, or no street on one side and the same city).
  select p.id into v_id
  from properties p
  where _bot_norm(p.property_name) = n_name
    and (
      (n_street <> '' and _bot_norm_street(p.property_street) <> '' and _bot_norm_street(p.property_street) = n_street)
      or ((n_street = '' or _bot_norm_street(p.property_street) = '') and n_city <> '' and _bot_norm(p.property_city) = n_city)
    )
  order by p.created_at
  limit 1;

  if v_id is not null then
    v_status := 'duplicate';
    v_matched := 'name_and_address';
    -- A new person at a prospect we already have is worth keeping.
    if v_cemail is not null
       and not exists (select 1 from properties p where p.id = v_id and lower(btrim(p.contact_email)) = v_cemail)
       and not exists (select 1 from contacts c where c.property_id = v_id and lower(btrim(c.contact_email)) = v_cemail) then
      v_first := split_part(coalesce(v_cname, v_cemail), ' ', 1);
      v_last := nullif(btrim(substr(coalesce(v_cname, ''), length(split_part(coalesce(v_cname, ''), ' ', 1)) + 1)), '');
      insert into contacts (name, first_name, last_name, contact_phone, contact_email, property_id, property, management_company, position, role, created_by_bot_id)
      select coalesce(v_cname, v_cemail), v_first, v_last, v_cphone, v_cemail, p.id, p.property_name, coalesce(v_mgmt, p.management_company), v_cposition, 'Property Contact', k.id
      from properties p where p.id = v_id
      returning id into v_contact_id;
      v_contact_added := true;
    end if;
  else
    insert into properties (
      property_name, property_type, property_street, property_unit, property_city, property_state, property_zip,
      management_company, contact_name, contact_phone, contact_email, year_built, sq_ft, notes,
      prospect_stage, prospect_vertical, prospect_source, prospect_tier, created_by_bot_id
    ) values (
      v_name, v_type, v_street, v_unit, v_city, v_state, v_zip,
      v_mgmt, v_cname, v_cphone, v_cemail, v_year, v_sqft, v_notes,
      'prospecting', v_vertical, 'bot:' || k.name, v_tier, k.id
    ) returning id into v_id;

    if v_cname is not null or v_cemail is not null then
      v_first := split_part(coalesce(v_cname, v_cemail), ' ', 1);
      v_last := nullif(btrim(substr(coalesce(v_cname, ''), length(split_part(coalesce(v_cname, ''), ' ', 1)) + 1)), '');
      insert into contacts (name, first_name, last_name, contact_phone, contact_email, property_id, property, management_company, position, role, created_by_bot_id)
      values (coalesce(v_cname, v_cemail), v_first, v_last, v_cphone, v_cemail, v_id, v_name, v_mgmt, v_cposition, 'Property Contact', k.id)
      returning id into v_contact_id;
    end if;
  end if;

  -- Soft matches: other prospects that share this email or phone, or this exact name elsewhere.
  -- Informational only. Phone and email are often shared by one manager across several buildings.
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.property_name, 'matched_on', s.matched_on)), '[]'::jsonb)
  into v_similar
  from (
    select distinct on (p.id) p.id, p.property_name,
      case
        when v_cemail is not null and (lower(btrim(p.contact_email)) = v_cemail
             or exists (select 1 from contacts c where c.property_id = p.id and lower(btrim(c.contact_email)) = v_cemail)) then 'contact_email'
        when length(_bot_digits(v_cphone)) >= 10 and (right(_bot_digits(p.contact_phone), 10) = right(_bot_digits(v_cphone), 10)
             or exists (select 1 from contacts c where c.property_id = p.id and right(_bot_digits(c.contact_phone), 10) = right(_bot_digits(v_cphone), 10))) then 'contact_phone'
        else 'name'
      end as matched_on
    from properties p
    where p.id <> v_id
      and (
        (v_cemail is not null and (lower(btrim(p.contact_email)) = v_cemail
           or exists (select 1 from contacts c where c.property_id = p.id and lower(btrim(c.contact_email)) = v_cemail)))
        or (length(_bot_digits(v_cphone)) >= 10 and (right(_bot_digits(p.contact_phone), 10) = right(_bot_digits(v_cphone), 10)
           or exists (select 1 from contacts c where c.property_id = p.id and right(_bot_digits(c.contact_phone), 10) = right(_bot_digits(v_cphone), 10))))
        or _bot_norm(p.property_name) = n_name
      )
    order by p.id
    limit 5
  ) s;

  v_can := case
    when v_cemail is null then null
    else (not exists (select 1 from properties p where p.id = v_id and p.do_not_contact) and _outreach_blocked_reason(v_cemail, v_id) is null)
  end;

  v_resp := jsonb_build_object(
    'ok', true,
    'status', v_status,
    'id', v_id,
    'matched_on', v_matched,
    'contact_added', v_contact_added,
    'contact_id', v_contact_id,
    'can_email', v_can,
    'similar', v_similar
  );

  if v_idem is not null then
    insert into bot_idempotency (bot_key_id, idem_key, action, request_hash, response)
    values (k.id, v_idem, 'prospects.create', v_hash, v_resp)
    on conflict (bot_key_id, idem_key) do nothing;
  end if;

  perform _bot_log(k, 'prospects.create', 'ok', jsonb_build_object('prospect_id', v_id, 'status', v_status, 'contact_added', v_contact_added));
  return v_resp;
end;
$$;

-- POST /api/bot/sales/outreach
-- Logs one touch and applies the few side effects that keep the platform honest.
create or replace function bot_sales_outreach_log(p_key text, p_body jsonb, p_idem text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  k bot_keys;
  b jsonb := p_body;
  allowed text[] := array['prospect_id', 'email', 'channel', 'direction', 'outcome', 'note', 'sent_at'];
  unknown text[];
  v_idem text := nullif(btrim(p_idem), '');
  v_hash text;
  v_prior record;
  v_msg text;

  v_pid uuid;
  v_email text;
  v_channel text;
  v_direction text;
  v_outcome text;
  v_note text;
  v_sent_at timestamptz;
  v_matches uuid[];
  v_contact_id uuid;
  v_before text;
  v_old_note text;
  v_touch_id uuid;
  v_dup uuid;
  v_effects text[] := '{}';
  v_n integer;
  v_counts boolean;
  v_resp jsonb;
begin
  select * into g from _bot_gate(p_key, 'sales');
  if g.err is not null then return g.err; end if;
  k := g.bot;

  if b is null or jsonb_typeof(b) <> 'object' then
    return _bot_reject(k, 'outreach.log', 422, 'invalid_body', 'Send a JSON object with channel and outcome, plus prospect_id or email.');
  end if;
  unknown := _bot_unknown_keys(b, allowed);
  if cardinality(unknown) > 0 then
    return _bot_reject(k, 'outreach.log', 422, 'unknown_field', format('Unknown field: %s.', array_to_string(unknown, ', ')), jsonb_build_object('allowed', to_jsonb(allowed)));
  end if;

  if v_idem is not null then
    if v_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
      return _bot_reject(k, 'outreach.log', 422, 'invalid_idempotency_key', 'Idempotency-Key must be 8 to 128 characters: letters, numbers, and _ . : -');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('bot_idem:' || k.id::text || ':' || v_idem, 0));
    v_hash := md5(b::text);
    select * into v_prior from bot_idempotency i where i.bot_key_id = k.id and i.idem_key = v_idem;
    if found then
      if v_prior.action <> 'outreach.log' or v_prior.request_hash <> v_hash then
        return _bot_reject(k, 'outreach.log', 422, 'idempotency_conflict', 'That Idempotency-Key was already used for a different request.');
      end if;
      perform _bot_log(k, 'outreach.log', 'ok', jsonb_build_object('replay', true));
      return v_prior.response || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  begin
    v_email := _bot_email(b, 'email');
    v_channel := lower(_bot_text(b, 'channel', 20, true));
    v_outcome := lower(_bot_text(b, 'outcome', 30, true));
    v_direction := lower(_bot_text(b, 'direction', 20));
    v_note := _bot_text(b, 'note', 2000);
    if not ((_bot_enums() -> 'channels') ? v_channel) then
      raise exception 'Unknown channel "%". Allowed: %.', v_channel, (select string_agg(x, ', ') from jsonb_array_elements_text(_bot_enums() -> 'channels') x) using errcode = 'BK422';
    end if;
    if not ((_bot_enums() -> 'outcomes') ? v_outcome) then
      raise exception 'Unknown outcome "%". Allowed: %.', v_outcome, (select string_agg(x, ', ') from jsonb_array_elements_text(_bot_enums() -> 'outcomes') x) using errcode = 'BK422';
    end if;
    -- A reply comes from them. Everything else defaults to something we did.
    v_direction := coalesce(v_direction, case when v_outcome = 'replied' then 'inbound' else 'outbound' end);
    if not ((_bot_enums() -> 'directions') ? v_direction) then
      raise exception 'Unknown direction "%". Allowed: outbound, inbound.', v_direction using errcode = 'BK422';
    end if;

    if b ? 'prospect_id' and nullif(btrim(b ->> 'prospect_id'), '') is not null then
      begin
        v_pid := (b ->> 'prospect_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'prospect_id must be a UUID.' using errcode = 'BK422';
      end;
    end if;
    if v_pid is null and v_email is null then
      raise exception 'Send prospect_id, or the email address you contacted so the prospect can be found.' using errcode = 'BK422';
    end if;

    if b ? 'sent_at' and nullif(btrim(b ->> 'sent_at'), '') is not null then
      begin
        v_sent_at := (b ->> 'sent_at')::timestamptz;
      exception when others then
        raise exception 'sent_at must be an ISO 8601 timestamp, like 2026-10-23T14:30:00Z.' using errcode = 'BK422';
      end;
      if v_sent_at > now() + interval '5 minutes' then
        raise exception 'sent_at cannot be in the future.' using errcode = 'BK422';
      end if;
      if v_sent_at < now() - interval '400 days' then
        raise exception 'sent_at is more than 400 days ago.' using errcode = 'BK422';
      end if;
    end if;
  exception when sqlstate 'BK422' then
    get stacked diagnostics v_msg = message_text;
    return _bot_reject(k, 'outreach.log', 422, 'invalid_field', v_msg);
  end;
  v_sent_at := coalesce(v_sent_at, now());

  -- Find the prospect.
  if v_pid is not null then
    perform 1 from properties p where p.id = v_pid;
    if not found then
      return _bot_reject(k, 'outreach.log', 404, 'unknown_prospect', 'No prospect with that prospect_id.');
    end if;
  else
    select coalesce(array_agg(distinct m.pid), '{}'::uuid[]) into v_matches
    from (
      select p.id as pid from properties p where lower(btrim(p.contact_email)) = v_email
      union
      select c.property_id as pid from contacts c where lower(btrim(c.contact_email)) = v_email and c.property_id is not null
    ) m;
    if cardinality(v_matches) = 0 then
      return _bot_reject(k, 'outreach.log', 404, 'unknown_prospect', 'No prospect has that email address. Add it first with POST /api/bot/sales/prospects.');
    elsif cardinality(v_matches) > 1 then
      return _bot_reject(k, 'outreach.log', 409, 'ambiguous_prospect',
        'That email address belongs to more than one prospect. Send prospect_id to say which.',
        jsonb_build_object('prospect_ids', to_jsonb(v_matches[1:10])));
    end if;
    v_pid := v_matches[1];
  end if;

  -- The same touch sent twice (same bot, prospect, channel, direction, outcome and time) is one touch.
  select t.id into v_dup from outreach_touches t
  where t.property_id = v_pid and t.bot_key_id = k.id and t.channel = v_channel and t.direction = v_direction
    and t.outcome = v_outcome and t.sent_at = v_sent_at
  limit 1;
  if v_dup is not null then
    v_resp := jsonb_build_object('ok', true, 'status', 'duplicate', 'touch_id', v_dup, 'prospect_id', v_pid, 'effects', '[]'::jsonb);
    perform _bot_log(k, 'outreach.log', 'ok', jsonb_build_object('prospect_id', v_pid, 'status', 'duplicate'));
    return v_resp;
  end if;

  if v_email is not null then
    select c.id into v_contact_id from contacts c
    where c.property_id = v_pid and lower(btrim(c.contact_email)) = v_email
    limit 1;
  end if;

  insert into outreach_touches (property_id, contact_id, to_email, channel, direction, outcome, note, sent_at, bot_key_id, bot_name)
  values (v_pid, v_contact_id, v_email, v_channel, v_direction, v_outcome, v_note, v_sent_at, k.id, k.name)
  returning id into v_touch_id;

  -- Side effects, kept to what staff would otherwise have to do by hand.
  select p.prospect_stage, p.next_action_note into v_before, v_old_note from properties p where p.id = v_pid for update;

  v_counts := v_outcome in ('sent', 'voicemail', 'replied', 'interested', 'not_interested', 'unsubscribed', 'meeting_set');
  if v_counts then
    update properties
      set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'::timestamptz), v_sent_at),
          prospect_stage = case when prospect_stage = 'prospecting' then 'contacted' else prospect_stage end
      where id = v_pid;
    v_effects := v_effects || 'last_contacted_updated'::text;
    if v_before = 'prospecting' then v_effects := v_effects || 'stage_set_contacted'::text; end if;
  end if;

  if v_outcome in ('replied', 'interested', 'meeting_set') then
    if v_email is not null then
      v_n := _outreach_stop(v_email, 'replied', null);
      if v_n > 0 then v_effects := v_effects || format('sequences_stopped:%s', v_n); end if;
    end if;
    update properties
      set next_action_at = now(),
          next_action_note = left(
            format('Bot %s: %s. Follow up.', k.name, replace(v_outcome, '_', ' '))
            || case when coalesce(v_old_note, '') <> '' and v_old_note not like 'Bot %' then ' (previous: ' || v_old_note || ')' else '' end,
            300)
      where id = v_pid;
    v_effects := v_effects || 'follow_up_flagged'::text;
  elsif v_outcome = 'bounced' and v_email is not null then
    v_n := _outreach_stop(v_email, 'bounced', null);
    v_effects := v_effects || 'address_suppressed'::text;
    if v_n > 0 then v_effects := v_effects || format('sequences_stopped:%s', v_n); end if;
  elsif v_outcome = 'unsubscribed' and v_email is not null then
    v_n := _outreach_stop(v_email, 'unsubscribed', null);
    update contacts set automated_emails_opt_out = true where lower(btrim(contact_email)) = v_email and not automated_emails_opt_out;
    v_effects := v_effects || 'address_suppressed'::text || 'contact_opted_out'::text;
    if v_n > 0 then v_effects := v_effects || format('sequences_stopped:%s', v_n); end if;
  elsif v_outcome = 'not_interested' and v_email is not null then
    v_n := _outreach_stop(v_email, 'manual', null);
    if v_n > 0 then v_effects := v_effects || format('sequences_stopped:%s', v_n); end if;
  end if;

  v_resp := jsonb_build_object('ok', true, 'status', 'logged', 'touch_id', v_touch_id, 'prospect_id', v_pid, 'effects', to_jsonb(v_effects));

  if v_idem is not null then
    insert into bot_idempotency (bot_key_id, idem_key, action, request_hash, response)
    values (k.id, v_idem, 'outreach.log', v_hash, v_resp)
    on conflict (bot_key_id, idem_key) do nothing;
  end if;

  perform _bot_log(k, 'outreach.log', 'ok', jsonb_build_object('prospect_id', v_pid, 'touch_id', v_touch_id, 'outcome', v_outcome));
  return v_resp;
end;
$$;

-- ─── 6. Who can call what ───────────────────────────────────────────────
-- Internal helpers: nobody from the API.
revoke all on function _bot_caller_is_owner() from public, anon, authenticated;
revoke all on function _bot_enums() from public, anon, authenticated;
revoke all on function _bot_err(integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function _bot_gate(text, text) from public, anon, authenticated;
revoke all on function _bot_log(bot_keys, text, text, jsonb) from public, anon, authenticated;
revoke all on function _bot_reject(bot_keys, text, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function _bot_unknown_keys(jsonb, text[]) from public, anon, authenticated;
revoke all on function _bot_bool(text) from public, anon, authenticated;
revoke all on function _bot_norm(text) from public, anon, authenticated;
revoke all on function _bot_norm_street(text) from public, anon, authenticated;
revoke all on function _bot_digits(text) from public, anon, authenticated;
revoke all on function _bot_text(jsonb, text, integer, boolean) from public, anon, authenticated;
revoke all on function _bot_email(jsonb, text) from public, anon, authenticated;
revoke all on function _bot_phone(jsonb, text) from public, anon, authenticated;

-- Owner tools: signed in staff only (each one checks for an owner itself).
revoke all on function bot_key_create(text, integer, timestamptz) from public, anon;
revoke all on function bot_key_list() from public, anon;
revoke all on function bot_key_revoke(uuid) from public, anon;
revoke all on function bot_activity(integer) from public, anon;
grant execute on function bot_key_create(text, integer, timestamptz) to authenticated;
grant execute on function bot_key_list() to authenticated;
grant execute on function bot_key_revoke(uuid) to authenticated;
grant execute on function bot_activity(integer) to authenticated;

-- Bot functions: the routes call these with the anon key. The key is the credential.
revoke all on function bot_sales_me(text) from public;
revoke all on function bot_sales_leads_list(text, jsonb) from public;
revoke all on function bot_sales_prospects_list(text, jsonb) from public;
revoke all on function bot_sales_prospect_create(text, jsonb, text) from public;
revoke all on function bot_sales_outreach_log(text, jsonb, text) from public;
grant execute on function bot_sales_me(text) to anon, authenticated;
grant execute on function bot_sales_leads_list(text, jsonb) to anon, authenticated;
grant execute on function bot_sales_prospects_list(text, jsonb) to anon, authenticated;
grant execute on function bot_sales_prospect_create(text, jsonb, text) to anon, authenticated;
grant execute on function bot_sales_outreach_log(text, jsonb, text) to anon, authenticated;

-- Make the new columns and functions visible to the API right away.
notify pgrst, 'reload schema';
