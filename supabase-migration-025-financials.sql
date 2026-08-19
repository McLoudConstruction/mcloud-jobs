-- Run in Supabase SQL Editor after migration 024.
-- This is data-model-only — no UI reads or writes these tables yet, so
-- running this now is low-risk (just creates empty tables). Review the
-- design first; nothing here is final until you're happy with it.

-- ═══════════════════════════════════════════════════════════════════════
-- RECEIPTS — an uploaded receipt image plus the details keyed in (by you
-- or extracted by AI and confirmed by you). Coded to a job.
-- ═══════════════════════════════════════════════════════════════════════
create table receipts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  vendor_name text,
  company_id uuid references companies(id) on delete set null, -- optional link if the vendor is a known Company
  amount numeric not null,
  receipt_date date not null default current_date,
  category text not null default 'materials' check (category in ('materials','equipment','permits','other')),

  storage_path text, -- image in a private 'receipts' storage bucket
  ai_extracted jsonb, -- raw AI-read fields before human confirmation, kept for audit trail
  notes text,

  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- WORK ORDERS — issued to a subcontractor. Doubles as both a document
-- (like your proposals/contracts) and a cost commitment the moment it's
-- issued, before the sub ever invoices you back.
-- ═══════════════════════════════════════════════════════════════════════
create table work_orders (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  company_id uuid references companies(id) on delete set null, -- the subcontractor
  contact_id uuid references contacts(id) on delete set null, -- specific person at that company, if known

  description text,
  amount numeric not null, -- the committed/agreed amount

  status text not null default 'draft' check (status in ('draft','issued','accepted','completed','invoiced','paid')),
  issued_at timestamptz,
  sent_at timestamptz, -- when actually emailed to the sub — matches the sent-tracking pattern used elsewhere
  due_date date,

  -- What the sub actually invoiced back, once known — frequently
  -- different from the committed `amount` above. This is what lets
  -- job_costs move from 'committed' to 'actual' with a real number.
  invoiced_amount numeric,
  paid_at timestamptz,

  storage_path text, -- the sub's invoice/receipt back to you, if uploaded
  notes text,
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- JOB COSTS — the central ledger. Every cost tied to a job lands here,
-- regardless of source (a receipt, a work order, or a manual entry).
-- This is the single source of truth for "what has this job actually
-- cost me," including money you're committed to but haven't paid yet.
-- ═══════════════════════════════════════════════════════════════════════
create table job_costs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  category text not null check (category in ('materials','labor','subcontractor','permits','equipment','other')),
  description text,
  amount numeric not null,
  cost_date date not null default current_date,

  -- The distinction that actually matters: money you're on the hook for
  -- vs. money that's confirmed and settled.
  status text not null default 'actual' check (status in ('committed','actual')),

  -- Where this line originated. At most one of receipt_id / work_order_id
  -- is set, matching source_type; both null means it was entered by hand.
  source_type text not null default 'manual' check (source_type in ('receipt','work_order','manual')),
  receipt_id uuid references receipts(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,

  company_id uuid references companies(id) on delete set null, -- vendor or subcontractor, if known
  vendor_name text, -- free-text fallback, so entry doesn't require a Companies record first

  notes text,
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- INVOICES — supplements (does not replace) the existing single
-- invoice_amount/invoice_status/invoiced_at fields on jobs. Those keep
-- working as-is for simple one-invoice jobs. This table exists so a
-- bigger job can eventually be billed in multiple draws instead of one
-- lump sum, without forcing a migration of existing data right now.
-- Includes retainage fields since commercial jobs often withhold a
-- percentage until completion.
-- ═══════════════════════════════════════════════════════════════════════
create table invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,

  description text, -- e.g. "Draw 1 — Deposit", "Draw 2 — Rough-in complete"
  amount numeric not null,
  status text not null default 'not_sent' check (status in ('not_sent','sent','paid')),

  retainage_percent numeric, -- e.g. 10 for 10%, null if not applicable
  retainage_held numeric, -- dollar amount withheld, if any

  invoiced_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,

  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- BUSINESS EXPENSES — overhead that isn't tied to any one job (insurance,
-- truck payment, software, etc). Job costs alone only tell you if a job
-- was profitable; this is what eventually lets a real P&L exist —
-- revenue minus job costs minus overhead.
-- ═══════════════════════════════════════════════════════════════════════
create table business_expenses (
  id uuid primary key default gen_random_uuid(),
  category text,
  vendor_name text,
  company_id uuid references companies(id) on delete set null,
  amount numeric not null,
  expense_date date not null default current_date,
  storage_path text, -- receipt image, same idea as job receipts
  notes text,
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 1099 readiness — nullable fields on companies, so the data exists once
-- you start paying subs, even before there's any UI to act on it.
-- ═══════════════════════════════════════════════════════════════════════
alter table companies add column if not exists tax_id text; -- EIN or SSN
alter table companies add column if not exists requires_1099 boolean default false;

-- ═══════════════════════════════════════════════════════════════════════
-- RLS — all financial data is admin-only. No customer-facing access to
-- any of this, ever, matching the same is_admin() pattern used elsewhere.
-- ═══════════════════════════════════════════════════════════════════════
alter table receipts enable row level security;
alter table work_orders enable row level security;
alter table job_costs enable row level security;
alter table invoices enable row level security;
alter table business_expenses enable row level security;

create policy "Admin full access to receipts" on receipts for all using (is_admin());
create policy "Admin full access to work_orders" on work_orders for all using (is_admin());
create policy "Admin full access to job_costs" on job_costs for all using (is_admin());
create policy "Admin full access to invoices" on invoices for all using (is_admin());
create policy "Admin full access to business_expenses" on business_expenses for all using (is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- Storage — private bucket for receipt images, same pattern as job-photos.
-- ═══════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "Admin full access to receipt images"
  on storage.objects for all
  using (bucket_id = 'receipts' and is_admin());
