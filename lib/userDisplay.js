// How a signed-in staff member is shown in the app: the initials on the
// account button and the name at the top of its menu.
//
// staff_users.full_name is required, but migration 079 backfilled it with the
// login email for accounts that had no name saved, so a value that looks like
// an email is treated as "no name yet".

function looksLikeEmail(s) {
  return typeof s === 'string' && s.includes('@');
}

function nameWords(fullName) {
  if (!fullName || !fullName.trim() || looksLikeEmail(fullName)) return [];
  return fullName.trim().split(/\s+/).filter(Boolean);
}

// "pat.lee@x.com" -> ["Pat", "Lee"], "pat@x.com" -> ["Pat"]
function emailWords(email) {
  const local = (email || '').split('@')[0] || '';
  return local.split(/[._\-+\s]+/).filter(w => /[a-z]/i.test(w));
}

function cap(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : '';
}

// First and last initial ("Stachys McLoud" -> "SM"). A single word gives one
// letter. Middle names are skipped, so "Mary Ann Smith" -> "MS".
export function initialsFor(fullName, email) {
  let words = nameWords(fullName);
  if (!words.length) words = emailWords(email);
  if (!words.length) return '';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Full name for display. Falls back to a tidied version of the email's first
// part, then to the raw email.
export function displayNameFor(fullName, email) {
  const words = nameWords(fullName);
  if (words.length) return words.join(' ');
  const fromEmail = emailWords(email).map(cap).join(' ');
  return fromEmail || email || '';
}
