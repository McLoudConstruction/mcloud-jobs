import crypto from 'crypto';

// The OAuth callback is a full-page redirect from Google/Microsoft/Intuit
// with no Authorization header, so there's no other way to know which
// staff member started the flow. The state param carries that identity,
// signed with INTEGRATION_ENCRYPTION_KEY so it can't be forged into
// connecting a provider to someone else's account (CSRF), and it
// expires after 10 minutes.
function getSecret() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) throw new Error('INTEGRATION_ENCRYPTION_KEY is not set in the environment.');
  return Buffer.from(raw, 'hex');
}

export function signState(staffId) {
  const payload = JSON.stringify({ staffId, ts: Date.now(), nonce: crypto.randomBytes(8).toString('hex') });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyState(state) {
  if (!state || !state.includes('.')) return null;
  const [encoded, sig] = state.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  if (sig !== expected || sig.length !== expected.length) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (Date.now() - payload.ts > 10 * 60 * 1000) return null; // 10 minute expiry
    return payload.staffId;
  } catch {
    return null;
  }
}
