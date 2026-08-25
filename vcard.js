// Minimal vCard (.vcf) parser for iPhone/macOS Contacts exports. Handles
// the common vCard 3.0/4.0 fields Contacts actually produces: FN/N, TEL,
// EMAIL, ADR, ORG. Unfolds continuation lines per the vCard spec (a line
// starting with a space or tab is a continuation of the previous line).
export function parseVCard(text) {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);

  return cards.map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const contact = {};
    let firstName = '', lastName = '', fullName = '';

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      const rawKey = line.slice(0, colonIndex);
      const rawValue = line.slice(colonIndex + 1);
      const key = rawKey.split(';')[0].toUpperCase();

      if (key === 'FN') {
        fullName = unescapeVCard(rawValue);
      } else if (key === 'N') {
        const parts = rawValue.split(';');
        lastName = unescapeVCard(parts[0] || '');
        firstName = unescapeVCard(parts[1] || '');
      } else if (key === 'EMAIL' && !contact.contact_email) {
        contact.contact_email = unescapeVCard(rawValue);
      } else if (key === 'TEL' && !contact.contact_phone) {
        contact.contact_phone = unescapeVCard(rawValue);
      } else if (key === 'ORG' && !contact.management_company) {
        contact.management_company = unescapeVCard(rawValue.split(';')[0]);
      } else if (key === 'TITLE' && !contact.position) {
        contact.position = unescapeVCard(rawValue);
      } else if (key === 'ADR' && !contact.address_street) {
        // ADR components: PO Box;Extended;Street;City;State;Zip;Country
        const parts = rawValue.split(';').map(unescapeVCard);
        contact.address_street = parts[2] || '';
        contact.address_city = parts[3] || '';
        contact.address_state = parts[4] || '';
        contact.address_zip = parts[5] || '';
      }
    }

    contact.first_name = firstName || (fullName ? fullName.split(' ')[0] : '');
    contact.last_name = lastName || (fullName ? fullName.split(' ').slice(1).join(' ') : '');
    contact.name = fullName || [contact.first_name, contact.last_name].filter(Boolean).join(' ');

    return contact;
  }).filter(c => c.name && c.name.trim());
}

function unescapeVCard(value) {
  return (value || '').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').trim();
}
