-- Run in Supabase SQL Editor after migration 131. Safe to re-run.
--
-- E-SIGNATURE HARDENING
--
-- Before this migration, a signature was a base64 PNG dropped into a
-- jsonb column (jobs.contract_signatures, change_orders.co_signatures,
-- work_orders.sub_signature) straight from the browser. Nothing on the
-- server checked what was in it, who was logged in when it was written,
-- or stopped a signed change order from being cleared and re-signed. The
-- two owner-signature RPCs (save_contract_owner_signature and
-- save_change_order_owner_signature) also live only in the live database,
-- not in this repo, so their checks can't be reviewed here.
--
-- Rather than replace functions this repo can't see, the checks below are
-- TRIGGERS ON THE TABLES THEMSELVES. They fire no matter which path wrote
-- the signature (direct update, either RPC, a future RPC, the SQL editor),
-- so there is no route around them.
--
-- What they do:
--   1. Validate every new/changed signature: a real PNG (header, sane
--      dimensions, size cap), a printed name, a date within 2 days of the
--      server date (no backdating), and who is allowed to sign which role.
--   2. Enforce finality server-side: a customer cannot change or clear a
--      signature once a contract is submitted or a change order is signed.
--      Staff still can (real corrections happen) but it is logged as a
--      replace/void, never silent.
--   3. Write an append-only evidence row to signature_events for every
--      sign / replace / void: the authenticated user, whether staff
--      captured it on the signer's behalf, server timestamp, IP address and
--      user agent (read from the PostgREST request headers), a SHA-256 of
--      the signature image, and a SHA-256 + full snapshot of the document
--      record as it stood at the moment of signing.
--   4. Stamp server-side fields (signed_at, signed_by_email,
--      signature_event_id) back onto the stored signature, so the client's
--      own `date` is no longer the only timestamp.
--
-- Deliberately NOT enforced in the database: "the canvas was not blank".
-- A blank canvas PNG is 1.6-24 KB depending on device pixel ratio and a
-- single click is within ~5% of that, so no size threshold can tell them
-- apart. The pad measures real stroke length in the browser instead and
-- sends it along; the server rejects an implausibly short one when
-- present and records it, but tolerates its absence so a stale cached
-- copy of the app (this is a PWA) can never lock a customer out of signing.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Evidence table — append-only
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists signature_events (
  id uuid primary key default gen_random_uuid(),

  document_type text not null check (document_type in ('contract', 'change_order', 'work_order', 'lien_waiver', 'pay_app')),
  document_id uuid not null,
  -- Plain uuid, deliberately NOT a foreign key: evidence must outlive the
  -- job if a job is ever deleted.
  job_id uuid,

  signer_role text not null,
  event_type text not null default 'signed' check (event_type in ('signed', 'replaced', 'voided')),

  signer_name text,
  signer_title text,
  signer_user_id uuid,
  signer_email text,
  signer_is_staff boolean not null default false,
  -- True when a staff login captured a signature for a non-staff party
  -- (e.g. the owner signing on an office tablet). Worth knowing later.
  on_behalf_of_signer boolean not null default false,

  signed_at timestamptz not null default now(),
  ip_address text,
  user_agent text,

  signature_sha256 text,
  document_sha256 text,
  document_snapshot jsonb,

  consent_captured boolean not null default false,
  consent_text_version text,
  client_stroke_length numeric,
  payload_date text,
  note text
);

create index if not exists signature_events_document_idx on signature_events (document_type, document_id);
create index if not exists signature_events_job_idx on signature_events (job_id);

alter table signature_events enable row level security;

drop policy if exists "Admin can read signature_events" on signature_events;
create policy "Admin can read signature_events" on signature_events for select using (is_admin());
-- No insert/update/delete policies: rows are written only by the
-- security-definer functions below, and the trigger below blocks
-- UPDATE/DELETE even for those.

create or replace function signature_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'signature_events is append-only';
end;
$$;

drop trigger if exists trg_signature_events_no_update on signature_events;
create trigger trg_signature_events_no_update
  before update or delete on signature_events
  for each row execute function signature_events_append_only();

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Helpers
-- ═══════════════════════════════════════════════════════════════════════

-- Read one request header (PostgREST exposes them as a JSON GUC). Returns
-- null outside a PostgREST request (SQL editor, cron, etc.).
create or replace function _request_header(header_name text)
returns text
language plpgsql
stable
as $$
declare
  h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  return h ->> lower(header_name);
end;
$$;

-- "Trusted" = the SQL editor or the service-role key: no end-user request
-- at all. An anonymous PostgREST request also has a null auth.uid(), so
-- uid alone is NOT a safe test — the request's JWT claims are.
create or replace function _is_trusted_context()
returns boolean
language plpgsql
stable
as $$
begin
  return coalesce(auth.role(), '') = 'service_role'
    or (auth.uid() is null and coalesce(current_setting('request.jwt.claims', true), '') = '');
