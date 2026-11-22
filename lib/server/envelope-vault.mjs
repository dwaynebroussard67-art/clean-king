// Envelope encryption for Tier-2 onboarding data (SSNs, IDs, bank numbers).
//
//   KEK (key-encryption key)   env var, versioned, never stored in the database
//     └─ wraps → per-franchise DEK (data key)   stored wrapped in org_data_keys
//          └─ encrypts → each value, with AAD = org | subject | field
//
// Why this shape:
//  * A database dump, backup or SQL-injection read yields only ciphertext.
//  * AAD binding means a ciphertext copied to another row/org/field fails authentication.
//  * Rotating the KEK re-wraps a handful of DEKs, not millions of values.
//  * A blind index (HMAC) lets us detect "this SSN was already entered" without decrypting.
// Honest limit: anyone holding BOTH database write access and the KEK env var can decrypt.
// Moving the KEK under a customer-held passkey is the later step that removes that (see blueprint).
// Primitives are Node's built-in AES-256-GCM / HKDF / HMAC; nothing here invents cryptography.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const IV_BYTES = 12, TAG_BYTES = 16, KEY_BYTES = 32, SEP = '\u001f';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => { const b = Buffer.from(s, 'base64url'); return b64u(b) === s ? b : null; };

function toKey(value) {
  const buf = Buffer.isBuffer(value) ? value : typeof value === 'string' ? unb64u(value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')) : null;
  if (!buf || buf.length !== KEY_BYTES) throw new Error('vault_key_invalid');
  return buf;
}

/** keys: { [version:number]: 32-byte Buffer or base64 string }, current: version used for new wraps. */
export function createKeyring({ current, keys }) {
  const ring = new Map();
  for (const [v, k] of Object.entries(keys ?? {})) ring.set(Number(v), toKey(k));
  if (!ring.has(current)) throw new Error('vault_key_missing');
  return Object.freeze({ current, get: (v) => { const k = ring.get(v); if (!k) throw new Error('vault_key_missing'); return k; } });
}

/** ONBOARDING_KEK_CURRENT=2, ONBOARDING_KEK_V1=<base64 32B>, ONBOARDING_KEK_V2=<base64 32B> */
export function keyringFromEnv(env = process.env) {
  const current = Number(env.ONBOARDING_KEK_CURRENT);
  if (!Number.isInteger(current) || current < 1) return null;
  const keys = {};
  for (const [name, val] of Object.entries(env)) {
    const m = /^ONBOARDING_KEK_V(\d+)$/.exec(name);
    if (m && val) keys[Number(m[1])] = val;
  }
  try { return createKeyring({ current, keys }); } catch { return null; }
}

function gcmSeal(key, plaintext, aad) {
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv, tag: c.getAuthTag(), ct };
}
function gcmOpen(key, iv, tag, ct, aad) {
  const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

// ---- per-franchise data key -------------------------------------------------------------

/** Make a fresh DEK for a franchise. Returns the raw DEK (keep in memory only) and its wrapped form for storage. */
export function generateOrgKey(orgId, keyring) {
  const dek = randomBytes(KEY_BYTES);
  return { dek, ...wrapDek(dek, orgId, keyring) };
}
export function wrapDek(dek, orgId, keyring, kekVersion = keyring.current) {
  const { iv, tag, ct } = gcmSeal(keyring.get(kekVersion), dek, `dek${SEP}${orgId}${SEP}${kekVersion}`);
  return { wrapped: `k1.${b64u(iv)}.${b64u(tag)}.${b64u(ct)}`, kekVersion };
}
export function unwrapDek(wrapped, orgId, kekVersion, keyring) {
  try {
    const [tagName, iv, tag, ct] = String(wrapped).split('.');
    if (tagName !== 'k1') throw new Error();
    return gcmOpen(keyring.get(kekVersion), unb64u(iv), unb64u(tag), unb64u(ct), `dek${SEP}${orgId}${SEP}${kekVersion}`);
  } catch { throw new Error('vault_unwrap_failed'); }
}
/** KEK rotation: unwrap with the old version, wrap with the target (default current). Data ciphertexts are untouched. */
export function rewrapDek(wrapped, orgId, fromVersion, keyring, toVersion = keyring.current) {
  return wrapDek(unwrapDek(wrapped, orgId, fromVersion, keyring), orgId, keyring, toVersion);
}

// ---- values -----------------------------------------------------------------------------

const aadFor = (ctx) => [ctx.orgId, ctx.subjectKey, ctx.fieldKey].join(SEP);

export function seal(plaintext, ctx, dek, dekVersion = 1) {
  if (typeof plaintext !== 'string' || !plaintext.isWellFormed() || plaintext.length === 0) throw new Error('vault_seal_failed');
  const { iv, tag, ct } = gcmSeal(dek, Buffer.from(plaintext, 'utf8'), aadFor(ctx));
  return `v2.${dekVersion}.${b64u(iv)}.${b64u(tag)}.${b64u(ct)}`;
}
export function envelopeVersion(envelope) { const p = String(envelope).split('.'); return p[0] === 'v2' ? Number(p[1]) : null; }
export function open(envelope, ctx, dek) {
  try {
    const [v, , iv, tag, ct] = String(envelope).split('.');
    if (v !== 'v2') throw new Error();
    return gcmOpen(dek, unb64u(iv), unb64u(tag), unb64u(ct), aadFor(ctx)).toString('utf8');
  } catch { throw new Error('vault_open_failed'); } // one error for tamper, wrong key, wrong row
}

/** Deterministic, keyed fingerprint of a (normalized) value: equal inputs match, but it cannot be reversed without the DEK. */
export function blindIndex(value, fieldKey, dek) {
  const k = Buffer.from(hkdfSync('sha256', dek, 'forge-onboarding', `blind-index${SEP}${fieldKey}`, KEY_BYTES));
  return createHmac('sha256', k).update(String(value)).digest('hex');
}
