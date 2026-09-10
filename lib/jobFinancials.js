// contract_price, invoice_amount, and invoice_status live in job_financials
// now, not on jobs — split out so RLS can hide financials from field crew
// per-row (see migration 062). Every place that used to read job.contract_price
// etc. directly can keep doing so if the query embeds job_financials(...)
// and the result is run through one of these helpers right after fetching.

export function flattenJobFinancials(jobs) {
  if (!jobs) return jobs;
  return jobs.map(j => ({
    ...j,
    contract_price: j.job_financials?.contract_price ?? null,
    invoice_amount: j.job_financials?.invoice_amount ?? null,
    invoice_status: j.job_financials?.invoice_status ?? 'not_sent',
    job_financials: undefined,
  }));
}

export function flattenJobFinancialsOne(job) {
  if (!job) return job;
  return flattenJobFinancials([job])[0];
}

// A change order shouldn't move the needle on revenue/margin until both
// sides have actually signed it — otherwise a drafted-but-unsent change
// order would inflate margin before the customer has agreed to pay for
// it. Used to compute an "adjusted" contract value everywhere margin is
// shown, so the number means the same thing in every card that shows it.
export function isChangeOrderAccepted(co) {
  return Boolean(co?.co_signatures?.contractor && co?.co_signatures?.owner);
}

export function acceptedChangeOrdersTotal(changeOrders) {
  return (changeOrders || []).filter(isChangeOrderAccepted).reduce((sum, co) => sum + Number(co.amount || 0), 0);
}