exception when others then
  return false;
end;
$$;

-- Width/height from a PNG's IHDR chunk, straight out of the base64 — no
-- decoding of the image body. Returns null if it isn't a PNG.
create or replace function _png_dimensions(b64 text)
returns int[]
language plpgsql
immutable
as $$
declare
  hdr bytea;
begin
  hdr := decode(substr(b64, 1, 48), 'base64');
  if length(hdr) < 24 then return null; end if;
  if encode(substring(hdr from 1 for 8), 'hex') <> '89504e470d0a1a0a' then return null; end if;
  return array[
    (get_byte(hdr, 16) << 24) + (get_byte(hdr, 17) << 16) + (get_byte(hdr, 18) << 8) + get_byte(hdr, 19),
    (get_byte(hdr, 20) << 24) + (get_byte(hdr, 21) << 16) + (get_byte(hdr, 22) << 8) + get_byte(hdr, 23)
  ];
exception when others then
  return null;
end;
$$;

create or replace function _validate_signature_payload(payload jsonb, label text)
returns void
language plpgsql
as $$
declare
  sig text;
  b64 text;
  dims int[];
  nm text;
  d date;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception '% signature is malformed', label;
  end if;

  sig := payload ->> 'signature';
  if sig is null or sig not like 'data:image/png;base64,%' then
    raise exception '% signature must be a PNG image', label;
  end if;
  b64 := substr(sig, length('data:image/png;base64,') + 1);
  if length(b64) > 1500000 then
    raise exception '% signature image is too large', label;
  end if;
  if b64 !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception '% signature image is not valid base64', label;
  end if;
  dims := _png_dimensions(b64);
  if dims is null or dims[1] not between 100 and 4000 or dims[2] not between 40 and 1500 then
    raise exception '% signature image is not a valid signature-sized PNG', label;
  end if;

  nm := btrim(coalesce(payload ->> 'name', ''));
  if nm = '' then
    raise exception 'A printed name is required with the % signature', label;
  end if;
  if length(nm) > 200 or length(coalesce(payload ->> 'title', '')) > 200 then
    raise exception '% signature name/title is too long', label;
  end if;

  begin
    d := (payload ->> 'date')::date;
  exception when others then
    raise exception '% signature has an invalid date', label;
  end;
  if d is null or abs(d - current_date) > 2 then
    raise exception '% signature date does not match today''s date', label;
  end if;

  if payload ? 'stroke_length' then
    begin
      if (payload ->> 'stroke_length')::numeric < 20 then
        raise exception '% signature is too short to be a real signature', label;
      end if;
    exception when invalid_text_representation then
      raise exception '% signature has invalid stroke data', label;
    end;
  end if;
end;
$$;

