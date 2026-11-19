import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function fromBase64(value) {
  if (typeof value !== 'string') return null;
  const bytes = Buffer.from(value, 'base64');
  // Node's decoder alone accepts whitespace, base64url and invalid padding.
  return bytes.toString('base64') === value ? bytes : null;
}

function decodeKey(keyBase64) {
  if (typeof keyBase64 !== 'string' || keyBase64.length !== 44) return null;
  const key = fromBase64(keyBase64);
  return key?.length === 32 ? key : null;
}

export function secretKeyValid(keyBase64) {
  return decodeKey(keyBase64) !== null;
}

export function encryptSecret(plaintext, keyBase64) {
  const key = decodeKey(keyBase64);
  if (!key) throw new Error('encryption_not_ready');
  if (typeof plaintext !== 'string' || !plaintext.isWellFormed()) {
    throw new Error('secret_encrypt_failed');
  }

  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const segments = [iv, cipher.getAuthTag(), ciphertext].map((bytes) => bytes.toString('base64'));
    return `v1:${segments.join(':')}`;
  } catch {
    throw new Error('secret_encrypt_failed');
  }
}

export function decryptSecret(boxed, keyBase64) {
  try {
    const key = decodeKey(keyBase64);
    if (!key || typeof boxed !== 'string') throw new Error();
    const parts = boxed.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error();
    const [iv, tag, ciphertext] = parts.slice(1).map(fromBase64);
    if (iv?.length !== IV_BYTES || tag?.length !== TAG_BYTES || !ciphertext) throw new Error();

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintext);
  } catch {
    // Use the same error for malformed boxes, invalid keys and failed authentication.
    throw new Error('secret_decrypt_failed');
  }
}

export function lastFour(plaintext) {
  if (typeof plaintext !== 'string') return null;
  const characters = Array.from(plaintext);
  return characters.length < 8 ? null : characters.slice(-4).join('');
}
