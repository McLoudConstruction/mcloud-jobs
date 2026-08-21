-- Run in Supabase SQL Editor after migration 043. Safe to re-run.

alter table work_orders add column if not exists sub_invoice_storage_path text;
alter table work_orders add column if not exists sub_invoice_filename text;
alter table work_orders add column if not exists sub_invoice_uploaded_at timestamptz;

-- Subcontractors can upload into invoices/{work_order_id}/... within the
-- existing private subcontractor-docs bucket, but only for a work order
-- that's actually theirs (matched via the company's contact_email — crew
-- logins can't upload, same "admin-only for money things" split as
-- accepting/declining a work order already uses).
drop policy if exists "Subcontractor can upload own invoice" on storage.objects;
create policy "Subcontractor can upload own invoice" on storage.objects for insert
  with check (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'invoices'
    and exists (
      select 1 from work_orders wo
      join companies c on c.id = wo.company_id
      where wo.id::text = (storage.foldername(name))[2]
        and c.contact_email = auth.jwt()->>'email'
    )
  );

drop policy if exists "Subcontractor can view own invoice" on storage.objects;
create policy "Subcontractor can view own invoice" on storage.objects for select
  using (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'invoices'
    and exists (
      select 1 from work_orders wo
      join companies c on c.id = wo.company_id
      where wo.id::text = (storage.foldername(name))[2]
        and (c.contact_email = auth.jwt()->>'email' or c.crew_email = auth.jwt()->>'email')
    )
  );

-- Narrow, purpose-built function rather than opening UPDATE access on
-- work_orders directly — mirrors accept_work_order / decline_work_order.
create or replace function upload_sub_invoice(target_work_order_id uuid, storage_path text, invoice_filename text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt()->>'email';
  is_authorized boolean;
begin
  select exists (
    select 1 from work_orders wo
    join companies c on c.id = wo.company_id
    where wo.id = target_work_order_id and c.contact_email = caller_email
  ) into is_authorized;

  if not is_authorized then
    raise exception 'Not authorized';
  end if;

  update work_orders
  set sub_invoice_storage_path = storage_path,
      sub_invoice_filename = invoice_filename,
      sub_invoice_uploaded_at = now()
  where id = target_work_order_id;
end;
$$;

grant execute on function upload_sub_invoice(uuid, text, text) to authenticated;
