import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../lib/assistant-settings-schema.mjs';
import { createOwnerAssistantHandler } from '../lib/server/owner-assistant-handler.mjs';
import { secretKeyValid } from '../lib/server/secret-box.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SECRET = 'provider-secret-never-return-this';

function setup(overrides = {}) {
  const state = {
    env: {
      OWNER_ASSISTANT_ENABLED: 'true',
      APP_ORIGIN: 'https://app.example',
      NODE_ENV: 'test',
      ANTHROPIC_API_KEY: '',
      ASSISTANT_SECRET_KEY: Buffer.alloc(32, 3).toString('base64'),
    },
    ownerEnabled: true,
    signedIn: true,
    member: true,
    settings: { ...structuredClone(DEFAULT_SETTINGS), enabled: true },
    secret: SECRET,
    calls: [],
    runs: [],
    finish: [],
    snapshotCalls: [],
    providerResults: [],
  };
  Object.assign(state, overrides);
  const session = {
    auth: { getUser: async () => ({ data: { user: state.signedIn ? { id: OWNER } : null }, error: null }) },
    from: () => ({
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({ data: state.member ? { user_id: OWNER } : null, error: null }),
    }),
  };
  let providerCall = 0;
  const handler = createOwnerAssistantHandler({
    env: state.env,
    ownerLoginEnabled: () => state.ownerEnabled && secretKeyValid(state.env.ASSISTANT_SECRET_KEY),
    getSessionClient: async () => session,
    loadSettings: async () => state.settings,
    getSecret: async (_session, _user, name) => name === 'anthropic' || name === 'custom' ? state.secret : null,
    loadSnapshot: async (_session, capabilities) => {
      state.snapshotCalls.push(capabilities);
      return { newApplications: 2, newQuotes: 1, queuedEmails: 0, failedEmails: 1 };
    },
    beginRun: async () => {
      state.runs.push('started');
      return [{ run_id: 'run-1', result: 'ok' }];
    },
    finishRun: async (...args) => { state.finish.push(args); },
    validateCustomBaseUrl: (url) => url ? { ok: true, url } : { ok: false },
    callProvider: async (params) => {
      state.calls.push(params);
      const result = state.providerResults[providerCall++];
      if (result instanceof Error) throw result;
      return result ?? { text: 'A safe answer.', provider: params.provider, model: params.model };
    },
    buildSystemPrompt: (settings, language, snapshot) => JSON.stringify({ settings, language, snapshot }),
  });
  return { handler, state };
}

