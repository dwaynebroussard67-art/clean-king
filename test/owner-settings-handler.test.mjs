import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerSettingsHandlers } from '../lib/server/owner-settings-handler.mjs';

const origin = 'https://demo.example';
const dbKey = 'mock-db-key-1234';
const envKey = 'mock-env-key-5678';
const encryptionKey = 'mock-encryption-key';
const defaults = {
  version: 1, enabled: false,
  persona: { name: 'Sparkle', ownerName: 'Andy', tone: 'bubbly', emoji: 'light', length: 'short' },
  voice: { speakReplies: false, rate: 1, pitch: 1, voiceName: null },
  capabilities: { counts: true, emailHealth: true },
  provider: { active: 'anthropic', anthropicModel: 'claude-sonnet-5-5', customBaseUrl: '', customModel: '', fallbackToCustom: false },
  limits: { perMinute: 3, perMonth: 100, maxOutputTokens: 400, temperature: 0.4 },
};
const empty = { set: false, last4: null };
const emptySecrets = { anthropic: empty, custom: empty };

function fixture(options = {}) {
  const calls = { store: 0, saved: [], secrets: [], changes: [], providers: [], quota: [], finished: [], validator: [] };
  const keys = { ...options.keys };
  const settings = { ...defaults, provider: { ...defaults.provider, ...options.provider } };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-id' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: 'owner-id' } }) }) }) }),
  };
  const store = {
    async load() {
      if (options.loadError) throw new Error(encryptionKey);
      return { settings, version: options.version ?? 0 };
    },
    async save(value, expectedVersion) {
      calls.saved.push([value, expectedVersion]);
      return options.saveResult ?? { result: 'ok', version: 1 };
    },
    async secretStatus() {
      return options.status ?? Object.fromEntries(['anthropic', 'custom'].map(name => [name, keys[name]
        ? { set: true, last4: keys[name].slice(-4), extra: keys[name] } : empty]));
    },
    async getSecretPlain(name) {
      calls.secrets.push(name);
      if (options.decryptError) throw new Error(options.decryptError);
      return keys[name] ?? null;
    },
    async setSecret(name, value) {
      calls.changes.push(['set', name, value]);
      if (options.writeError) throw new Error(options.writeError);
      keys[name] = value;
      return true;
    },
    async clearSecret(name) {
      calls.changes.push(['clear', name]);
      const wasSet = Object.hasOwn(keys, name);
      delete keys[name];
      return wasSet;
    },
  };
  const handlers = createOwnerSettingsHandlers({
    env: { APP_ORIGIN: origin, OWNER_ASSISTANT_ENABLED: 'true', ASSISTANT_SECRET_KEY: encryptionKey, ANTHROPIC_API_KEY: envKey },
    ownerLoginEnabled: () => true,
    getSessionClient: async () => client,
    createStore: session => { assert.equal(session, client); calls.store += 1; return store; },
    secretKeyValid: key => { assert.equal(key, encryptionKey); return options.ready !== false; },
    parseSettings: value => options.parsed ?? { ok: true, value },
    validateCustomBaseUrl: (url, opts) => {
      calls.validator.push([url, opts]);
      return options.blocked ? { ok: false, reason: keys.custom } : { ok: true, url: url.replace(/\/$/, '') };
    },
    beginRun: async limits => {
      calls.quota.push(limits);
      return options.run ?? { run_id: 'run-id', result: 'ok' };
    },
    finishRun: async (id, success) => { calls.finished.push([id, success]); },
    callProvider: async request => {
      calls.providers.push(request);
      if (options.errorCode) throw Object.assign(new Error(dbKey), { code: options.errorCode });
      return { text: 'OK', model: dbKey };
    },
  });
  function send(handler, body, { raw = false } = {}) {
    const method = handler.startsWith('POST') ? 'POST' : handler;
    return handlers[handler](new Request(`${origin}/api/owner/assistant/settings`, {
      method, headers: { origin, 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : raw ? body : JSON.stringify(body),
    }));
  }
  return { send, calls };
}

async function check(response, status, expected) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  if (expected !== undefined) assert.deepEqual(body, expected);
  return body;
}

const invalid = (...paths) => ({ error: 'invalid', errors: paths.map(path => ({ path, message: 'invalid' })) });

