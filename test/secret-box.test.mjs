import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, encryptSecret, lastFour, secretKeyValid } from '../lib/server/secret-box.mjs';

const KEY = Buffer.alloc(32, 11).toString('base64');
const WRONG_KEY = Buffer.alloc(32, 12).toString('base64');
const PLAINTEXT = '\uFEFFsynthetic-key-Bó7Z';
const decryptionError = { message: 'secret_decrypt_failed' };

test('secret keys must be canonical standard base64 of exactly 32 bytes', () => {
  assert.equal(secretKeyValid(KEY), true);
  for (const key of [
    null, undefined, 123, '', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'),
    KEY.slice(0, -1), `${KEY}\n`, ` ${KEY}`, `${KEY.slice(0, -1)}!`, '-'.repeat(43) + '=',
  ]) {
    assert.equal(secretKeyValid(key), false);
  }
  assert.throws(() => encryptSecret(PLAINTEXT, 'invalid'), { message: 'encryption_not_ready' });
});

test('AES-GCM boxes round-trip with a fresh 12-byte IV and a 16-byte authentication tag', () => {
  const first = encryptSecret(PLAINTEXT, KEY);
  const next = encryptSecret(PLAINTEXT, KEY);
  const [version, iv, tag, ciphertext] = first.split(':');
  assert.equal(version, 'v1');
  assert.equal(Buffer.from(iv, 'base64').length, 12);
  assert.equal(Buffer.from(tag, 'base64').length, 16);
  assert.ok(ciphertext);
  assert.notEqual(iv, next.split(':')[1]);
  assert.ok(!first.includes(PLAINTEXT));
  assert.equal(decryptSecret(first, KEY), PLAINTEXT);
  assert.equal(decryptSecret(next, KEY), PLAINTEXT);
  assert.equal(decryptSecret(encryptSecret('', KEY), KEY), '');
});

test('editing the version, IV, tag or ciphertext never decrypts', () => {
  const box = encryptSecret(PLAINTEXT, KEY);
  assert.throws(() => decryptSecret(box.replace(/^v1:/, 'v2:'), KEY), decryptionError);
  for (const index of [1, 2, 3]) {
    const parts = box.split(':');
    const bytes = Buffer.from(parts[index], 'base64');
    bytes[0] ^= 1;
    parts[index] = bytes.toString('base64');
    assert.throws(() => decryptSecret(parts.join(':'), KEY), decryptionError);
  }
});

test('wrong keys and malformed envelopes use the same non-sensitive error', () => {
  const box = encryptSecret(PLAINTEXT, KEY);
  const [, iv, tag, ciphertext] = box.split(':');
  assert.throws(() => decryptSecret(box, WRONG_KEY), decryptionError);
  assert.throws(() => decryptSecret(box, 'invalid'), decryptionError);
  for (const value of [
    5, null, 'v1', `${box}:more`, ` v1:${iv}:${tag}:${ciphertext}`,
    `v1:AA==:${tag}:${ciphertext}`, `v1:${iv}:AA==:${ciphertext}`,
    `v1:${iv}:${tag.slice(0, -1)}:${ciphertext}`, `v1:${iv}:${tag}:${ciphertext}!`,
  ]) {
    assert.throws(() => decryptSecret(value, KEY), (error) => {
      assert.equal(error.message, 'secret_decrypt_failed');
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(String(error), /synthetic-key/);
      return true;
    });
  }
});

test('a short secret is never revealed in full as a status suffix', () => {
  assert.equal(lastFour(''), null);
  assert.equal(lastFour('1234567'), null);
  assert.equal(lastFour('12345678'), '5678');
  assert.equal(lastFour('1234αβ🙂Z'), 'αβ🙂Z');
});
