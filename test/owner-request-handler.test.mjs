import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerAssistantHandler, reply, withOwnerRequest } from '../lib/server/owner-assistant-handler.mjs';
import { createOwnerSettingsHandlers } from '../lib/server/owner-settings-handler.mjs';

const origin = 'https://demo.example';

function fixture(options = {}) {
  const calls = [];
  const deps = {
    env: { APP_ORIGIN: origin, OWNER_ASSISTANT_ENABLED: 'true', ...options.env },
    ownerLoginEnabled() { calls.push('configuration'); return options.login !== false; },
    getSessionClient() {
      calls.push('session');
      if (options.session === 'unavailable') return null;
      return {
        auth: { async getUser() {
          calls.push('user');
          if (options.session === 'error') throw new Error('private auth details');
          return { data: { user: options.session === 'none' ? null : { id: 'owner-id' } } };
        } },
        from(table) {
          calls.push('membership');
          assert.equal(table, 'owner_memberships');
          return { select: () => ({ eq: () => ({ maybeSingle: async () => {
            if (options.member === 'error') throw new Error('private membership details');
            return { data: options.member === false ? null : { user_id: 'owner-id' } };
          } }) }) };
        },
      };
    },
    loadSettings() { calls.push('settings'); throw new Error('unexpected settings access'); },
    createStore() { calls.push('store'); throw new Error('unexpected store access'); },
    callProvider() { calls.push('provider'); throw new Error('unexpected provider access'); },
  };
  return { calls, deps };
}

function request(method, headers = {}, body = '{}') {
  return new Request(`${origin}/api/owner/assistant`, {
    method,
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : body,
  });
}

async function verify(response, status, error) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error });
}

const afterConfig = ['configuration'];
const afterSession = [...afterConfig, 'session', 'user'];
const afterOwner = [...afterSession, 'membership'];
const cases = [
  [{ env: { OWNER_ASSISTANT_ENABLED: 'false' } }, { origin: 'null' }, 503, 'not_configured', []],
  [{ login: false }, {}, 503, 'not_configured', afterConfig],
  [{ env: { APP_ORIGIN: '' } }, {}, 403, 'rejected', afterConfig],
  [{}, { origin: 'https://other.example', 'content-length': '10000' }, 403, 'rejected', afterConfig],
  [{}, { origin: '' }, 403, 'rejected', afterConfig],
  [{}, { 'content-type': 'application/json-extra' }, 403, 'rejected', afterConfig],
  [{}, { 'content-type': '' }, 403, 'rejected', afterConfig],
  [{ session: 'none' }, { 'content-length': '8193' }, 413, 'too_large', afterConfig],
  [{ session: 'unavailable' }, {}, 401, 'sign_in', [...afterConfig, 'session']],
  [{ session: 'none' }, {}, 401, 'sign_in', afterSession],
  [{ session: 'error' }, {}, 401, 'sign_in', afterSession],
  [{ member: false }, {}, 403, 'not_authorized', afterOwner],
  [{ member: 'error' }, {}, 403, 'not_authorized', afterOwner],
];

for (const [name, method, createHandler] of [
  ['assistant', 'POST', createOwnerAssistantHandler],
  ['settings read', 'GET', deps => createOwnerSettingsHandlers(deps).GET],
  ['settings save', 'PUT', deps => createOwnerSettingsHandlers(deps).PUT],
  ['secret', 'POST', deps => createOwnerSettingsHandlers(deps).POST_SECRET],
  ['test', 'POST', deps => createOwnerSettingsHandlers(deps).POST_TEST],
]) {
  test(`${name} enforces the guard order and never reaches business logic on rejection`, async () => {
    for (const [options, headers, status, error, expectedCalls] of cases) {
      const { deps, calls } = fixture(options);
      // Malformed JSON must not move input validation ahead of auth or size guards.
      await verify(await createHandler(deps)(request(method, headers, '{')), status, error);
      assert.deepEqual(calls, expectedCalls);
    }
    if (method !== 'GET') {
      const { deps, calls } = fixture({ session: 'none' });
      await verify(await createHandler(deps)(request(method, { 'content-length': '1' }, 'é'.repeat(4097))), 413, 'too_large');
      assert.deepEqual(calls, afterConfig);
    }
  });
}

test('actual limit is inclusive; invalid UTF-8 is rejected after owner authorization', async () => {
  const { deps, calls } = fixture();
  const handle = withOwnerRequest(deps, ({ input }) => reply({ input }));
  const exact = await handle(request('POST', { 'content-type': 'application/json; charset=utf-8' }, '{}'.padEnd(8192)));
  assert.equal(exact.status, 200);
  assert.deepEqual(await exact.json(), { input: {} });
  assert.deepEqual(calls, afterOwner);
  await verify(await handle(request('POST', {}, new Uint8Array([0xff]))), 400, 'invalid');
  assert.deepEqual(calls, [...afterOwner, ...afterOwner]);
});
