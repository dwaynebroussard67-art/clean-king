import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../lib/assistant-settings-schema.mjs';
import { createSettingsStore } from '../lib/server/assistant-settings-store.mjs';
import { decryptSecret } from '../lib/server/secret-box.mjs';

const KEY = Buffer.alloc(32, 21).toString('base64');
const response = (data) => ({ data, error: null });

function fixture(replies, secretKey = KEY) {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      assert.ok(replies.length, 'unexpected RPC');
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { calls, store: createSettingsStore({ client, secretKey }) };
}

test('an empty table yields fresh disabled defaults and version zero', async () => {
  const { calls, store } = fixture([response([]), response([])]);
  const original = await store.load();
  assert.deepEqual(original, { settings: DEFAULT_SETTINGS, version: 0 });
  original.settings.persona.name = 'Edited';
  assert.deepEqual(await store.load(), { settings: DEFAULT_SETTINGS, version: 0 });
  assert.deepEqual(calls, Array.from({ length: 2 }, () => ({ name: 'get_assistant_settings', args: {} })));
});

test('save normalizes settings and passes through SQL version and result', async () => {
  const { calls, store } = fixture([
    response([{ result: 'ok', version: 1 }]),
    response([{ result: 'conflict', version: 1 }]),
    response([{ result: 'invalid', version: 1 }]),
    response([{ settings: DEFAULT_SETTINGS, version: 1 }]),
    response([{ settings: DEFAULT_SETTINGS, version: 1 }]),
  ]);
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.persona.name = ' Sparkle ';
  assert.deepEqual(await store.save(settings, 0), { result: 'ok', version: 1 });
  assert.deepEqual(await store.save(settings, 0), { result: 'conflict', version: 1 });
  assert.deepEqual(await store.save(settings, 1), { result: 'invalid', version: 1 });
  assert.deepEqual(await store.save({ enabled: true }, 1), { result: 'invalid', version: 1 });
  assert.deepEqual(await store.load(), { settings: DEFAULT_SETTINGS, version: 1 });
  assert.deepEqual(calls, [0, 0, 1].map((version) => ({
    name: 'save_assistant_settings', args: { p_settings: DEFAULT_SETTINGS, p_expected_version: version },
  })).concat(Array.from({ length: 2 }, () => ({ name: 'get_assistant_settings', args: {} }))));
});

test('secret write sends only an encrypted box and suffix; status sends neither plaintext nor box', async () => {
  const replies = [response(true)];
  const { calls, store } = fixture(replies);
  const plaintext = 'synthetic-provider-key-57QF';
  assert.equal(await store.setSecret('anthropic', plaintext), true);
  const [{ name, args }] = calls;
  assert.equal(name, 'set_assistant_secret');
  assert.deepEqual(Object.keys(args).sort(), ['p_ciphertext', 'p_last4', 'p_name']);
  assert.equal(args.p_name, 'anthropic');
  assert.equal(args.p_last4, '57QF');
  assert.ok(!JSON.stringify(args).includes(plaintext));
  assert.equal(decryptSecret(args.p_ciphertext, KEY), plaintext);

  const row = { ciphertext: args.p_ciphertext, last4: args.p_last4 };
  replies.push(response([row]), response([]), response([row]), response(true), response([]));
  assert.deepEqual(await store.secretStatus(), {
    anthropic: { set: true, last4: '57QF' }, custom: { set: false, last4: null },
  });
  assert.equal(await store.getSecretPlain('anthropic'), plaintext);
  assert.equal(await store.clearSecret('anthropic'), true);
  assert.equal(await store.getSecretPlain('anthropic'), null);
  assert.deepEqual(calls.slice(1), [
    { name: 'get_assistant_secret', args: { p_name: 'anthropic' } },
    { name: 'get_assistant_secret', args: { p_name: 'custom' } },
    { name: 'get_assistant_secret', args: { p_name: 'anthropic' } },
    { name: 'clear_assistant_secret', args: { p_name: 'anthropic' } },
    { name: 'get_assistant_secret', args: { p_name: 'anthropic' } },
  ]);
});

test('missing encryption blocks plaintext access but not status or deletion', async () => {
  const { calls, store } = fixture([response([]), response([]), response(true)], 'not-base64');
  await assert.rejects(store.setSecret('custom', 'synthetic-secret'), { message: 'encryption_not_ready' });
  await assert.rejects(store.getSecretPlain('custom'), { message: 'encryption_not_ready' });
  assert.deepEqual(calls, []);
  assert.deepEqual(await store.secretStatus(), {
    anthropic: { set: false, last4: null }, custom: { set: false, last4: null },
  });
  assert.equal(await store.clearSecret('custom'), true);
});

test('read failures are not treated as missing settings or missing credentials', async () => {
  const { store } = fixture([
    response([{ settings: { enabled: true }, version: 1 }]),
    { data: null, error: { message: 'sensitive database detail' } },
    new Error('sensitive network detail'),
    response([{ ciphertext: 'bad-envelope', last4: 'abcd' }]),
  ]);
  for (const operation of [store.load, store.load, () => store.clearSecret('custom')]) {
    await assert.rejects(operation(), (error) => {
      assert.equal(error.message, 'settings_store_failed');
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  await assert.rejects(store.getSecretPlain('custom'), { message: 'secret_decrypt_failed' });
});