test('settings load returns defaults and write-only metadata, even with encryption unavailable', async () => {
  const { send, calls } = fixture({
    ready: false,
    status: { anthropic: { set: true, last4: '1234', ciphertext: dbKey }, custom: { set: true, last4: dbKey }, extra: dbKey },
  });
  await check(await send('GET'), 200, {
    settings: defaults, version: 0, encryptionReady: false,
    secrets: { anthropic: { set: true, last4: '1234' }, custom: { set: true, last4: null } },
  });
  assert.deepEqual(calls.secrets, []);
  const unset = fixture();
  await check(await unset.send('GET'), 200, { settings: defaults, version: 0, encryptionReady: true, secrets: emptySecrets });
  const broken = fixture({ loadError: true });
  await check(await broken.send('GET'), 503, { error: 'not_configured' });
});

test('settings save is optimistic and sends canonical validated settings to the store', async () => {
  const changes = { ...defaults, enabled: true, persona: { ...defaults.persona, name: ' Brillo ' } };
  const canonical = { ...changes, persona: { ...changes.persona, name: 'Brillo' } };
  const ok = fixture({ parsed: { ok: true, value: canonical } });
  await check(await ok.send('PUT', { settings: changes, expectedVersion: 0 }), 200, { settings: canonical, version: 1 });
  assert.deepEqual(ok.calls.saved, [[canonical, 0]]);

  const conflict = fixture({ saveResult: { result: 'conflict', version: 2 } });
  await check(await conflict.send('PUT', { settings: changes, expectedVersion: 1 }), 409, { error: 'conflict' });
  const dbInvalid = fixture({ saveResult: { result: 'invalid', version: 0 } });
  await check(await dbInvalid.send('PUT', { settings: changes, expectedVersion: 0 }), 422, invalid('settings'));
});

test('settings save rejects bad envelopes, schema errors, and blocked custom URLs without echoing unsanitized errors', async () => {
  const bad = fixture({ parsed: { ok: false, errors: [
    { path: 'persona.name', message: `Unexpected ${dbKey}` }, { path: `persona.${dbKey}`, message: dbKey },
  ] } });
  for (const value of [null, { settings: defaults }, { settings: defaults, expectedVersion: 0, extra: true }]) {
    await check(await bad.send('PUT', value), 422, invalid('settings'));
  }
  for (const expectedVersion of ['1', 0.5, 2147483648]) {
    await check(await bad.send('PUT', { settings: defaults, expectedVersion }), 422, invalid('expectedVersion'));
  }
  await check(await bad.send('PUT', '{', { raw: true }), 422, invalid('settings'));
  await check(await bad.send('PUT', { settings: defaults, expectedVersion: 0 }), 422, invalid('persona.name', 'settings'));
  assert.deepEqual(bad.calls.saved, []);

  const blocked = fixture({ blocked: true });
  const customBaseUrl = 'https://blocked.example/v1';
  const settings = { ...defaults, provider: { ...defaults.provider, customBaseUrl } };
  await check(await blocked.send('PUT', { settings, expectedVersion: 0 }), 422, invalid('provider.customBaseUrl'));
  assert.deepEqual(blocked.calls.validator, [[customBaseUrl, { allowLocal: false }]]);
  assert.deepEqual(blocked.calls.saved, []);
});

test('writes and clears keys without returning plaintext, even when clearing twice', async () => {
  const { send, calls } = fixture();
  const secret = { name: 'custom', value: dbKey };
  await check(await send('POST_SECRET', secret), 200, { secrets: { anthropic: empty, custom: { set: true, last4: '1234' } } });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await check(await send('POST_SECRET', { name: 'custom', clear: true }), 200, { secrets: emptySecrets });
  }
  assert.deepEqual(calls.changes, [['set', 'custom', dbKey], ['clear', 'custom'], ['clear', 'custom']]);
  assert.deepEqual(calls.secrets, []);
});

test('secret endpoint rejects invalid shapes and unavailable encryption before writing', async () => {
  const { send, calls } = fixture({ ready: false });
  for (const value of [null, { name: 'other', value: dbKey }, { name: 'custom' }, { name: 'custom', value: 'short' },
    { name: 'custom', value: 'x'.repeat(401) }, { name: 'custom', clear: false }, { name: 'custom', value: dbKey, clear: true },
    { name: 'custom', value: dbKey, extra: true }]) {
    await check(await send('POST_SECRET', value), 400, { error: 'invalid' });
  }
  await check(await send('POST_SECRET', { name: 'anthropic', value: dbKey }), 503, { error: 'encryption_not_ready' });
  assert.equal(calls.store, 0);
  for (const writeError of ['encryption_not_ready', dbKey]) {
    const fail = fixture({ writeError });
    await check(await fail.send('POST_SECRET', { name: 'anthropic', value: dbKey }), 503, {
      error: writeError === 'encryption_not_ready' ? 'encryption_not_ready' : 'not_configured',
    });
  }
});

