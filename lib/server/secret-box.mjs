import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function decodeKey(keyBase64) {
  if (!secretKeyValid(keyBase64)) throw new Error('encryption_not_ready');
  return Buffer.from(keyBase64, 'base64');
}

export function secretKeyValid(keyBase64) {
  if (typeof keyBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(keyBase64)) {
    return false;
  }
  const decoded = Buffer.from(keyBase64, 'base64');
  return decoded.byteLength === 32 && decoded.toString('base64') === keyBase64;
}

export function encryptSecret(plaintext, keyBase64) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new Error('invalid_secret');
  const key = decodeKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(boxed, keyBase64) {
  try {
    const key = decodeKey(keyBase64);
    if (typeof boxed !== 'string') throw new Error('bad_box');
    const parts = boxed.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('bad_box');
    const [, ivText, tagText, ciphertextText] = parts;
    const iv = Buffer.from(ivText, 'base64');
    const tag = Buffer.from(tagText, 'base64');
    const ciphertext = Buffer.from(ciphertextText, 'base64');
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES ||
        !isCanonicalBase64(ivText, iv) || !isCanonicalBase64(tagText, tag) ||
        !isCanonicalBase64(ciphertextText, ciphertext)) throw new Error('bad_box');
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('secret_decrypt_failed');
  }
}

export function lastFour(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length < 8) return null;
  return plaintext.slice(-4);
}

function isCanonicalBase64(source, decoded) {
  return source.length > 0 && decoded.toString('base64') === source;
}
