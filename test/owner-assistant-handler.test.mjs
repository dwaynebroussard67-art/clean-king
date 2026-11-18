import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginAssistantRun, createOwnerAssistantHandler, finishAssistantRun,
} from '../lib/server/owner-assistant-handler.mjs';

const origin = 'https://demo.example';
const dbKey = 'mock-anthropic-db-credential';
const envKey = 'mock-anthropic-env-credential';
const customKey = 'mock-custom-db-credential';
const message = { message: 'What needs attention?', language: 'en' };
const provider = {
  active: 'anthropic', anthropicModel: 'claude-sonnet-5-5', customBaseUrl: 'https://custom.example/v1/',
  customModel: 'test-model', fallbackToCustom: false,
};
const limits = { perMinute: 4, perMonth: 75, maxOutputTokens: 240, temperature: 0.25 };

const providerError = (code, detail = dbKey) => Object.assign(new Error(detail), { code });

function fixture(options = {}) {
  const calls = { steps: [], quota: [], secrets: [], validators: [], snapshots: [], provider: [], finished: [] };
  const settings = {
    version: 1,
    enabled: options.enabled ?? true,
    persona: { name: 'Brillo', ownerName: 'Andy', tone: 'friendly', emoji: 'none', length: 'normal' },
    voice: { speakReplies: false, rate: 1, pitch: 1, voiceName: null },
    capabilities: { counts: true, emailHealth: false },
    provider: { ...provider, ...options.provider },
    limits,
  };
  const keys = { anthropic: dbKey, custom: customKey, ...options.keys };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-id' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: 'owner-id' } }) }) }) }),
  };
  const handler = createOwnerAssistantHandler({
    env: { APP_ORIGIN: origin, OWNER_ASSISTANT_ENABLED: 'true', ANTHROPIC_API_KEY: envKey, ...options.env },
    ownerLoginEnabled: () => true,
    getSessionClient: async () => client,
    loadSettings: async () => { calls.steps.push('settings'); return { settings, version: 1 }; },
    beginRun: async budget => {
      calls.steps.push('begin');
      calls.quota.push(budget);
      return options.run ?? { run_id: 'run-id', result: 'ok' };
    },
    finishRun: async (id, success) => {
      calls.finished.push([id, success]);
      if (options.finishError) throw new Error(dbKey);
    },
    getSecret: async name => {
      calls.steps.push(`key:${name}`);
      calls.secrets.push(name);
      if (options.secretError) throw options.secretError;
      return keys[name];
    },
    loadSnapshot: async (session, capabilities) => {
      calls.steps.push('snapshot');
      assert.equal(session, client);
      calls.snapshots.push(capabilities);
      if (options.snapshotError) throw new Error(dbKey);
      return { newApplications: 2, newQuotes: 3, queuedEmails: 99, privateName: 'PrivateExample' };
    },
    validateCustomBaseUrl: (url, opts) => {
      calls.validators.push([url, opts]);
      return options.validate?.(url, opts) ?? { ok: true, url: url.replace(/\/$/, '') };
    },
    callProvider: async request => {
      calls.steps.push(`provider:${request.provider}`);
      calls.provider.push(request);
      return options.call?.(request) ?? { text: ' Two applications. ', provider: 'anthropic', model: dbKey };
    },
  });
  function ask(body = message) {
    return handler(new Request(`${origin}/api/owner/assistant`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
  }
  return { ask, calls };
}

async function result(response, status, expected) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.deepEqual(data, expected);
}

const notSet = { error: 'provider_not_set' };
const failed = { error: 'provider_failed' };

