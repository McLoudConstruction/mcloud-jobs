import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // Signature didn't verify — this request didn't genuinely come from
    // Stripe. Reject it rather than trusting the payload.
    return Response.json({ error: `Webhook signature verification failed: ${err.message}` }, { status: 400 });
  }

  const supabase = serviceClient();

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const { data: payment } = await supabase.from('payments').select('*').eq('stripe_payment_intent_id', intent.id).single();
    if (payment && payment.status !== 'succeeded') {
      await supabase.from('payments').update({ status: 'succeeded', succeeded_at: new Date().toISOString() }).eq('id', payment.id);

      if (payment.invoice_id) {
        await supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', payment.invoice_id);
      } else {
        await supabase.from('jobs').update({ invoice_status: 'paid' }).eq('id', payment.job_id);
      }

      await supabase.from('notifications').insert({
        job_id: payment.job_id,
        message: `Payment received: $${payment.total_charged.toFixed(2)} via ${payment.payment_method.replace('_', ' ')}.`,
      });
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    await supabase.from('payments').update({ status: 'failed' }).eq('stripe_payment_intent_id', intent.id);
  }

  return Response.json({ received: true });
}
