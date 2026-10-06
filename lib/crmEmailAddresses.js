// Pure helpers shared by the mailbox sync (server) and the email log panel
// (browser). No imports, no side effects, so both sides agree on exactly what
// counts as an address, a domain, and a "real" company domain.

const ADDRESS_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// A shared webmail domain says nothing about which company someone belongs
// to, so these never produce a company level match on their own.
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com',
  'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'comcast.net', 'att.net',
  'sbcglobal.net', 'bellsouth.net', 'verizon.net', 'cox.net', 'charter.net',
  'earthlink.net', 'mail.com', 'gmx.com', 'zoho.com', 'yandex.com',
]);

export function normalizeEmail(value) {
  const found = String(value || '').match(ADDRESS_RE);
  return found ? found[0].toLowerCase() : '';
}

// Pulls every address out of one or more header values, for example
// 'Jane Roe <jane@acme.com>, bob@acme.com'. Lowercased, de-duplicated.
export function parseAddresses(...values) {
  const out = new Set();
  for (const value of values) {
    const found = String(value || '').match(ADDRESS_RE);
    if (found) found.forEach(a => out.add(a.toLowerCase()));
  }
  return [...out];
}

export function domainOf(address) {
  const at = String(address || '').lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

// A domain is usable for company matching when it is not shared webmail and
// not one of our own domains (internal mail should never match a company).
export function isCompanyDomain(domain, internalDomains = []) {
  if (!domain) return false;
  if (FREE_MAIL_DOMAINS.has(domain)) return false;
  return !internalDomains.includes(domain);
}

export function parseInternalDomains(raw, accountEmail) {
  const list = String(raw || '')
    .split(/[,\s]+/)
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
  const own = domainOf(normalizeEmail(accountEmail));
  if (own && !FREE_MAIL_DOMAINS.has(own)) list.push(own);
  return [...new Set(list)];
}

// Splits a stored email field that may hold several addresses ("a@x.com;
// b@y.com") into clean lowercase addresses.
export function splitEmails(value) {
  return parseAddresses(value);
}

// Should this message be stored? True when any address on it, other than the
// mailbox owner's own, is saved on a CRM record, or when its domain belongs
// to a company on file.
export function messageMatchesCrm(addresses, ownerEmail, index) {
  const owner = normalizeEmail(ownerEmail);
  for (const address of addresses) {
    if (address === owner) continue;
    if (index.addresses.has(address)) return true;
    const domain = domainOf(address);
    if (index.companyDomains.has(domain)) return true;
  }
  return false;
}
