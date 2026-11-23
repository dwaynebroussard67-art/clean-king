import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createKeyring, generateOrgKey, wrapDek } from '../lib/server/envelope-vault.mjs';
import { storeSensitiveItem, revealSensitiveItem, deleteSensitiveItem } from '../lib/server/onboarding-sensitive.mjs';

const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const ring = () => createKeyring({ current: 1, keys: { 1: randomBytes(32) } });

async function buildStoreRpc(keyring) {
  const { dek, wrapped, kekVersion } = generateOrgKey(ORG, keyring);
  const rpcCalls = [];
  const rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === 'get_org_data_key') return [{ wrapped_dek: wrapped, kek_version: kekVersion, version: 1 }];
    if (name === 'store_sensitive_item') return 'item-uuid-123';
    if (name === 'vault_reveal') return [{ ciphertext: 'v2.1.AAAA.AAAA.AAAA', subject_key: 'owner', field_key: 'owner_ssn' }];
    if (name === 'vault_delete') return [{ ok: true }];
    return null;
  };
  return { rpc, rpcCalls, dek };
}

test('storeSensitiveItem calls storeAsOwner via RPC and returns id + mask', async () => {
  const keyring = ring();
  const { rpc, rpcCalls } = await buildStoreRpc(keyring);

  const result = await storeSensitiveItem({
    rpc, keyring, orgId: ORG, actorId: ACTOR,
    subjectKey: 'owner', fieldKey: 'owner_ssn', value: '123-45-6789',
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, 'item-uuid-123');
  assert.equal(result.mask, '•••-••-6789');
  // RPC call should not include plaintext
  const storeCall = rpcCalls.find((c) => c.name === 'store_sensitive_item');
  assert.ok(storeCall);
  assert.ok(!JSON.stringify(storeCall.args).includes('123-45-6789'));
});

test('revealSensitiveItem requires step-up within 5 minutes', async () => {
  const keyring = ring();
  const { rpc, now } = await buildStoreRpc(keyring);
  const baseTime = 1_000_000_000_000;

  // Stale step-up (more than 5 min)
  const stale = await revealSensitiveItem({
    rpc, keyring, orgId: ORG, actorId: ACTOR, itemId: ITEM_ID,
    reason: 'bonding application', stepUpAt: baseTime - 10 * 60_000, now: () => baseTime,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'step_up_required');

  // Missing step-up
  const missing = await revealSensitiveItem({
    rpc, keyring, orgId: ORG, actorId: ACTOR, itemId: ITEM_ID,
    reason: 'bonding application', stepUpAt: undefined, now: () => baseTime,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'step_up_required');
});

test('deleteSensitiveItem calls vault_delete RPC', async () => {
  const rpcCalls = [];
  const rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === 'vault_delete') return [{ ok: true }];
    return null;
  };

  const result = await deleteSensitiveItem({ rpc, orgId: ORG, actorId: ACTOR, itemId: ITEM_ID, reason: 'owner request' });
  assert.equal(result, true);
  assert.equal(rpcCalls[0].name, 'vault_delete');
  assert.equal(rpcCalls[0].args.p_org, ORG);
  assert.equal(rpcCalls[0].args.p_actor, ACTOR);
  assert.equal(rpcCalls[0].args.p_item, ITEM_ID);
});