test('chat forwards alternating role content and fresh approved counts; it returns only safe reply fields', async () => {
  const { ask, calls } = fixture();
  const history = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: ` Turn ${index} ` }));
  await result(await ask({ message: ' Ahora ', language: 'es', history }), 200, {
    answer: 'Two applications.', meta: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  });
  assert.deepEqual(calls.steps, ['settings', 'begin', 'key:anthropic', 'snapshot', 'provider:anthropic']);
  assert.deepEqual(calls.quota, [{ perMinute: 4, perMonth: 75 }]);
  assert.deepEqual(calls.snapshots, [{ counts: true, emailHealth: false }]);
  const [{ apiKey, system, maxTokens, temperature, messages }] = calls.provider;
  assert.equal(apiKey, dbKey);
  assert.equal(maxTokens, 240);
  assert.equal(temperature, 0.25);
  assert.match(system, /Reply in Spanish\./);
  assert.match(system, /newApplications: 2\nnewQuotes: 3/);
  assert.doesNotMatch(system, /queuedEmails|PrivateExample|mock-anthropic/);
  assert.deepEqual(messages, [
    ...history.map(({ role, text }) => ({ role, content: text.trim() })), { role: 'user', content: 'Ahora' },
  ]);
  assert.equal(Object.hasOwn(calls.provider[0], 'tools'), false);
  assert.deepEqual(calls.finished, [['run-id', true]]);
});

test('invalid messages and histories fail as a whole before loading settings or reserving quota', async () => {
  const user = { role: 'user', text: 'hello' }, assistant = { role: 'assistant', text: 'hi' };
  const { ask, calls } = fixture();
  for (const input of [
    null, ['hi'], { message: 'hi' }, { ...message, enabled: true }, { ...message, language: 'fr' },
    ...[' ', 'x'.repeat(2501), ` ${'x'.repeat(2500)}`, null].map(value => ({ ...message, message: value })),
    ...[null, {}, [user], [assistant, user], [user, user], [user, { role: 'system', text: 'hi' }],
      [user, { ...assistant, extra: true }], [user, { ...assistant, text: ' ' }], [user, { ...assistant, text: 'x'.repeat(1001) }],
      [user, assistant, user, assistant, user, assistant, user, assistant]].map(history => ({ ...message, history })),
  ]) await result(await ask(input), 400, { error: 'invalid' });
  assert.deepEqual(calls.steps, []);
  await result(await ask({ ...message, history: [] }), 200, {
    answer: 'Two applications.', meta: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  });
});

test('master switch, quota rejection, and failed quota reservation prevent provider calls', async () => {
  const off = fixture({ enabled: false });
  await result(await off.ask(), 503, { error: 'disabled' });
  assert.deepEqual(off.calls.steps, ['settings']);
  for (const reason of ['rate_limit', 'monthly_limit', 'unexpected', 'ok']) {
    const { ask, calls } = fixture({ run: { result: reason } });
    const limited = reason.endsWith('_limit');
    await result(await ask(), limited ? 429 : 503, limited ? { error: 'rate_limited' } : failed);
    assert.deepEqual(calls.steps, ['settings', 'begin']);
    assert.deepEqual(calls.finished, []);
  }
});

test('Anthropic uses the env key only if its DB slot is empty; custom has no env fallback', async () => {
  const fromEnv = fixture({ keys: { anthropic: null } });
  await result(await fromEnv.ask(), 200, { answer: 'Two applications.', meta: { provider: 'anthropic', model: 'claude-sonnet-5-5' } });
  assert.equal(fromEnv.calls.provider[0].apiKey, envKey);
  for (const options of [
    { keys: { anthropic: null }, env: { ANTHROPIC_API_KEY: '' } },
    { provider: { active: 'custom' }, keys: { custom: null } },
    { provider: { anthropicModel: '' } }, { provider: { active: 'custom', customModel: '' } },
    { provider: { active: 'custom', customBaseUrl: '' } },
  ]) {
    const { ask, calls } = fixture(options);
    await result(await ask(), 503, notSet);
    assert.deepEqual(calls.provider, []);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.finished, [['run-id', false]]);
  }
});

test('the development-local option is explicit and never reaches the provider in production', async () => {
  const url = 'http://localhost:8000/v1';
  for (const [NODE_ENV, flag, allowed] of [['development', 'true', true], ['production', 'true', false], ['development', 'false', false]]) {
    const { ask, calls } = fixture({
      provider: { active: 'custom', customBaseUrl: url }, env: { NODE_ENV, AI_ALLOW_LOCAL_CUSTOM: flag },
      validate: (baseUrl, { allowLocal }) => allowLocal ? { ok: true, url: baseUrl } : { ok: false, reason: dbKey },
    });
    await result(await ask(), allowed ? 200 : 503, allowed ? { answer: 'Two applications.', meta: { provider: 'custom', model: 'test-model' } } : notSet);
    assert.deepEqual(calls.validators, [[url, { allowLocal: allowed }]]);
    assert.equal(calls.provider.length, allowed ? 1 : 0);
    if (allowed) assert.equal(calls.provider[0].allowLocal, true);
  }
});

