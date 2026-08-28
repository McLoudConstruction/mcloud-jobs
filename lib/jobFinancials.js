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
