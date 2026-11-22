import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertOnboardingItems, confirmOnboardingItems } from '../lib/server/onboarding-items.mjs';

const TENANT = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ACTOR = '11111111-1111-4111-8111-111111111111';

test('upsertOnboardingItems calls RPC with tenant, actor, items', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    return [{ ok: true, count: 3 }];
  };

  const items = [
    { field_key: 'business_dba', value: 'Maid Kings of Baton Rouge' },
    { field_key: 'business_phone', value: '337-555-0101' },
  ];

  const count = await upsertOnboardingItems({ rpc, tenantId: TENANT, actorId: ACTOR, items });
  assert.equal(count, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'upsert_onboarding_items');
  assert.equal(calls[0].args.p_org, TENANT);
  assert.equal(calls[0].args.p_actor, ACTOR);
  assert.equal(calls[0].args.p_source, 'owner_dashboard');
  assert.deepEqual(calls[0].args.p_items, items);
});

test('confirmOnboardingItems calls RPC with optional field_keys', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    return [{ count: 2 }];
  };

  const count = await confirmOnboardingItems({ rpc, fieldKeys: ['business_dba', 'business_phone'] });
  assert.equal(count, 2);
  assert.equal(calls[0].name, 'confirm_onboarding_items');
  assert.deepEqual(calls[0].args.p_field_keys, ['business_dba', 'business_phone']);
});

test('confirmOnboardingItems works without field_keys', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    return [{ count: 0 }];
  };

  const count = await confirmOnboardingItems({ rpc });
  assert.equal(count, 0);
  assert.equal(calls[0].args.p_field_keys, undefined);
});

test('upsertOnboardingItems returns 0 for empty result', async () => {
  const rpc = async () => [];
  const count = await upsertOnboardingItems({ rpc, tenantId: TENANT, actorId: ACTOR, items: [] });
  assert.equal(count, 0);
});