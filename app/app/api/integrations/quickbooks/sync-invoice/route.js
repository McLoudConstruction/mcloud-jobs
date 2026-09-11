import { NextResponse } from 'next/server';
import { requireOwner } from '../../../../../lib/integrations/authHelper';
import { getAdminClient } from '../../../../../lib/supabaseAdmin';
import { getValidAccessToken } from '../../../../../lib/integrations/tokens';
import { pushInvoiceToQBO, getInvoiceSyncToken } from '../../../../../lib/integrations/quickbooks';

export async function POST(request) {
  const auth = await requireOwner(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { invoiceId } = await request.json();
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId is required.' }, { status: 400 });

  const admin = getAdminClient();

  const { data: connection } = await admin
    .from('integration_connections')
    .select('*')
    .eq('staff_id', auth.staffId)
    .eq('provider', 'quickbooks')
    .single();
  if (!connection) return NextResponse.json({ error: 'QuickBooks is not connected — connect it in Settings → Integrations first.' }, { status: 400 });

  const { data: draw } = await admin.from('invoices').select('*, jobs(customer_name)').eq('id', invoiceId).single();
  if (!draw) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });

  try {
    const accessToken = await getValidAccessToken(connection);
    const realmId = connection.external_account_id;

    let existingSyncToken;
    if (draw.qbo_invoice_id) {
      existingSyncToken = await getInvoiceSyncToken(accessToken, realmId, draw.qbo_invoice_id);
    }

    const result = await pushInvoiceToQBO(accessToken, realmId, {
      customerName: draw.jobs?.customer_name || 'Customer',
      description: draw.description,
      amount: draw.amount,
      existingQboId: draw.qbo_invoice_id,
      existingSyncToken,
    });

    await admin.from('invoices').update({ qbo_invoice_id: result.id, qbo_synced_at: new Date().toISOString() }).eq('id', invoiceId);

    return NextResponse.json({ success: true, qboInvoiceId: result.id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