function request(body = { message: 'How many new applications?', language: 'en' }, headers = {}) {
  return new Request('https://app.example/api/owner/assistant', {
    method: 'POST',
    headers: { origin: 'https://app.example', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('assistant route honors saved provider, persona capabilities, limits, history and response metadata', async () => {
  const { handler, state } = setup();
  const response = await handler(request({
    message: 'Summarize this.',
    language: 'es',
    history: [{ role: 'user', text: 'Earlier?' }, { role: 'assistant', text: 'Earlier answer.' }],
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { answer: 'A safe answer.', meta: { provider: 'anthropic', model: 'claude-sonnet-5-5' } });
  assert.deepEqual(state.runs, ['started']);
  assert.deepEqual(state.calls[0].messages, [
    { role: 'user', content: 'Earlier?' },
    { role: 'assistant', content: 'Earlier answer.' },
    { role: 'user', content: 'Summarize this.' },
  ]);
  assert.equal(state.calls[0].temperature, 0.4);
  assert.equal(state.calls[0].maxTokens, 400);
  assert.equal(state.calls[0].provider, 'anthropic');
  assert.equal(state.finish[0][0], 'run-1');
  assert.equal(state.finish[0][1], true);
  assert.doesNotMatch(JSON.stringify(body), /provider-secret-never-return-this/);
});

test('owner gates, origin, authentication and membership are checked before provider use', async () => {
  const disabledGate = setup({ ownerEnabled: false });
  assert.equal((await disabledGate.handler(request())).status, 503);
  assert.equal(disabledGate.state.calls.length, 0);

  const missingEncryptionKey = setup({ env: { ...setup().state.env, ASSISTANT_SECRET_KEY: '' } });
  assert.equal((await missingEncryptionKey.handler(request())).status, 503);
  assert.equal(missingEncryptionKey.state.calls.length, 0);
  const invalidEncryptionKey = setup({ env: { ...setup().state.env, ASSISTANT_SECRET_KEY: 'not-a-32-byte-key' } });
  assert.equal((await invalidEncryptionKey.handler(request())).status, 503);
  assert.equal(invalidEncryptionKey.state.calls.length, 0);

  const badOrigin = setup();
  assert.equal((await badOrigin.handler(request(undefined, { origin: 'https://attacker.example' }))).status, 403);
  assert.equal(badOrigin.state.runs.length, 0);

  const signedOut = setup({ signedIn: false });
  assert.equal((await signedOut.handler(request())).status, 401);
  assert.equal(signedOut.state.calls.length, 0);

  const stranger = setup({ member: false });
  assert.equal((await stranger.handler(request())).status, 403);
  assert.equal(stranger.state.calls.length, 0);
});

test('disabled setting and absent provider key fail closed and finish quota runs', async () => {
  const disabled = setup({ settings: { ...structuredClone(DEFAULT_SETTINGS), enabled: false } });
  const disabledResponse = await disabled.handler(request());
  assert.equal(disabledResponse.status, 503);
  assert.deepEqual(await disabledResponse.json(), { error: 'disabled' });
  assert.equal(disabled.state.runs.length, 0);

  const missingKey = setup({ secret: null });
  const response = await missingKey.handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'provider_not_set' });
  assert.equal(missingKey.state.calls.length, 0);
  assert.deepEqual(missingKey.state.finish[0].slice(0, 2), ['run-1', false]);
});

test('the saved custom provider is used as the primary when selected', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.enabled = true;
  settings.provider.active = 'custom';
  settings.provider.customBaseUrl = 'https://provider.example/v1';
  settings.provider.customModel = 'custom-model';
  const { handler, state } = setup({ settings });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(state.calls[0].provider, 'custom');
  assert.equal(state.calls[0].model, 'custom-model');
  assert.equal(state.calls[0].baseUrl, 'https://provider.example/v1');
});

test('history is rejected rather than silently dropping malformed turns', async () => {
  const { handler, state } = setup();
  const invalid = [
    { role: 'assistant', text: 'first' },
    { role: 'user', text: 'first' },
    { role: 'user', text: 'one' },
    { role: 'user', text: 'x'.repeat(1001) },
    { role: 'user', text: 'x', extra: true },
  ];
  for (const turn of invalid) {
    const response = await handler(request({ message: 'Question', language: 'en', history: [turn] }));
    assert.equal(response.status, 400);
  }
  assert.equal(state.calls.length, 0);
});

test('fallback is limited to configured Anthropic transient failures and never follows a safety refusal', async () => {
  const fallbackSettings = structuredClone(DEFAULT_SETTINGS);
  fallbackSettings.enabled = true;
  fallbackSettings.provider.fallbackToCustom = true;
  fallbackSettings.provider.customBaseUrl = 'https://provider.example/v1';
  fallbackSettings.provider.customModel = 'custom-model';
  const transient = setup({ settings: fallbackSettings, providerResults: [Object.assign(new Error('private'), { code: 'upstream' })] });
  const answer = await transient.handler(request());
  assert.equal(answer.status, 200);
  assert.deepEqual(transient.state.calls.map((call) => call.provider), ['anthropic', 'custom']);

  const refused = setup({ settings: fallbackSettings, providerResults: [Object.assign(new Error('private'), { code: 'blocked_url' })] });
  assert.equal((await refused.handler(request())).status, 503);
  assert.deepEqual(refused.state.calls.map((call) => call.provider), ['anthropic']);
});
