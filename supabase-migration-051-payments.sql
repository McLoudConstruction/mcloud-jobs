-- Run in Supabase SQL Editor after migration 050. Safe to re-run.

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null, -- null when paying the single-invoice model instead of a draw

  amount_due numeric not null, -- the real invoice/draw amount, before any card surcharge
  payment_method text not null check (payment_method in ('card_online', 'card_keyed', 'card_tap', 'ach')),
  fee_amount numeric not null default 0, -- the surcharge added for card payments; always 0 for ach, since that cost is absorbed
  total_charged numeric not null, -- amount_due + fee_amount — the actual amount charged to the card or pulled via ACH

  stripe_payment_intent_id text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed', 'canceled')),
  created_by text not null check (created_by in ('customer', 'admin')),

  created_at timestamptz not null default now(),
  succeeded_at timestamptz
);

alter table payments enable row level security;

-- Row creation and status updates happen exclusively through server-side
-- API routes using the service-role key (same pattern as the public
-- consultation-request endpoint) — a payment record is only ever trusted
-- coming from code that's actually talking to Stripe, not a direct client
-- insert. Customers and admin can both read their own payment history.
drop policy if exists "Admin full access to payments" on payments;
create policy "Admin full access to payments" on payments for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Customer can view own payments" on payments;
create policy "Customer can view own payments" on payments for select
  using (has_job_portal_access(job_id));