test('fallback retries only eligible Anthropic failures, once, in the same run', async () => {
  for (const code of ['upstream', 'timeout', 'rate_limit', 'auth', 'config', 'bad_response', 'blocked_url', 'other']) {
    const { ask, calls } = fixture({
      provider: { fallbackToCustom: true },
      call: ({ provider: slot }) => { if (slot === 'anthropic') throw providerError(code); return { text: 'Fallback reply' }; },
    });
    const eligible = ['upstream', 'timeout', 'rate_limit'].includes(code);
    await result(await ask(), eligible ? 200 : 503, eligible ? { answer: 'Fallback reply', meta: { provider: 'custom', model: 'test-model' } } : failed);
    assert.deepEqual(calls.provider.map(request => request.provider), eligible ? ['anthropic', 'custom'] : ['anthropic']);
    assert.deepEqual(calls.finished, [['run-id', eligible]]);
    assert.equal(calls.quota.length, 1);
    assert.equal(calls.snapshots.length, 1);
    if (eligible) {
      assert.equal(calls.provider[1].baseUrl, 'https://custom.example/v1');
      assert.equal(calls.provider[1].apiKey, customKey);
    }
  }
  for (const [options, attempts] of [
    [{ provider: { active: 'custom', fallbackToCustom: true } }, 1],
    [{ provider: { fallbackToCustom: true }, keys: { custom: null } }, 1],
    [{ provider: { fallbackToCustom: true } }, 2], [{}, 1],
  ]) {
    const { ask, calls } = fixture({ ...options, call: () => { throw providerError('upstream'); } });
    await result(await ask(), 503, failed);
    assert.equal(calls.provider.length, attempts);
    assert.deepEqual(calls.finished, [['run-id', false]]);
  }
});

test('finished records cover secret, snapshot, and reply errors; no provider key escapes', async () => {
  for (const options of [
    { secretError: new Error(dbKey) }, { snapshotError: true }, { call: () => ({ text: `Echo ${dbKey}` }) },
    { keys: { anthropic: ` ${dbKey} ` }, call: () => ({ text: dbKey }) },
    { call: () => ({ text: ' ' }) }, { call: () => ({ text: 'X'.repeat(6001) }) },
    { provider: { fallbackToCustom: true }, call: ({ provider: slot }) => {
      if (slot === 'anthropic') throw providerError('timeout');
      return { text: `Echo ${dbKey}` };
    } },
  ]) {
    const { ask, calls } = fixture(options);
    await result(await ask(), 503, failed);
    assert.deepEqual(calls.finished, [['run-id', false]]);
  }
  const inPrompt = fixture();
  await result(await inPrompt.ask({ ...message, message: `Question with ${dbKey}` }), 503, failed);
  assert.deepEqual(inPrompt.calls.provider, []);
  assert.deepEqual(inPrompt.calls.finished, [['run-id', false]]);
  const failedFinish = fixture({ finishError: true });
  await result(await failedFinish.ask(), 200, { answer: 'Two applications.', meta: { provider: 'anthropic', model: 'claude-sonnet-5-5' } });
  assert.deepEqual(failedFinish.calls.finished, [['run-id', true]]);
});

test('quota adapters use the frozen RPC names and named arguments', async () => {
  const calls = [];
  const run = { result: 'ok', run_id: 'run-id' };
  const client = { async rpc(name, args) {
    calls.push([name, args]);
    return { data: name === 'begin_assistant_run' ? [run] : true };
  } };
  assert.deepEqual(await beginAssistantRun(limits, client), run);
  assert.equal(await finishAssistantRun('run-id', false, client), true);
  assert.deepEqual(calls, [
    ['begin_assistant_run', { p_per_minute: 4, p_per_month: 75 }],
    ['finish_assistant_run', { p_run_id: 'run-id', p_success: false }],
  ]);
});
