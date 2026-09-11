import crypto from 'crypto';

// AES-256-GCM encryption for OAuth tokens and integration API keys at
// rest. INTEGRATION_ENCRYPTION_KEY must be a 32-byte value as 64 hex
// characters — generate one with `openssl rand -hex 32` and set it in
// Vercel env vars. Losing or rotating this key invalidates every stored
// token and key; staff will need to reconnect and re-enter keys.
function getKey() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) throw new Error('INTEGRATION_ENCRYPTION_KEY is not set in the environment.');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must be a 32-byte hex string (64 hex characters).');
  return key;
}

export function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(payload) {
  if (!payload) return null;
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
