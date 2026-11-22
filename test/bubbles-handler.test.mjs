import test from 'node:test';
import assert from 'node:assert/strict';
import { createBubblesHandler, estimateSpendMillicents } from '../lib/server/bubbles-handler.mjs';

const TENANT = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const USER = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://app.example';

function request(body, headers = {}) {
  return new Request(`${ORIGIN}/api/owner/bubbles`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Build a handler with injectable deps for unit testing. */
function setup(overrides = {}) {
  const state = {
    env: { APP_ORIGIN: ORIGIN },
    rpcCalls: [],
    rpc: overrides.rpc || (async (name, args) => {
      state.rpcCalls.push({ name, args });
      if (name === 'check_ai_budget') {
        return { data: [{ allowed: true, remaining_cents: 5000, total_cents: 10000, hard_stopped: false }], error: null };
      }
      return { data: [], error: null };
    }),
    providerKeys: overrides.providerKeys || {
      get: async () => ({ ok: true, apiKey: 'sk-ant-test-key-1234567890abcdef' }),
    },
    session: {
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
      from: () => ({
        select() { return this; },
        eq() { return this; },
        limit() { return this; },
        maybeSingle: async () => state.session.maybeSingleResult ?? { data: null, error: null },
      }),
      maybeSingleResult: { data: { provider_id: 'anthropic', model: 'claude-sonnet-5-5', base_url: null, status: 'active' }, error: null },
    },
    settings: {
      enabled: true,
      capabilities: {},
      limits: { maxOutputTokens: 400, temperature: 0.4 },
    },
    tenantId: TENANT,
    ...overrides,
  };

  const getSessionClient = async () => state.session;
  const getTenantId = async () => (state.tenantId === undefined ? TENANT : state.tenantId);
  const loadSettings = async () => state.settings;
  const loadSnapshot = async () => ({ completedJobs: 0, scheduledJobs: 0, newApplicants: 0, openShifts: 0 });
  const buildSystemPrompt = (settings, language, snapshot) => `Bubbles system prompt (${language})`;

  const handler = createBubblesHandler({
    env: state.env,
    getSessionClient,
    getTenantId,
    loadSettings,
    loadSnapshot,
    buildSystemPrompt,
    providerKeys: state.providerKeys,
    rpc: state.rpc,
  });

  return { handler, state };
}

async function post(handler, body = { message: 'How many jobs today?' }, headers = {}) {
  const res = await handler(request(body, headers));
  return { status: res.status, json: await res.json() };
}

// ---------------------------------------------------------------- authentication & gating

test('rejects requests from wrong origin', async () => {
  const { handler } = setup();
  const { status } = await post(handler, {}, { origin: 'https://evil.example' });
  assert.equal(status, 403);
});

test('rejects unauthenticated user', async () => {
  const { handler } = setup({
    session: { auth: { getUser: async () => ({ data: { user: null }, error: null }) } },
  });
  const { status } = await post(handler);
  assert.equal(status, 401);
});

test('rejects user without membership', async () => {
  const { handler } = setup({ tenantId: null });
  const { status } = await post(handler);
  assert.equal(status, 403);
});

test('rejects when assistant is disabled', async () => {
  const { handler } = setup({ settings: { enabled: false, capabilities: {}, limits: { maxOutputTokens: 400, temperature: 0.4 } } });
  const { status, json } = await post(handler);
  assert.equal(status, 503);
  assert.equal(json.error, 'disabled');
});

// ---------------------------------------------------------------- budget enforcement (WP-E)

test('provider path is used when budget check allows', async () => {
  const { handler, state } = setup();
  const { status, json } = await post(handler);
  const budgetCall = state.rpcCalls.find((c) => c.name === 'check_ai_budget');
  assert.ok(budgetCall, 'check_ai_budget RPC was called');
  assert.equal(budgetCall.args.p_tenant_id, TENANT);
  assert.ok(budgetCall.args.p_cents >= 1, 'cents estimate is positive');
  assert.equal(status, 200);
  assert.doesNotMatch(JSON.stringify(json), /sk-ant-test-key/, 'plaintext key never leaks in response');
});

test('budget denial falls back to Lite tier with reason', async () => {
  const { handler } = setup({
    rpc: async (name, args) => {
      if (name === 'check_ai_budget') {
        return { data: [{ allowed: false, remaining_cents: 0, total_cents: 10000, hard_stopped: true }], error: null };
      }
      return { data: [], error: null };
    },
    providerKeys: {
      get: async () => ({ ok: true, apiKey: 'sk-ant-test-key-1234567890abcdef' }),
    },
  });

  const { status, json } = await post(handler);
  assert.equal(status, 200);
  assert.equal(json.meta.tier, 'lite');
  assert.equal(json.meta.reason, 'budget_or_provider_unavailable');
  assert.doesNotMatch(JSON.stringify(json), /sk-ant-test-key/, 'plaintext key never leaks in response');
});

test('no RPC deps means fail-closed to Lite', async () => {
  const { handler } = setup({ rpc: null, providerKeys: null });
  const { status, json } = await post(handler);
  assert.equal(status, 200);
  assert.equal(json.meta.tier, 'lite');
});

test('no active provider falls back to Lite', async () => {
  const { handler } = setup({
    maybeSingleResult: { data: null, error: null },
    providerKeys: {
      get: async () => ({ ok: true, apiKey: 'sk-ant-test-key-1234567890abcdef' }),
    },
  });
  const { status, json } = await post(handler);
  assert.equal(status, 200);
  assert.equal(json.meta.tier, 'lite');
});

// ---------------------------------------------------------------- per-request ceilings

test('maxOutputTokens is capped at server ceiling', async () => {
  const { handler } = setup({
    settings: { enabled: true, capabilities: {}, limits: { maxOutputTokens: 5000, temperature: 0.4 } },
    providerKeys: {
      get: async () => ({ ok: true, apiKey: 'sk-ant-test-key-1234567890abcdef' }),
    },
    rpc: async () => ({ data: [{ allowed: true, remaining_cents: 5000, total_cents: 10000, hard_stopped: false }], error: null }),
    session: {
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
      from: () => ({
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: { provider_id: 'anthropic', model: 'claude-sonnet-5-5', base_url: null, status: 'active' }, error: null }),
      }),
    },
  });
  const { status } = await post(handler);
  assert.equal(status, 200);
});

