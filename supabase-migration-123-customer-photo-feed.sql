-- ═══════════════════════════════════════════════════════════════════════
-- Customer Portal — photo updates feed.
--
-- work_order_photos (migration 114) has been sub-facing only until now:
-- every photo a sub uploads is visible to staff and to that sub, nothing
-- else. To let customers see field progress photos without exposing
-- every in-progress/unflattering shot a crew takes, this adds an
-- is_internal flag (default TRUE — a photo has to be actively marked
-- shareable by staff, nothing is customer-visible by default) plus the
-- read access a customer needs to see the ones that are shared:
--   1. is_internal column on work_order_photos.
--   2. customer_visible_work_order_photos view — same pattern as
--      customer_visible_work_order_progress (migration 122): flattens in
--      job_id/trade from work_orders, filtered to is_internal = false and
--      has_job_portal_access(job_id), evaluated as the view owner so it
--      reads through even though customers have no direct policy on
--      work_order_photos itself.
--   3. A storage.objects SELECT policy on the subcontractor-docs bucket —
--      metadata access via the view isn't enough on its own, since
--      fetching the actual image (createSignedUrl) is checked against
--      storage.objects' own RLS, same as the existing staff/sub policy
--      from migration 114.
-- ═══════════════════════════════════════════════════════════════════════

alter table work_order_photos add column if not exists is_internal boolean not null default true;

-- work_order_photos was never added to the realtime publication back in
-- migration 114 (sub_messages was, this wasn't) — every existing
-- subscription on this table, sub portal included, has been silently
-- inert. Cheap to fix while adding two more subscribers to it (staff's
-- new toggle panel, the customer photo feed).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_order_photos'
  ) then
    alter publication supabase_realtime add table work_order_photos;
  end if;
end $$;

create or replace view customer_visible_work_order_photos as
select
  wop.id, wop.work_order_id, wo.job_id, wo.trade, wop.storage_path, wop.caption, wop.created_at
from work_order_photos wop
join work_orders wo on wo.id = wop.work_order_id
where wop.is_internal = false
  and has_job_portal_access(wo.job_id);

grant select on customer_visible_work_order_photos to authenticated;

drop policy if exists "Customers can view shared work order photo files" on storage.objects;
create policy "Customers can view shared work order photo files" on storage.objects for select
  using (
    bucket_id = 'subcontractor-docs'
    and (storage.foldername(name))[1] = 'progress-photos'
    and exists (
      select 1 from work_order_photos wop
      join work_orders wo on wo.id = wop.work_order_id
      where wop.storage_path = name
        and wop.is_internal = false
        and has_job_portal_access(wo.job_id)
    )
  );
