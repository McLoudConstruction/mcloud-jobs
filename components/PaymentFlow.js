'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { supabase } from '../lib/supabaseClient';
import { calculateFee, formatMoney } from '../lib/paymentFees';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

export default function PaymentFlow({ jobId, invoiceId, amountDue, createdBy, onSuccess, label = 'Amount Due' }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [method, setMethod] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [succeeded, setSucceeded] = useState(false);

  useState(() => { setMounted(true); });

  const { fee: cardFee, total: cardTotal } = calculateFee(amountDue, 'card_online');

  function reset() {
    setMethod(null);
    setClientSecret(null);
    setError('');
    setSucceeded(false);
  }

  function close() {
    setOpen(false);
    setTimeout(reset, 250);
  }

  async function chooseMethod(m) {
    setLoading(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, invoiceId, paymentMethod: m, accessToken: session?.access_token, createdBy }),
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

  function handleSuccess(status) {
    setSucceeded(true);
    onSuccess?.(status);
  }

  return (
    <>
      <button className="pay-trigger" onClick={() => setOpen(true)}>
        <span className="pay-trigger-icon">$</span>
        Pay Now — {formatMoney(amountDue)}
      </button>

      {open && mounted && createPortal(
        <div className="pay-modal-overlay" onClick={close}>
          <div className="pay-modal" onClick={e => e.stopPropagation()}>
            <button className="pay-modal-close" onClick={close} aria-label="Close">×</button>

            {succeeded ? (
              <div className="pay-success">
                <div className="pay-success-check">✓</div>
                <h3>Payment Received</h3>
                <p>Thank you — you're all set. A receipt will follow by email.</p>
                <button className="btn btn-primary btn-sm" onClick={close}>Done</button>
              </div>
            ) : clientSecret ? (
              <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#9b773d', fontFamily: 'inherit', borderRadius: '8px' } } }}>
                <CheckoutForm onSuccess={handleSuccess} onBack={reset} amount={method === 'ach' ? amountDue : cardTotal} />
              </Elements>
            ) : (
              <>
                <div className="pay-modal-header">
                  <div className="pay-modal-eyebrow">{label}</div>
                  <div className="pay-modal-amount">{formatMoney(amountDue)}</div>
                </div>

                <button onClick={() => chooseMethod('ach')} disabled={loading} className="payment-option payment-option-ach">
                  <div className="payment-option-icon">🏦</div>
                  <div style={{ flex: 1 }}>
                    <div className="payment-option-title">Bank Transfer (ACH)</div>
                    <div className="payment-option-sub">2–4 business days · recommended</div>
                  </div>
                  <div className="payment-option-right">
                    <span className="payment-nofee-badge">No Fee</span>
                    <span className="payment-option-amount">{formatMoney(amountDue)}</span>
                  </div>
                </button>

                <button onClick={() => chooseMethod('card_online')} disabled={loading} className="payment-option payment-option-card">
                  <div className="payment-option-icon">💳</div>
                  <div style={{ flex: 1 }}>
                    <div className="payment-option-title">Debit or Credit Card</div>
                    <div className="payment-option-sub">Instant · includes {formatMoney(cardFee)} processing fee</div>
                  </div>
                  <div className="payment-option-right">
                    <span className="payment-option-amount">{formatMoney(cardTotal)}</span>
                  </div>
                </button>

                {error && <div className="pay-error">{error}</div>}
                {loading && <div className="pay-loading">Setting up secure payment…</div>}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function CheckoutForm({ onSuccess, onBack, amount }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError('');
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    setSubmitting(false);
    if (confirmError) { setError(confirmError.message); return; }
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onSuccess(paymentIntent.status);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="pay-modal-header" style={{ marginBottom: 18 }}>
        <div className="pay-modal-eyebrow">Total Due Now</div>
        <div className="pay-modal-amount">{formatMoney(amount)}</div>
      </div>
      <PaymentElement />
      {error && <div className="pay-error">{error}</div>}
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" type="submit" disabled={submitting || !stripe}>
          {submitting ? 'Processing…' : 'Submit Payment'}
        </button>
        <button className="btn btn-sm" type="button" onClick={onBack}>← Choose a different method</button>
      </div>
    </form>
  );
}
