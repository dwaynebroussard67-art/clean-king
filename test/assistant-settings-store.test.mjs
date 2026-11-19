import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../lib/assistant-settings-schema.mjs';
import { createSettingsStore } from '../lib/server/assistant-settings-store.mjs';

const key = Buffer.alloc(32, 4).toString('base64');
const ownerId = '11111111-1111-4111-8111-111111111111';

function fakeClient() {
  const state = { settings: null, version: 0, secrets: new Map(), audit: [] };
  return {
    state,
    async rpc(name, args = {}) {
      if (args.p_owner_id !== ownerId) return { data: null, error: new Error('not owner') };
      if (name === 'get_assistant_settings') {
        return { data: state.settings ? [{ settings: state.settings, version: state.version }] : [], error: null };
      }
      if (name === 'save_assistant_settings') {
        if (args.p_expected_version !== state.version) {
          return { data: [{ result: 'conflict', version: state.version }], error: null };
        }
        state.settings = args.p_settings;
        state.version += 1;
        state.audit.push({ action: 'settings_saved' });
        return { data: [{ result: 'ok', version: state.version }], error: null };
      }
      if (name === 'get_assistant_secret') {
        const secret = state.secrets.get(args.p_name);
        return { data: secret ? [secret] : [], error: null };
      }
      if (name === 'set_assistant_secret') {
        state.secrets.set(args.p_name, { ciphertext: args.p_ciphertext, last4: args.p_last4 });
        state.audit.push({ action: 'secret_set', name: args.p_name });
        return { data: true, error: null };
      }
      if (name === 'clear_assistant_secret') {
        const removed = state.secrets.delete(args.p_name);
        if (removed) state.audit.push({ action: 'secret_cleared', name: args.p_name });
        return { data: removed, error: null };
      }
      return { data: null, error: new Error('unknown rpc') };
    },
  };
}

test('settings store defaults, saves optimistically, and reports conflicts', async () => {
  const client = fakeClient();
  const store = createSettingsStore({ client, secretKey: key, ownerId });
  assert.deepEqual(await store.load(), { settings: DEFAULT_SETTINGS, version: 0 });
  const updated = structuredClone(DEFAULT_SETTINGS);
  updated.enabled = true;
  assert.deepEqual(await store.save(updated, 0), { result: 'ok', version: 1 });
  assert.deepEqual(await store.save(updated, 0), { result: 'conflict', version: 1 });
  assert.deepEqual((await store.load()).settings, updated);
});

test('store encrypts secret values and returns only status to the caller', async () => {
  const client = fakeClient();
  const store = createSettingsStore({ client, secretKey: key, ownerId });
  assert.equal(await store.setSecret('anthropic', 'anthropic-test-key-1234'), true);
  const row = client.state.secrets.get('anthropic');
  assert.match(row.ciphertext, /^v1:/);
  assert.equal(row.last4, '1234');
  assert.doesNotMatch(JSON.stringify(client.state), /anthropic-test-key-1234/);
  assert.deepEqual(await store.secretStatus(), {
    anthropic: { set: true, last4: '1234' },
    custom: { set: false, last4: null },
  });
  assert.equal(await store.getSecretPlain('anthropic'), 'anthropic-test-key-1234');
  assert.equal(await store.clearSecret('anthropic'), true);
  assert.equal(await store.getSecretPlain('anthropic'), null);
});

test('secret writes and reads fail closed when encryption is unavailable', async () => {
  const store = createSettingsStore({ client: fakeClient(), secretKey: 'bad', ownerId });
  await assert.rejects(store.setSecret('custom', 'custom-key-1234'), { message: 'encryption_not_ready' });
  await assert.rejects(store.getSecretPlain('custom'), { message: 'encryption_not_ready' });
});