-- One entry point every signature trigger (and, later, the lien-waiver
-- and pay-app signing RPCs) calls. Validates the new payload, writes the
-- evidence row, and returns the payload with server-side stamps added —
-- or null when the signature was removed.
create or replace function _capture_signature(
  doc_type text,
  doc_id uuid,
  doc_job_id uuid,
  sig_role text,
  old_payload jsonb,
  new_payload jsonb,
  doc_snapshot jsonb,
  note_in text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_email text := auth.jwt() ->> 'email';
  actor_staff boolean := coalesce(is_admin(), false);
  had_old boolean := old_payload is not null and jsonb_typeof(old_payload) = 'object';
  is_removal boolean := new_payload is null or jsonb_typeof(new_payload) <> 'object';
  evt_id uuid := gen_random_uuid();
  ip text;
  snap_text text;
  src jsonb := case when is_removal then old_payload else new_payload end;
begin
  ip := nullif(btrim(split_part(coalesce(
    _request_header('x-forwarded-for'), _request_header('x-real-ip'), _request_header('cf-connecting-ip'), ''
  ), ',', 1)), '');

  if not is_removal then
    perform _validate_signature_payload(new_payload, initcap(replace(sig_role, '_', ' ')));
  end if;

  snap_text := coalesce(doc_snapshot, '{}'::jsonb)::text;

  insert into signature_events (
    id, document_type, document_id, job_id, signer_role, event_type,
    signer_name, signer_title, signer_user_id, signer_email, signer_is_staff, on_behalf_of_signer,
    ip_address, user_agent, signature_sha256, document_sha256, document_snapshot,
    consent_captured, consent_text_version, client_stroke_length, payload_date, note
  ) values (
    evt_id, doc_type, doc_id, doc_job_id, sig_role,
    case when is_removal then 'voided' when had_old then 'replaced' else 'signed' end,
    src ->> 'name', src ->> 'title', actor, coalesce(actor_email, case when actor is null then 'system' end), actor_staff,
    -- A staff login capturing a non-staff party's signature.
    actor_staff and sig_role in ('owner', 'sub', 'claimant') and not is_removal,
    ip, left(_request_header('user-agent'), 500),
    encode(sha256(convert_to(coalesce(src ->> 'signature', ''), 'utf8')), 'hex'),
    encode(sha256(convert_to(snap_text, 'utf8')), 'hex'),
    doc_snapshot,
    coalesce(src ->> 'consent', '') = 'true', src ->> 'consent_text_version',
    nullif(src ->> 'stroke_length', '')::numeric, src ->> 'date', note_in
  );

  if is_removal then
    return null;
  end if;

  return new_payload || jsonb_build_object(
    'signed_at', now(),
    'signed_by_email', actor_email,
    'signature_event_id', evt_id
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Contracts — jobs.contract_signatures
-- ═══════════════════════════════════════════════════════════════════════
create or replace function trg_jobs_signature_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  old_p jsonb;
  new_p jsonb;
  actor_staff boolean := coalesce(is_admin(), false) or _is_trusted_context();
  snap jsonb;
  captured jsonb;
  had_old boolean;
begin
  if NEW.contract_signatures is not distinct from OLD.contract_signatures then
    return NEW;
  end if;

  snap := to_jsonb(NEW) - 'contract_signatures';

  for k in
    select jsonb_object_keys(coalesce(OLD.contract_signatures, '{}'::jsonb))
    union
    select jsonb_object_keys(coalesce(NEW.contract_signatures, '{}'::jsonb))
  loop
    old_p := OLD.contract_signatures -> k;
    new_p := NEW.contract_signatures -> k;
    if new_p is not distinct from old_p then continue; end if;

    if k not in ('contractor', 'owner') then
      raise exception 'Unknown contract signature role: %', k;
    end if;
    if k = 'contractor' and not actor_staff then
      raise exception 'Only staff can sign as the contractor';
    end if;

    had_old := old_p is not null and jsonb_typeof(old_p) = 'object';
    if not had_old and (new_p is null or jsonb_typeof(new_p) <> 'object') then
      -- "Clear" pressed when nothing was ever signed — nothing to log.
      NEW.contract_signatures := NEW.contract_signatures - k;
      continue;
    end if;
    if had_old and not actor_staff and OLD.contract_finalized_at is not null then
      raise exception 'This contract has already been submitted; its signature can no longer be changed';
    end if;

    captured := _capture_signature(
      'contract', NEW.id, NEW.id, k, old_p, new_p, snap,
      case when had_old and OLD.contract_finalized_at is not null then 'Changed by staff after the contract was finalized' end
    );

    if captured is null then
      NEW.contract_signatures := NEW.contract_signatures - k;
    else
      NEW.contract_signatures := jsonb_set(NEW.contract_signatures, array[k], captured);
    end if;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_jobs_signature_audit on jobs;
create trigger trg_jobs_signature_audit
  before update of contract_signatures on jobs
  for each row execute function trg_jobs_signature_audit();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Change orders — change_orders.co_signatures
--    An owner signature IS the approval, so once it exists only staff can
--    change or clear it (logged), and a declined CO can't be signed.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function trg_change_orders_signature_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  old_p jsonb;
  new_p jsonb;
  actor_staff boolean := coalesce(is_admin(), false) or _is_trusted_context();
  snap jsonb;
  captured jsonb;
  had_old boolean;
begin
  if NEW.co_signatures is not distinct from OLD.co_signatures then
    return NEW;
  end if;

  snap := to_jsonb(NEW) - 'co_signatures';

  for k in
    select jsonb_object_keys(coalesce(OLD.co_signatures, '{}'::jsonb))
    union
    select jsonb_object_keys(coalesce(NEW.co_signatures, '{}'::jsonb))
  loop
    old_p := OLD.co_signatures -> k;
    new_p := NEW.co_signatures -> k;
    if new_p is not distinct from old_p then continue; end if;

    if k not in ('contractor', 'owner') then
      raise exception 'Unknown change order signature role: %', k;
    end if;
    if k = 'contractor' and not actor_staff then
      raise exception 'Only staff can sign as the contractor';
    end if;

    had_old := old_p is not null and jsonb_typeof(old_p) = 'object';
    if not had_old and (new_p is null or jsonb_typeof(new_p) <> 'object') then
      NEW.co_signatures := NEW.co_signatures - k;
      continue;
    end if;
    if had_old and not actor_staff then
      raise exception 'This change order has already been signed and can no longer be changed';
    end if;
    if k = 'owner' and new_p is not null and jsonb_typeof(new_p) = 'object' and NEW.declined_at is not null then
      raise exception 'This change order was declined and can no longer be signed';
    end if;

    captured := _capture_signature(
      'change_order', NEW.id, NEW.job_id, k, old_p, new_p, snap,
      case when had_old then 'Changed by staff after the change order was signed' end
    );

    if captured is null then
      NEW.co_signatures := NEW.co_signatures - k;
    else
      NEW.co_signatures := jsonb_set(NEW.co_signatures, array[k], captured);
    end if;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_change_orders_signature_audit on change_orders;
create trigger trg_change_orders_signature_audit
  before update of co_signatures on change_orders
  for each row execute function trg_change_orders_signature_audit();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Work orders — work_orders.sub_signature
--    accept_work_order / decline_work_order already gate WHO can do this
--    (sub-company admins); this adds validation and evidence. A decline
--    after an accept legitimately clears the signature, so removal is
--    allowed but logged as a void.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function trg_work_orders_signature_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snap jsonb;
  captured jsonb;
begin
  if NEW.sub_signature is not distinct from OLD.sub_signature then
    return NEW;
  end if;

  -- Nothing signed before and nothing signed now (SQL null vs JSON null).
  if (OLD.sub_signature is null or jsonb_typeof(OLD.sub_signature) <> 'object')
     and (NEW.sub_signature is null or jsonb_typeof(NEW.sub_signature) <> 'object') then
    NEW.sub_signature := null;
    return NEW;
  end if;

  snap := to_jsonb(NEW) - 'sub_signature';
  captured := _capture_signature('work_order', NEW.id, NEW.job_id, 'sub', OLD.sub_signature, NEW.sub_signature, snap);
  NEW.sub_signature := captured;
  return NEW;
end;
$$;

drop trigger if exists trg_work_orders_signature_audit on work_orders;
create trigger trg_work_orders_signature_audit
  before update of sub_signature on work_orders
  for each row execute function trg_work_orders_signature_audit();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Backfill — signatures that already exist get a trail entry, clearly
--    marked as pre-audit so nobody mistakes them for fully-evidenced ones.
--    Runs the raw insert (not the triggers) so nothing on the documents
--    themselves is modified.
-- ═══════════════════════════════════════════════════════════════════════
insert into signature_events (
  document_type, document_id, job_id, signer_role, event_type, signer_name, signer_title,
  signer_is_staff, signed_at, signature_sha256, payload_date, note
)
select 'contract', j.id, j.id, s.key, 'signed', s.value ->> 'name', s.value ->> 'title',
  false,
  coalesce(case when s.value ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$' then (s.value ->> 'date')::date::timestamptz end, j.contract_finalized_at, now()),
  encode(sha256(convert_to(coalesce(s.value ->> 'signature', ''), 'utf8')), 'hex'),
  s.value ->> 'date',
  'Backfilled: signed before the audit trail existed (no IP/user-agent/document snapshot)'
from jobs j, jsonb_each(j.contract_signatures) s
where jsonb_typeof(s.value) = 'object' and s.value ? 'signature'
  and not exists (
    select 1 from signature_events e
    where e.document_type = 'contract' and e.document_id = j.id and e.signer_role = s.key
  );

insert into signature_events (
  document_type, document_id, job_id, signer_role, event_type, signer_name, signer_title,
  signer_is_staff, signed_at, signature_sha256, payload_date, note
)
select 'change_order', c.id, c.job_id, s.key, 'signed', s.value ->> 'name', s.value ->> 'title',
  false,
  coalesce(case when s.value ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$' then (s.value ->> 'date')::date::timestamptz end, now()),
  encode(sha256(convert_to(coalesce(s.value ->> 'signature', ''), 'utf8')), 'hex'),
  s.value ->> 'date',
  'Backfilled: signed before the audit trail existed (no IP/user-agent/document snapshot)'
from change_orders c, jsonb_each(c.co_signatures) s
where jsonb_typeof(s.value) = 'object' and s.value ? 'signature'
  and not exists (
    select 1 from signature_events e
    where e.document_type = 'change_order' and e.document_id = c.id and e.signer_role = s.key
  );

insert into signature_events (
  document_type, document_id, job_id, signer_role, event_type, signer_name, signer_title,
  signer_is_staff, signed_at, signature_sha256, payload_date, note
)
select 'work_order', w.id, w.job_id, 'sub', 'signed', w.sub_signature ->> 'name', w.sub_signature ->> 'title',
  false,
  coalesce(w.accepted_at, now()),
  encode(sha256(convert_to(coalesce(w.sub_signature ->> 'signature', ''), 'utf8')), 'hex'),
  w.sub_signature ->> 'date',
  'Backfilled: signed before the audit trail existed (no IP/user-agent/document snapshot)'
from work_orders w
where w.sub_signature is not null and jsonb_typeof(w.sub_signature) = 'object' and w.sub_signature ? 'signature'
  and not exists (
    select 1 from signature_events e where e.document_type = 'work_order' and e.document_id = w.id and e.signer_role = 'sub'
  );
