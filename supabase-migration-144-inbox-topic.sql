-- Run in Supabase SQL Editor after migration 143. Safe to re-run.
--
-- The Inbox shows each conversation as "who it's with" + "what it's about"
-- ("Estimate Sent", "RFP Sent"). The topic is stored on the email at send time;
-- rows sent before this fall back to their subject line in the UI.
alter table email_messages add column if not exists topic text;

-- Give the obvious older sends a proper topic from their subject wording.
update email_messages set topic = case
  when subject ilike '%new estimate%'            then 'Estimate Sent'
  when subject ilike '%new contract%'            then 'Contract Sent'
  when subject ilike '%new invoice%'             then 'Invoice Sent'
  when subject ilike '%progress update%'         then 'Project Update Sent'
  when subject ilike '%change order%'            then 'Change Order Sent'
  when subject ilike '%material selection%'      then 'Material Selection Sent'
  when subject ilike '%project portal is ready%' then 'Portal Invite Sent'
  when subject ilike '%work order%'              then 'Work Order Sent'
  when subject ilike '%request for proposal%' or subject ilike '%rfp%' then 'RFP Sent'
  else topic end
where topic is null and direction = 'outbound';
