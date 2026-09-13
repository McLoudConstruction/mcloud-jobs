-- Run in Supabase SQL Editor after migration 094. Safe to re-run.
--
-- Weather integration, phase two: extends the existing OpenWeatherMap
-- credential (migration 087) from current-conditions-only to full
-- forecast, and adds what's needed to flag outdoor phases against
-- trade-specific weather thresholds.
--
-- Design note: weather_cache and geocode_cache are deliberately NOT
-- scoped to a company/tenant. Weather for a given point is the same
-- regardless of which job or business is asking, so caching by rounded
-- location — not by job — is what keeps API call volume flat as usage
-- grows. If this app is ever split into a multi-tenant product sold to
-- other contractors, these two tables need no changes; only tables like
-- jobs/opportunities would need a tenant_id.

-- ─── Work Location tagging ────────────────────────────────────────────
-- "New Opportunity" (app/jobs/new) creates a row directly in `jobs` at
-- an early stage (phaseForStage() buckets 'new'/'inspected'/etc. as the
-- 'opportunity' phase) — it's a jobs-table field, not the separate
-- top-of-funnel `opportunities` leads table. Captured at creation, before
-- there's a confirmed schedule or necessarily even a firm address, so
-- it's a default/informational value until the schedule exists.
alter table jobs add column if not exists work_location text check (work_location in ('indoor', 'outdoor'));

-- Schedule-stage: per PHASE, not per job — a single job routinely has
-- both indoor and outdoor phases (framing vs. cabinetry) at different
-- points in the schedule, so this is where actual weather flagging reads
-- from. Defaults to the job-level value above when a schedule is first
-- generated (see lib/scheduleTemplate.js), but can differ per phase.
alter table job_phases add column if not exists work_location text check (work_location in ('indoor', 'outdoor'));

-- ─── Job site geocoding ───────────────────────────────────────────────
-- Geocoded lazily (see lib/integrations/weatherClient.js) the first time
-- weather is checked for a job, not eagerly on every save.
alter table jobs add column if not exists site_lat numeric;
alter table jobs add column if not exists site_lng numeric;
alter table jobs add column if not exists site_geocoded_at timestamptz;

-- ─── Per-trade weather thresholds ─────────────────────────────────────
-- Seeded with sensible defaults now; no settings UI yet to edit these —
-- that's a follow-up once the defaults have been used on a few real jobs
-- and Stachys knows what actually needs adjusting.
create table if not exists trade_weather_rules (
  trade text primary key,
  min_temp_f integer,       -- null = no minimum
  max_temp_f integer,       -- null = no maximum
  max_wind_mph integer,     -- null = no wind limit
  blocks_on_rain boolean not null default false,
  blocks_on_snow boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);

alter table trade_weather_rules enable row level security;
create policy "Authenticated can read trade_weather_rules" on trade_weather_rules for select using (auth.role() = 'authenticated');
create policy "Admin can manage trade_weather_rules" on trade_weather_rules for all using (is_admin()) with check (is_admin());

insert into trade_weather_rules (trade, min_temp_f, max_temp_f, max_wind_mph, blocks_on_rain, blocks_on_snow, notes) values
  ('Framing', 10, null, 35, false, false, 'Cold-tolerant; rain slows work and risks lumber but rarely stops it outright.'),
  ('Roofing', 40, 95, 25, true, true, 'Shingle seal-down and membrane adhesion need dry conditions and a moderate temperature window.'),
  ('Electrical', 20, null, 35, true, false, 'Outdoor electrical work pauses in active rain for safety.'),
  ('Plumbing', 20, null, 35, false, false, 'Outdoor site utility work tolerant of cold and light rain.'),
  ('HVAC', 20, null, 35, false, false, 'Outdoor condenser/line-set work tolerant of most conditions.'),
  ('Drywall', 45, 95, null, false, false, 'Indoor trade; only exterior sheathing tie-ins need dry conditions.'),
  ('Painting', 50, 90, 15, true, true, 'Most exterior paints and stains require a specific cure temperature and dry surfaces.'),
  ('Flooring', 40, 90, null, true, false, 'Exterior decking adhesives are temperature sensitive.'),
  ('Tile', 40, 95, null, true, false, 'Thin-set and grout cure times are temperature and moisture sensitive.'),
  ('Cabinetry', null, null, null, false, false, 'Indoor work; weather rarely a factor.'),
  ('Countertops', null, null, null, false, false, 'Indoor work; weather rarely a factor.'),
  ('Concrete/Foundation', 40, 90, null, true, true, 'Cure is highly temperature sensitive; rain compromises a fresh pour.'),
  ('Masonry', 40, 90, null, true, true, 'Mortar cure is temperature sensitive; rain washes out fresh joints.'),
  ('Windows & Doors', 20, null, 25, true, false, 'Sealant and weatherproofing need dry conditions to cure.'),
  ('Insulation', null, null, null, false, false, 'Typically indoor or already-protected work.'),
  ('Siding', 20, null, 25, true, false, 'Many siding materials and sealants need dry, moderate-wind conditions.'),
  ('Demo/Site Prep', 0, null, 40, false, false, 'Tolerant of most conditions; high wind is the main safety concern.'),
  ('Landscaping', 20, null, 30, true, false, 'Planting and grading are rain- and freeze-sensitive.'),
  ('General Labor', 0, null, 40, false, false, 'Tolerant of most conditions.'),
  ('Other', null, null, null, false, false, 'No default rule — review case by case.')
on conflict (trade) do nothing;

-- ─── Shared forecast cache ────────────────────────────────────────────
-- Keyed by lat/lng rounded to ~0.05 degrees (~5.5km), so every job or
-- dashboard lookup in the same area within the TTL window shares one
-- OpenWeatherMap call instead of paying for one per request. No client
-- write policy — writes only happen server-side via the service role key
-- (lib/integrations/weatherClient.js), same pattern as
-- integration_credentials.
create table if not exists weather_cache (
  grid_lat numeric not null,
  grid_lng numeric not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (grid_lat, grid_lng)
);
alter table weather_cache enable row level security;
create policy "Authenticated can read weather_cache" on weather_cache for select using (auth.role() = 'authenticated');

-- ─── Geocode cache ────────────────────────────────────────────────────
-- Address -> lat/lng, cached indefinitely (a street address doesn't
-- move). Same no-client-write pattern as weather_cache above.
create table if not exists geocode_cache (
  address_key text primary key, -- normalized "street|city|state|zip", lowercased
  lat numeric not null,
  lng numeric not null,
  fetched_at timestamptz not null default now()
);
alter table geocode_cache enable row level security;
create policy "Authenticated can read geocode_cache" on geocode_cache for select using (auth.role() = 'authenticated');
