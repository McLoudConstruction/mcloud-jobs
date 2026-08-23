import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { calculateFee } from '../../../../lib/paymentFees';

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// A client scoped to the CALLER's own session token, not the service
// role — this is what actually enforces "can this person see this job,"
// since RLS (has_job_portal_access / is_admin) runs for real against
// this client, unlike the service-role client which bypasses RLS
// entirely and must never be trusted with an unverified job_id.
function callerClient(accessToken) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function POST(request) {
  try {
    const { jobId, invoiceId, paymentMethod, accessToken, createdBy } = await request.json();

    if (!jobId || !paymentMethod || !accessToken || !createdBy) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }
    if (!['card_online', 'card_keyed', 'card_tap', 'ach'].includes(paymentMethod)) {
      return Response.json({ error: 'Invalid payment method.' }, { status: 400 });
    }

    // Verify real access using the caller's own token — this is the
    // actual security boundary, not a formality. If this select fails
    // or returns nothing, RLS has already told us this person can't see
    // this job, and we stop here before ever touching Stripe.
    const caller = callerClient(accessToken);
    const { data: job, error: jobErr } = await caller.from('jobs').select('id, invoice_status, invoice_amount').eq('id', jobId).single();
    if (jobErr || !job) {
      return Response.json({ error: 'Not authorized for this job.' }, { status: 403 });
    }

    // Amount due is always read server-side, from whichever record is
    // actually being paid — never taken from the client, so there's no
    // way to submit a payment for less than what's really owed.
    let amountDue;
    if (invoiceId) {
      const { data: invoice, error: invErr } = await caller.from('invoices').select('id, amount, status').eq('id', invoiceId).eq('job_id', jobId).single();
      if (invErr || !invoice) return Response.json({ error: 'Invoice not found.' }, { status: 404 });
      if (invoice.status === 'paid') return Response.json({ error: 'This has already been paid.' }, { status: 400 });
      amountDue = Number(invoice.amount);
    } else {
      if (!job.invoice_amount || job.invoice_status === 'paid') {
        return Response.json({ error: 'No open invoice found for this job.' }, { status: 400 });
      }
      amountDue = Number(job.invoice_amount);
    }

    const { fee, total } = calculateFee(amountDue, paymentMethod);

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const isAch = paymentMethod === 'ach';

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100), // Stripe works in cents
      currency: 'usd',
      payment_method_types: isAch ? ['us_bank_account'] : ['card'],
      metadata: { job_id: jobId, invoice_id: invoiceId || '', payment_method: paymentMethod },
    });

    const supabase = serviceClient();
    const { data: payment, error: payErr } = await supabase.from('payments').insert({
      job_id: jobId,
      invoice_id: invoiceId || null,
      amount_due: amountDue,
      payment_method: paymentMethod,
      fee_amount: fee,
      total_charged: total,
      stripe_payment_intent_id: intent.id,
      status: 'pending',
      created_by: createdBy,
    }).select().single();

    if (payErr) {
      return Response.json({ error: payErr.message }, { status: 500 });
    }

    return Response.json({
      clientSecret: intent.client_secret,
      paymentId: payment.id,
      amountDue,
      fee,
      total,
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Something went wrong.' }, { status: 500 });
  }
}
