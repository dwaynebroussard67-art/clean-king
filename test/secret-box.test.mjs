import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, lastFour, secretKeyValid } from '../lib/server/secret-box.mjs';

const key = Buffer.alloc(32, 7).toString('base64');
const otherKey = Buffer.alloc(32, 8).toString('base64');

test('AES-256-GCM envelope round-trips with a fresh IV and validates the key', () => {
  assert.equal(secretKeyValid(key), true);
  assert.equal(secretKeyValid(''), false);
  assert.equal(secretKeyValid(Buffer.alloc(31, 7).toString('base64')), false);
  assert.equal(secretKeyValid('not base64'.repeat(4)), false);
  const first = encryptSecret('provider-key-value', key);
  const second = encryptSecret('provider-key-value', key);
  assert.match(first, /^v1:/);
  assert.notEqual(first, second);
  assert.equal(decryptSecret(first, key), 'provider-key-value');
});

test('tampering with every envelope segment and using the wrong key fails generically', () => {
  const boxed = encryptSecret('another-provider-key', key);
  const segments = boxed.split(':');
  const replacements = [
    ['v2', segments[1], segments[2], segments[3]],
    [segments[0], flipBase64(segments[1]), segments[2], segments[3]],
    [segments[0], segments[1], flipBase64(segments[2]), segments[3]],
    [segments[0], segments[1], segments[2], flipBase64(segments[3])],
  ];
  for (const parts of replacements) {
    assert.throws(() => decryptSecret(parts.join(':'), key), { message: 'secret_decrypt_failed' });
  }
  assert.throws(() => decryptSecret(boxed, otherKey), { message: 'secret_decrypt_failed' });
  assert.throws(() => decryptSecret('bad-format', key), { message: 'secret_decrypt_failed' });
});

test('lastFour withholds short values', () => {
  assert.equal(lastFour('12345678'), '5678');
  assert.equal(lastFour('short'), null);
  assert.equal(lastFour(null), null);
});

function flipBase64(value) {
  const chars = value.split('');
  const index = chars.findIndex((char) => char !== '=');
  chars[index] = chars[index] === 'A' ? 'B' : 'A';
  return chars.join('');
}
