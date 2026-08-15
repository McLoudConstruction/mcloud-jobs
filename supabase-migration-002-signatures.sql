-- Run this in Supabase SQL Editor (Project > SQL Editor > New Query > paste > Run)
-- Adds a place to store the contract's captured signatures.

alter table jobs add column if not exists contract_signatures jsonb not null default '{}';
-- Shape once filled in:
-- {
--   "contractor": { "name": "...", "title": "...", "signature": "data:image/png;base64,...", "date": "2026-08-15" },
--   "owner":      { "name": "...", "title": "...", "signature": "data:image/png;base64,...", "date": "2026-08-15" }
-- }
