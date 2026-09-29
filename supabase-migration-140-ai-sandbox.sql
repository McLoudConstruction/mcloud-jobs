-- Migration 140 — AI provider sandbox
--
-- Every AI feature in this app already goes through one file (lib/aiClient.js).
-- This migration puts a real wall behind that file: which AI provider handles
-- text drafting (Anthropic or OpenAI) and which key it uses is now a setting,
-- not a hardcoded env var, without changing how any existing AI route calls in.
--
-- Today, with one company using this platform, the practical effect is small:
-- you can optionally paste in your own key instead of relying on the
-- ANTHROPIC_API_KEY set in Vercel. The real payoff is later — if this ever
-- becomes multi-tenant, each company's key lives in this same shape of table,
-- keyed by company instead of a single row, and nothing about the AI routes
-- themselves has to change.
--
-- Keys are encrypted at rest with pgcrypto, using a passphrase stored the
-- same way migration 139 stores the webhook secret (app_private_secrets) —
-- never in a migration file, never returned to the browser. The encrypted
-- bytes live in a second table with NO client access at all; only the
-- security-definer functions below can read or write them.

create extension if not exists pgcrypto;

-- Non-secret settings — which provider/model, and whether a key is on file.
-- Safe for the Settings screen to read/write directly, same as app_settings.
create table if not exists ai_provider_settings (
  id int primary key default 1,
  text_provider text not null default 'anthropic' check (text_provider in ('anthropic', 'openai')),
  text_model text,
  has_text_key boolean not null default false,
  transcription_provider text not null default 'openai' check (transcription_provider in ('openai')),
  has_transcription_key boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint ai_provider_settings_singleton check (id = 1)
);
insert into ai_provider_settings (id) values (1) on conflict (id) do nothing;

alter table ai_provider_settings enable row level security;
drop policy if exists "Admin can do everything on ai_provider_settings" on ai_provider_settings;
create policy "Admin can do everything on ai_provider_settings" on ai_provider_settings
  for all using (is_admin()) with check (is_admin());

-- The encrypted keys themselves. No RLS policy at all on purpose — not even
-- admin gets a row back from a plain select; only the functions below,
-- which run as the table owner, can touch this.
create table if not exists ai_provider_secrets (
  id int primary key default 1,
  text_api_key_ciphertext bytea,
  transcription_api_key_ciphertext bytea,
  constraint ai_provider_secrets_singleton check (id = 1)
);
insert into ai_provider_secrets (id) values (1) on conflict (id) do nothing;
alter table ai_provider_secrets enable row level security;
revoke all on ai_provider_secrets from public, anon, authenticated;

create or replace function _ai_encryption_passphrase()
returns text
language sql
stable
security definer
set search_path = public
as $$ select value from app_private_secrets where name = 'ai_key_encryption_passphrase'; $$;
revoke all on function _ai_encryption_passphrase() from public, anon, authenticated;

-- Admin pastes a key in Settings; this encrypts and stores it, and flips the
-- has_*_key flag so the UI can show "key on file" without ever reading it back.
create or replace function set_ai_api_key(p_kind text, p_api_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  passphrase text := _ai_encryption_passphrase();
  key text := nullif(btrim(coalesce(p_api_key, '')), '');
begin
  if not coalesce(is_admin(), false) then raise exception 'Staff only'; end if;
  if p_kind not in ('text', 'transcription') then raise exception 'Unknown key type.'; end if;
  if key is null then raise exception 'Paste an API key first.'; end if;
  if passphrase is null then
    raise exception 'No encryption passphrase is set yet. In the SQL editor, run: insert into app_private_secrets (name, value) values (''ai_key_encryption_passphrase'', ''<a long random string>'');';
  end if;
  if p_kind = 'text' then
    update ai_provider_secrets set text_api_key_ciphertext = pgp_sym_encrypt(key, passphrase) where id = 1;
    update ai_provider_settings set has_text_key = true, updated_at = now() where id = 1;
  else
    update ai_provider_secrets set transcription_api_key_ciphertext = pgp_sym_encrypt(key, passphrase) where id = 1;
    update ai_provider_settings set has_transcription_key = true, updated_at = now() where id = 1;
  end if;
end;
$$;
revoke all on function set_ai_api_key(text, text) from public, anon;
grant execute on function set_ai_api_key(text, text) to authenticated;

create or replace function clear_ai_api_key(p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(is_admin(), false) then raise exception 'Staff only'; end if;
  if p_kind not in ('text', 'transcription') then raise exception 'Unknown key type.'; end if;
  if p_kind = 'text' then
    update ai_provider_secrets set text_api_key_ciphertext = null where id = 1;
    update ai_provider_settings set has_text_key = false, updated_at = now() where id = 1;
  else
    update ai_provider_secrets set transcription_api_key_ciphertext = null where id = 1;
    update ai_provider_settings set has_transcription_key = false, updated_at = now() where id = 1;
  end if;
end;
$$;
revoke all on function clear_ai_api_key(text) from public, anon;
grant execute on function clear_ai_api_key(text) to authenticated;

-- Called only from server code with the service-role client — never exposed
-- to a browser session. Returns nulls for a key that isn't configured, so
-- the caller can fall back to its own env var.
create or replace function get_ai_provider_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s ai_provider_settings%rowtype;
  passphrase text := _ai_encryption_passphrase();
  text_key text;
  transcription_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not _is_trusted_context() then raise exception 'Not allowed'; end if;
  select * into s from ai_provider_settings where id = 1;
  if passphrase is not null then
    begin
      select pgp_sym_decrypt(text_api_key_ciphertext, passphrase) into text_key from ai_provider_secrets where id = 1 and text_api_key_ciphertext is not null;
    exception when others then text_key := null;
    end;
    begin
      select pgp_sym_decrypt(transcription_api_key_ciphertext, passphrase) into transcription_key from ai_provider_secrets where id = 1 and transcription_api_key_ciphertext is not null;
    exception when others then transcription_key := null;
    end;
  end if;
  return jsonb_build_object(
    'text_provider', coalesce(s.text_provider, 'anthropic'),
    'text_model', s.text_model,
    'text_api_key', text_key,
    'transcription_provider', coalesce(s.transcription_provider, 'openai'),
    'transcription_api_key', transcription_key
  );
end;
$$;
revoke all on function get_ai_provider_config() from public, anon, authenticated;
