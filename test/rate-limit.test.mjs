import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitCheck, rateLimitConsume, rateLimitClear } from '../lib/server/rate-limit.mjs';

const TENANT = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';

test('rateLimitCheck allows requests within the limit', () => {
  rateLimitClear();
  let now = 1_000_000_000_000;
  for (let i = 0; i < 5; i++) {
    const r = rateLimitCheck(TENANT, 'sensitive_store', { max: 10, now: () => now });
    assert.equal(r.ok, true);
    assert.equal(r.remaining, 10 - (i + 1));
  }
});

test('rateLimitCheck rejects requests beyond the limit', () => {
  rateLimitClear();
  let now = 1_000_000_000_000;
  for (let i = 0; i < 10; i++) {
    const r = rateLimitCheck(TENANT, 'sensitive_store', { max: 10, now: () => now });
    assert.equal(r.ok, true);
  }
  const blocked = rateLimitCheck(TENANT, 'sensitive_store', { max: 10, now: () => now });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
});

test('rateLimitCheck resets after the window expires', () => {
  rateLimitClear();
  let now = 1_000_000_000_000;
  // Exhaust the limit
  for (let i = 0; i < 3; i++) {
    rateLimitCheck(TENANT, 'sensitive_store', { max: 3, now: () => now });
  }
  assert.equal(rateLimitCheck(TENANT, 'sensitive_store', { max: 3, now: () => now }).ok, false);
  // Advance past the window
  now += 61_000;
  assert.equal(rateLimitCheck(TENANT, 'sensitive_store', { max: 3, now: () => now }).ok, true);
});

test('rateLimitCheck is per-tenant and per-action', () => {
  rateLimitClear();
  let now = 1_000_000_000_000;
  // Exhaust tenant A's 'reveal' limit
  rateLimitCheck('tenant-a', 'reveal', { max: 1, now: () => now });
  assert.equal(rateLimitCheck('tenant-a', 'reveal', { max: 1, now: () => now }).ok, false);
  // Tenant B can still reveal
  assert.equal(rateLimitCheck('tenant-b', 'reveal', { max: 1, now: () => now }).ok, true);
  // Tenant A can still do a different action
  assert.equal(rateLimitCheck('tenant-a', 'sensitive_store', { max: 1, now: () => now }).ok, true);
});

test('rateLimitConsume increments the counter', () => {
  rateLimitClear();
  let now = 1_000_000_000_000;
  rateLimitCheck(TENANT, 'reveal', { max: 5, now: () => now });
  rateLimitConsume(TENANT, 'reveal', { now: () => now });
  const r = rateLimitCheck(TENANT, 'reveal', { max: 5, now: () => now });
  assert.equal(r.remaining, 2);
  // After check: count=1. After consume: count=2. After next check: count=3, remaining=5-3=2
});

test('rateLimitClear resets all state', () => {
  rateLimitClear();
  let now = 1_000_000_000_000;
  rateLimitCheck(TENANT, 'sensitive_store', { max: 1, now: () => now });
  assert.equal(rateLimitCheck(TENANT, 'sensitive_store', { max: 1, now: () => now }).ok, false);
  rateLimitClear();
  assert.equal(rateLimitCheck(TENANT, 'sensitive_store', { max: 1, now: () => now }).ok, true);
});