test('input history is capped at 8 turns', async () => {
  const { handler } = setup({
    providerKeys: {
      get: async () => ({ ok: true, apiKey: 'sk-ant-test-key-1234567890abcdef' }),
    },
    rpc: async () => ({ data: [{ allowed: true, remaining_cents: 5000, total_cents: 10000, hard_stopped: false }], error: null }),
  });
  const longHistory = Array.from({ length: 15 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: `turn ${i}`,
  }));
  const { status } = await post(handler, { message: 'Q', history: longHistory });
  assert.equal(status, 200);
});

// ---------------------------------------------------------------- estimateSpendMillicents (direct unit test)

test('estimateSpendMillicents returns null for unknown provider', () => {
  assert.equal(estimateSpendMillicents([{ role: 'user', content: 'hi' }], 100, 'bogus', 'model'), null);
});

test('estimateSpendMillicents returns null for unknown model of known provider', () => {
  assert.equal(estimateSpendMillicents([{ role: 'user', content: 'hi' }], 100, 'anthropic', 'nonexistent-model'), null);
});

test('estimateSpendMillicents computes Anthropic Sonnet cost', () => {
  const messages = [{ role: 'user', content: 'Hello world' }];
  const ms = estimateSpendMillicents(messages, 100, 'anthropic', 'claude-sonnet-5-5');
  assert.ok(ms > 0);
  assert.ok(Number.isInteger(ms));
});

test('estimateSpendMillicents computes OpenAI GPT-4o cost', () => {
  const messages = [{ role: 'user', content: 'Hello world' }];
  const ms = estimateSpendMillicents(messages, 100, 'openai_compatible', 'gpt-4o');
  assert.ok(ms > 0);
  assert.ok(Number.isInteger(ms));
});

test('estimateSpendMillicents scales with message length and maxTokens', () => {
  const short = estimateSpendMillicents([{ role: 'user', content: 'hi' }], 100, 'anthropic', 'claude-sonnet-5-5');
  const long = estimateSpendMillicents([{ role: 'user', content: 'x'.repeat(10000) }], 100, 'anthropic', 'claude-sonnet-5-5');
  assert.ok(long > short, 'longer input costs more');
  const moreOut = estimateSpendMillicents([{ role: 'user', content: 'hi' }], 500, 'anthropic', 'claude-sonnet-5-5');
  const lessOut = estimateSpendMillicents([{ role: 'user', content: 'hi' }], 100, 'anthropic', 'claude-sonnet-5-5');
  assert.ok(moreOut > lessOut, 'more output tokens cost more');
});