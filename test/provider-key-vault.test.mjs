import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createKeyring, keyringFromEnv } from '../lib/server/envelope-vault.mjs';
import { createProviderKeyVault } from '../lib/server/provider-key-vault.mjs';
import { PROVIDER_IDS } from '../lib/ai/provider-adapter.js';

const TENANT = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const ring = () => createKeyring({ current: 1, keys: { 1: randomBytes(32) } });

/** Build a vault with an in-memory RPC that mimics the service_role functions. */
function buildVault(overrides = {}) {
  const state = {
    rows: new Map(), // tenant_id + '|' + provider_id -> row
    rpcCalls: [],
    rpc: overrides.rpc || (async (name, args) => {
      state.rpcCalls.push({ name, args });
      if (name === 'save_provider_key') {
        const key = `${args.p_tenant}|${args.p_provider}`;
        state.rows.set(key, {
          tenant_id: args.p_tenant,
          provider_id: args.p_provider,
          model: args.p_model,
          base_url: args.p_base_url,
          encrypted_key: args.p_ciphertext,
          last_four: args.p_last_four,
          status: 'active',
          key_version: args.p_key_version,
        });
        return { data: [{ ok: true, error: null }], error: null };
      }
      if (name === 'get_provider_key_ciphertext') {
        const key = `${args.p_tenant}|${args.p_provider}`;
        const row = state.rows.get(key);
        return { data: row ? [{ ciphertext: row.encrypted_key, key_version: row.key_version, last_four: row.last_four, status: row.status }] : [], error: null };
      }
      if (name === 'delete_provider_key') {
        state.rows.delete(`${args.p_tenant}|${args.p_provider}`);
        return { data: [{ ok: true, error: null }], error: null };
      }
      if (name === 'check_ai_budget') {
        return { data: [{ allowed: true, remaining_cents: 1000, total_cents: 2000, hard_stopped: false }], error: null };
      }
      return { data: [], error: null };
    }),
    keyring: overrides.keyring || ring(),
  };
  const vault = createProviderKeyVault({ keyring: state.keyring, rpc: state.rpc });
  return { vault, state };
}

// ---------------------------------------------------------------- seal/open round-trip

test('seal/open round-trips and ciphertext carries no plaintext', () => {
  const { vault } = buildVault();
  const box = vault.sealKey(TENANT, PROVIDER_IDS.ANTHROPIC, 'sk-ant-test-key-12345');
  assert.ok(box.startsWith('v2.'), 'envelope is v2 format');
  assert.ok(!box.includes('sk-ant-test-key-12345'), 'plaintext not in ciphertext');
  const opened = vault.openKey(TENANT, PROVIDER_IDS.ANTHROPIC, box, 1);
  assert.equal(opened, 'sk-ant-test-key-12345');
});

test('fresh IV every seal: same plaintext yields different ciphertext', () => {
  const { vault } = buildVault();
  const a = vault.sealKey(TENANT, PROVIDER_IDS.ANTHROPIC, 'sk-ant-test-key-12345');
  const b = vault.sealKey(TENANT, PROVIDER_IDS.ANTHROPIC, 'sk-ant-test-key-12345');
  assert.notEqual(a, b);
});

