import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { postLoginDestination, signedInDestination } from '../lib/auth-destination.mjs';

const USER = '11111111-1111-4111-8111-111111111111';

function clientFor({ owner = false, active = false, failOwner = false, failEmployee = false } = {}) {
  return {
    from(table) {
      return {
        select() { return this; },
        eq(_field, value) {
          assert.equal(value, USER);
          return this;
        },
        async maybeSingle() {
          if (table === 'owner_memberships') {
            return { data: owner ? { user_id: USER } : null, error: failOwner ? new Error('db') : null };
          }
          return { data: active ? { active: true } : null, error: failEmployee ? new Error('db') : null };
        },
      };
    },
  };
}

test('post-login destination is determined by membership role', () => {
  assert.equal(postLoginDestination({ isOwner: true, activeEmployee: true }), '/owner');
  assert.equal(postLoginDestination({ isOwner: false, activeEmployee: true }), '/crew/referrals');
  assert.equal(postLoginDestination({ isOwner: false, activeEmployee: false }), '/not-approved');
});

test('server membership checks send owners, active employees and all others to fixed routes', async () => {
  assert.equal(await signedInDestination(clientFor({ owner: true, active: true }), USER), '/owner');
  assert.equal(await signedInDestination(clientFor({ active: true }), USER), '/crew/referrals');
  assert.equal(await signedInDestination(clientFor(), USER), '/not-approved');
  assert.equal(await signedInDestination(clientFor({ failOwner: true, active: true }), USER), '/not-approved');
  assert.equal(await signedInDestination(null, USER), '/not-approved');
});

test('callback ignores user-supplied redirect targets', async () => {
  const source = await readFile(new URL('../app/owner/auth/callback/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /searchParams\.get\(['"]next['"]\)/);
  assert.match(source, /signedInDestination\(client, data\.user\.id\)/);
});
