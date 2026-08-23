'use client';
import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { supabase } from '../lib/supabaseClient';
import { calculateFee, formatMoney } from '../lib/paymentFees';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

export default function PaymentFlow({ jobId, invoiceId, amountDue, createdBy, onSuccess }) {
  const [method, setMethod] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { fee: cardFee, total: cardTotal } = calculateFee(amountDue, 'card_online');

  async function chooseMethod(m) {
    setLoading(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId, invoiceId, paymentMethod: m,
          accessToken: session?.access_token,
          createdBy,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setClientSecret(data.clientSecret);
      setMethod(m);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <CheckoutForm onSuccess={onSuccess} onBack={() => { setClientSecret(null); setMethod(null); }} />
      </Elements>
    );
  }

  return (
    <div>
      <button
        onClick={() => chooseMethod('ach')}
        disabled={loading}
        className="payment-option payment-option-ach"
      >
        <div>
          <div className="payment-option-title">Pay by Bank Transfer (ACH)</div>
          <div className="payment-option-sub">2 to 4 business days to clear</div>
        </div>
        <div className="payment-option-right">
          <span className="payment-nofee-badge">No Fee</span>
          <span className="payment-option-amount">{formatMoney(amountDue)}</span>
        </div>
      </button>

      <button
        onClick={() => chooseMethod('card_online')}
        disabled={loading}
        className="payment-option payment-option-card"
      >
        <div>
          <div className="payment-option-title">Pay by Card</div>
          <div className="payment-option-sub">Instant, includes a {formatMoney(cardFee)} processing fee</div>
        </div>
        <div className="payment-option-right">
          <span className="payment-option-amount">{formatMoney(cardTotal)}</span>
        </div>
      </button>

      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 10 }}>{error}</div>}
    </div>
  );
}

function CheckoutForm({ onSuccess, onBack }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError('');
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });
    setSubmitting(false);
    if (confirmError) {
      setError(confirmError.message);
      return;
    }
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onSuccess(paymentIntent.status);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginTop: 10 }}>{error}</div>}
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" type="submit" disabled={submitting}>
          {submitting ? 'Processing…' : 'Submit Payment'}
        </button>
        <button className="btn btn-sm" type="button" onClick={onBack}>← Choose a different method</button>
      </div>
    </form>
  );
}
