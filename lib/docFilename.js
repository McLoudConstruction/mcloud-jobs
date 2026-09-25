// One place that decides what every downloaded / emailed document is
// called, so files sort and search consistently once they leave the app:
//
//   McLoud.<Document-Type>.<Customer-Or-Company>.<MM-DD-YY>.pdf
//   e.g. McLoud.Invoice.Acme-Properties.09-24-26.pdf
//
// Slashes can't be used in a file name (the OS treats them as folder
// separators), so the date uses dashes instead of xx/xx/xx.
//
// `date` may be a 'YYYY-MM-DD' string (a document's own date — parsed by
// hand so a timezone shift can't move it to the previous day), a Date, or
// omitted, in which case today's date (local time) is used.

function clean(part, fallback) {
  const cleaned = String(part ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')      // strip accents
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, '-')        // anything else becomes a hyphen
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function formatFileDate(date) {
  let y, m, d;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    [y, m, d] = date.slice(0, 10).split('-').map(Number);
  } else {
    const dt = date instanceof Date && !isNaN(date) ? date : new Date();
    y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate();
  }
  const pad = n => String(n).padStart(2, '0');
  return `${pad(m)}-${pad(d)}-${pad(y % 100)}`;
}

export function docFilename(docType, customerName, date, ext = 'pdf') {
  return `McLoud.${clean(docType, 'Document')}.${clean(customerName, 'Customer')}.${formatFileDate(date)}.${ext}`;
}
