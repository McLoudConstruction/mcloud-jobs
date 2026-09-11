// QBO_ENVIRONMENT should be 'production' or 'sandbox' in Vercel env vars.
function baseUrl() {
  return process.env.QBO_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

async function qboFetch(accessToken, realmId, path, options = {}) {
  const res = await fetch(`${baseUrl()}/v3/company/${realmId}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`QuickBooks API error (${path}): ${await res.text()}`);
  return res.json();
}

export async function getCompanyName(accessToken, realmId) {
  const data = await qboFetch(accessToken, realmId, `/companyinfo/${realmId}?minorversion=65`);
  return data?.CompanyInfo?.CompanyName || null;
}

async function findCustomerByName(accessToken, realmId, name) {
  const escaped = name.replace(/'/g, "\\'");
  const data = await qboFetch(accessToken, realmId, `/query?query=${encodeURIComponent(`select * from Customer where DisplayName = '${escaped}'`)}&minorversion=65`);
  return data?.QueryResponse?.Customer?.[0] || null;
}

async function createCustomer(accessToken, realmId, name) {
  const data = await qboFetch(accessToken, realmId, '/customer?minorversion=65', {
    method: 'POST',
    body: JSON.stringify({ DisplayName: name }),
  });
  return data.Customer;
}

async function findOrCreateCustomer(accessToken, realmId, name) {
  const existing = await findCustomerByName(accessToken, realmId, name);
  if (existing) return existing;
  return createCustomer(accessToken, realmId, name);
}

// QBO invoice lines need an ItemRef to an existing Product/Service item —
// there's no way to post a bare dollar amount. Every QBO company file
// ships with a default "Services" item, so that's the fallback; set
// QBO_DEFAULT_ITEM_NAME in Vercel env vars if the company uses a
// different one.
async function findDefaultItem(accessToken, realmId) {
  const itemName = process.env.QBO_DEFAULT_ITEM_NAME || 'Services';
  const escaped = itemName.replace(/'/g, "\\'");
  const data = await qboFetch(accessToken, realmId, `/query?query=${encodeURIComponent(`select * from Item where Name = '${escaped}'`)}&minorversion=65`);
  const item = data?.QueryResponse?.Item?.[0];
  if (!item) throw new Error(`No QuickBooks item named "${itemName}" was found — create one (Products & Services) or set QBO_DEFAULT_ITEM_NAME to an existing item's name.`);
  return item;
}

// Creates a new QBO invoice, or updates one previously synced (tracked
// via invoices.qbo_invoice_id). Returns { id, syncToken }.
export async function pushInvoiceToQBO(accessToken, realmId, { customerName, description, amount, existingQboId, existingSyncToken }) {
  const [customer, item] = await Promise.all([
    findOrCreateCustomer(accessToken, realmId, customerName),
    findDefaultItem(accessToken, realmId),
  ]);

  const payload = {
    CustomerRef: { value: customer.Id },
    Line: [{
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      Description: description || undefined,
      SalesItemLineDetail: { ItemRef: { value: item.Id }, Qty: 1, UnitPrice: amount },
    }],
  };
  if (existingQboId) {
    payload.Id = existingQboId;
    payload.SyncToken = existingSyncToken;
    payload.sparse = true;
  }

  const data = await qboFetch(accessToken, realmId, '/invoice?minorversion=65', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { id: data.Invoice.Id, syncToken: data.Invoice.SyncToken };
}

export async function getInvoiceSyncToken(accessToken, realmId, qboInvoiceId) {
  const data = await qboFetch(accessToken, realmId, `/invoice/${qboInvoiceId}?minorversion=65`);
  return data?.Invoice?.SyncToken;
}
