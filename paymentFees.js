// Stripe's real published rates as of this build. If Stripe changes
// pricing, this is the only place that needs updating — every payment
// path (customer portal, admin in-person) calls this same function.
const RATES = {
  card_online: { percent: 0.029, flat: 0.30 },
  card_keyed: { percent: 0.034, flat: 0.30 },  // manual entry runs higher than online — Stripe treats it as higher-risk
  card_tap: { percent: 0.027, flat: 0.05 },    // card-present via a physical reader is the cheapest card rate
  ach: { percent: 0.008, flat: 0, cap: 5.00 }, // absorbed by McLoud, never shown to the customer as a fee
};

// Card fee is calculated on the total the customer actually pays (amount
// + fee), not just the base invoice amount — otherwise the fee added
// doesn't actually cover the real Stripe cost once Stripe takes its cut
// of the marked-up total too. Solving fee = rate*(amount+fee)+flat for
// fee algebraically: fee = (rate*amount + flat) / (1 - rate).
export function calculateFee(amountDue, paymentMethod) {
  const rate = RATES[paymentMethod];
  if (!rate) throw new Error(`Unknown payment method: ${paymentMethod}`);

  if (paymentMethod === 'ach') {
    // Absorbed cost, never charged to the customer — always returns 0
    // fee here. McLoud's actual Stripe cost (capped at $5) just comes
    // out of what they receive, same as any other business expense.
    return { fee: 0, total: amountDue };
  }

  const fee = (rate.percent * amountDue + rate.flat) / (1 - rate.percent);
  const roundedFee = Math.round(fee * 100) / 100;
  return { fee: roundedFee, total: Math.round((amountDue + roundedFee) * 100) / 100 };
}

export function formatMoney(v) {
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