async function checkSuccessfulTest(response, provider = 'anthropic', model = 'claude-sonnet-5-5') {
  const { latencyMs, ...body } = await check(response, 200);
  assert.ok(Number.isFinite(latencyMs) && latencyMs >= 0);
  assert.deepEqual(body, { ok: true, provider, model });
}

test('test connection is available with chat off and reserves one run for a fixed provider prompt', async () => {
  const { send, calls } = fixture({ keys: { anthropic: dbKey } });
  await checkSuccessfulTest(await send('POST_TEST', {}));
  assert.deepEqual(calls.secrets, ['anthropic']);
  assert.deepEqual(calls.quota, [{ perMinute: 3, perMonth: 100 }]);
  assert.deepEqual(calls.finished, [['run-id', true]]);
  const [{ apiKey, system, messages, maxTokens, temperature }] = calls.providers;
  assert.equal(apiKey, dbKey);
  assert.deepEqual(messages, [{ role: 'user', content: 'Reply with the single word OK.' }]);
  assert.doesNotMatch(system, /Sparkle|Andy|newApplications|mock-db/);
  assert.equal(maxTokens, 400);
  assert.equal(temperature, 0.4);

  const custom = fixture({ provider: { active: 'custom', customBaseUrl: 'https://custom.example/v1/', customModel: 'model' }, keys: { custom: dbKey } });
  await checkSuccessfulTest(await custom.send('POST_TEST', {}), 'custom', 'model');
  assert.equal(custom.calls.providers[0].baseUrl, 'https://custom.example/v1');
});

test('test connection recognizes an absent versus unreadable DB key', async () => {
  const absent = fixture({ ready: false, decryptError: 'encryption_not_ready' });
  await checkSuccessfulTest(await absent.send('POST_TEST', {}));
  assert.equal(absent.calls.providers[0].apiKey, envKey);

  for (const [decryptError, code] of [['encryption_not_ready', 'config'], ['secret_decrypt_failed', 'upstream']]) {
    const { send, calls } = fixture({ keys: { anthropic: dbKey }, decryptError });
    await check(await send('POST_TEST', {}), 200, { ok: false, code });
    assert.deepEqual(calls.providers, []);
    assert.deepEqual(calls.finished, [['run-id', false]]);
  }
});

test('connection test failures only expose allowed codes and never trigger fallback', async () => {
  const provider = { customBaseUrl: 'https://custom.example', customModel: 'model', fallbackToCustom: true };
  for (const errorCode of ['config', 'auth', 'rate_limit', 'timeout', 'upstream', 'bad_response', 'blocked_url', dbKey]) {
    const { send, calls } = fixture({ provider, keys: { anthropic: dbKey, custom: dbKey }, errorCode });
    await check(await send('POST_TEST', {}), 200, { ok: false, code: errorCode === dbKey ? 'upstream' : errorCode });
    assert.deepEqual(calls.providers.map(request => request.provider), ['anthropic']);
    assert.deepEqual(calls.finished, [['run-id', false]]);
  }
  for (const [options, code] of [
    [{ provider: { active: 'custom' } }, 'config'],
    [{ provider: { ...provider, active: 'custom' }, blocked: true }, 'blocked_url'],
  ]) {
    const { send, calls } = fixture(options);
    await check(await send('POST_TEST', {}), 200, { ok: false, code });
    assert.deepEqual(calls.providers, []);
    assert.deepEqual(calls.finished, [['run-id', false]]);
  }
});

test('connection test rejects non-empty input and respects both quota ceilings', async () => {
  const bad = fixture();
  await check(await bad.send('POST_TEST', { prompt: 'override' }), 400, { error: 'invalid' });
  assert.equal(bad.calls.store, 0);
  for (const result of ['rate_limit', 'monthly_limit']) {
    const { send, calls } = fixture({ run: { result } });
    await check(await send('POST_TEST', {}), 429, { error: 'rate_limited' });
    assert.equal(calls.quota.length, 1);
    assert.deepEqual(calls.providers, []);
    assert.deepEqual(calls.finished, []);
  }
});