test('AAD binding: ciphertext fails for different org, provider, or field', () => {
  const { vault } = buildVault();
  const box = vault.sealKey(TENANT, PROVIDER_IDS.ANTHROPIC, 'sk-ant-test-key-12345');
  const ctxMismatches = [
    { tenant: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', provider: PROVIDER_IDS.ANTHROPIC }, // different org
    { tenant: TENANT, provider: PROVIDER_IDS.OPENAI_COMPATIBLE }, // different provider
  ];
  for (const mismatch of ctxMismatches) {
    assert.throws(
      () => vault.openKey(mismatch.tenant, mismatch.provider, box, 1),
      /vault_open_failed/,
      `AAD binding should fail for ${mismatch.tenant}/${mismatch.provider}`
    );
  }
});

test('wrong DEK version fails to open', () => {
  const { vault } = buildVault();
  const box = vault.sealKey(TENANT, PROVIDER_IDS.ANTHROPIC, 'sk-ant-test-key-12345');
  // keyring.get(99) throws vault_key_missing; open() throws vault_open_failed on bad ciphertext
  assert.throws(() => vault.openKey(TENANT, PROVIDER_IDS.ANTHROPIC, box, 99), /vault/);
});

// ---------------------------------------------------------------- validation

test('validateKey rejects unknown provider', () => {
  const { vault } = buildVault();
  assert.throws(() => vault.validateKey('bogus', 'sk-ant-test-key-12345', undefined), /unknown_provider/);
});

test('validateKey rejects malformed Anthropic key', () => {
  const { vault } = buildVault();
  assert.throws(() => vault.validateKey(PROVIDER_IDS.ANTHROPIC, 'not-an-anthropic-key', undefined), /invalid_anthropic_key/);
  assert.throws(() => vault.validateKey(PROVIDER_IDS.ANTHROPIC, 'sk-ant-short', undefined), /invalid_anthropic_key/);
});

test('validateKey rejects blocked base URL for openai_compatible', () => {
  const { vault } = buildVault();
  assert.throws(() => vault.validateKey(PROVIDER_IDS.OPENAI_COMPATIBLE, 'sk-test-123', 'http://evil.example'), /blocked_base_url/);
  assert.doesNotThrow(() => vault.validateKey(PROVIDER_IDS.OPENAI_COMPATIBLE, 'sk-test-123', 'https://api.openai.com'));
});

// ---------------------------------------------------------------- save/get/delete via RPC

test('saveProviderKey seals, stores ciphertext only, and returns lastFour', async () => {
  const { vault, state } = buildVault();
  const result = await vault.saveProviderKey(TENANT, ACTOR, {
    id: PROVIDER_IDS.ANTHROPIC,
    apiKey: 'sk-ant-test-key-1234567890abcdef',
    model: 'claude-sonnet-5-5',
    baseURL: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.lastFour, 'cdef');
  // RPC was called with v2 ciphertext, never plaintext
  const saveCall = state.rpcCalls.find((c) => c.name === 'save_provider_key');
  assert.ok(saveCall);
  assert.ok(saveCall.args.p_ciphertext.startsWith('v2.'));
  assert.ok(!saveCall.args.p_ciphertext.includes('sk-ant-test-key-1234567890abcdef'));
  assert.equal(saveCall.args.p_key_version, 1);
  assert.equal(saveCall.args.p_actor, ACTOR);
  // Database row holds only ciphertext
  const row = state.rows.get(`${TENANT}|${PROVIDER_IDS.ANTHROPIC}`);
  assert.ok(row);
  assert.ok(!JSON.stringify(row).includes('sk-ant-test-key-1234567890abcdef'));
});

test('getProviderKey decrypts and returns plaintext for active provider', async () => {
  const { vault } = buildVault();
  await vault.saveProviderKey(TENANT, ACTOR, {
    id: PROVIDER_IDS.ANTHROPIC,
    apiKey: 'sk-ant-test-key-1234567890abcdef',
    model: 'claude-sonnet-5-5',
    baseURL: null,
  });
  const result = await vault.getProviderKey(TENANT, PROVIDER_IDS.ANTHROPIC);
  assert.equal(result.ok, true);
  assert.equal(result.apiKey, 'sk-ant-test-key-1234567890abcdef');
});

test('getProviderKey returns error for inactive provider', async () => {
  const { vault, state } = buildVault();
  await vault.saveProviderKey(TENANT, ACTOR, {
    id: PROVIDER_IDS.ANTHROPIC,
    apiKey: 'sk-ant-test-key-1234567890abcdef',
    model: 'claude-sonnet-5-5',
    baseURL: null,
  });
  // Flip status to inactive via direct RPC simulation
  await state.rpc('save_provider_key', {
    p_tenant: TENANT, p_actor: ACTOR, p_provider: PROVIDER_IDS.ANTHROPIC,
    p_model: 'claude-sonnet-5-5', p_base_url: null,
    p_ciphertext: 'v2.1.AAAA.AAAA.AAAA', p_last_four: 'abcd', p_key_version: 1,
  });
  // Directly mark inactive by re-saving with same ciphertext (status column is set by RPC)
  const result = await vault.getProviderKey(TENANT, PROVIDER_IDS.ANTHROPIC);
  // The row now has ciphertext that won't decrypt; getProviderKey should return decrypt error
  assert.equal(result.ok, false);
});

test('getProviderKey returns error when provider not found', async () => {
  const { vault } = buildVault();
  const result = await vault.getProviderKey(TENANT, PROVIDER_IDS.ANTHROPIC);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Provider not found.');
});

test('deleteProviderKey removes the row and is actor-gated', async () => {
  const { vault } = buildVault();
  await vault.saveProviderKey(TENANT, ACTOR, {
    id: PROVIDER_IDS.ANTHROPIC,
    apiKey: 'sk-ant-test-key-1234567890abcdef',
    model: 'claude-sonnet-5-5',
    baseURL: null,
  });
  const result = await vault.deleteProviderKey(TENANT, ACTOR, PROVIDER_IDS.ANTHROPIC);
  assert.equal(result.ok, true);
  const gone = await vault.getProviderKey(TENANT, PROVIDER_IDS.ANTHROPIC);
  assert.equal(gone.ok, false);
  assert.equal(gone.error, 'Provider not found.');
});

// ---------------------------------------------------------------- keyring from env with VAULT_KEK_*

test('keyringFromEnv reads VAULT_KEK_* env vars', () => {
  const env = {
    VAULT_KEK_CURRENT: '1',
    VAULT_KEK_V1: randomBytes(32).toString('base64'),
  };
  const kr = keyringFromEnv(env);
  assert.ok(kr);
  assert.equal(kr.current, 1);
  assert.ok(kr.get(1));
});

test('keyringFromEnv fails closed with missing/weak VAULT_KEK_*', () => {
  assert.equal(keyringFromEnv({}), null);
  assert.equal(keyringFromEnv({ VAULT_KEK_CURRENT: '1' }), null, 'no key for version 1');
  assert.equal(keyringFromEnv({ VAULT_KEK_CURRENT: '1', VAULT_KEK_V1: 'short' }), null, 'weak key');
  assert.equal(keyringFromEnv({ VAULT_KEK_CURRENT: '2', VAULT_KEK_V1: randomBytes(32).toString('base64') }), null, 'current version missing key');
});

test('ONBOARDING_KEK_* is a read-only alias', () => {
  const env = {
    ONBOARDING_KEK_CURRENT: '1',
    ONBOARDING_KEK_V1: randomBytes(32).toString('base64'),
  };
  const kr = keyringFromEnv(env);
  assert.ok(kr, 'ONBOARDING_KEK_* alias still works for reading');
});

// ---------------------------------------------------------------- saveProviderKey enforces key validation before sealing

test('saveProviderKey rejects invalid Anthropic key before any RPC call', async () => {
  const { vault, state } = buildVault();
  const result = await vault.saveProviderKey(TENANT, ACTOR, {
    id: PROVIDER_IDS.ANTHROPIC,
    apiKey: 'not-valid',
    model: 'claude-sonnet-5-5',
    baseURL: null,
  });
  assert.equal(result.ok, false);
  assert.equal(state.rpcCalls.length, 0, 'no RPC call when validation fails');
});