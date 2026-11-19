import test from 'node:test';
import assert from 'node:assert/strict';
import { callProvider, ProviderError } from '../lib/ai/index.mjs';

const KEY = 'secret-provider-key-DO-NOT-LEAK';
const messages = [{ role: 'user', content: 'Hello' }];
const common = {
  apiKey: KEY,
  model: 'claude-sonnet-5-5',
  system: 'Answer safely.',
  messages,
  maxTokens: 400,
  temperature: 0.4,
};
const custom = {
  ...common,
  provider: 'custom',
  model: 'demo-model',
  baseUrl: 'https://provider.example/v1/',
  resolver: async () => ['8.8.8.8'],
};

function response(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('Anthropic request shape and response parsing are exact', async () => {
  let request;
  const result = await callProvider({
    ...common,
    provider: 'anthropic',
    fetcher: async (url, init) => {
      request = { url, init };
      return response({
        content: [{ type: 'text', text: '  Hello ' }, { type: 'text', text: 'there.  ' }],
        usage: { input_tokens: 12, output_tokens: 4 },
      });
    },
  });

  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.init.method, 'POST');
  assert.deepEqual({ ...request.init.headers }, {
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  });
  assert.deepEqual(JSON.parse(request.init.body), {
    model: 'claude-sonnet-5-5',
    max_tokens: 400,
    temperature: 0.4,
    system: 'Answer safely.',
    messages,
  });
  assert.equal(request.init.redirect, 'manual');
  assert.equal(result.text, 'Hello there.');
  assert.deepEqual(result, {
    text: 'Hello there.',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    usage: { inputTokens: 12, outputTokens: 4 },
  });
});

test('custom OpenAI-compatible request shape and response parsing are exact', async () => {
  let request;
  const result = await callProvider({
    ...custom,
    fetcher: async (url, init) => {
      request = { url, init };
      return response({
        choices: [{ message: { role: 'assistant', content: '  Custom answer.  ' } }],
        usage: { prompt_tokens: 9, completion_tokens: 3 },
      });
    },
  });

  assert.equal(request.url, 'https://provider.example/v1/chat/completions');
  assert.equal(request.init.method, 'POST');
  assert.deepEqual({ ...request.init.headers }, {
    authorization: `Bearer ${KEY}`,
    'content-type': 'application/json',
  });
  assert.deepEqual(JSON.parse(request.init.body), {
    model: 'demo-model',
    max_tokens: 400,
    temperature: 0.4,
    messages: [
      { role: 'system', content: 'Answer safely.' },
      ...messages,
    ],
  });
  assert.equal(request.init.redirect, 'manual');
  assert.deepEqual(result, {
    text: 'Custom answer.',
    provider: 'custom',
    model: 'demo-model',
    usage: { inputTokens: 9, outputTokens: 3 },
  });
});

test('configuration and message shape failures have fixed config errors', async () => {
  const invalidCases = [
    { ...common, provider: 'openai' },
    { ...common, provider: 'anthropic', apiKey: '' },
    { ...common, provider: 'anthropic', model: '' },
    { ...common, provider: 'custom', baseUrl: '' },
    { ...common, provider: 'anthropic', messages: [] },
    { ...common, provider: 'anthropic', messages: [{ role: 'assistant', content: 'Hi' }] },
    { ...common, provider: 'anthropic', messages: [{ role: 'user', content: 'Hi' }, { role: 'user', content: 'Again' }] },
    { ...common, provider: 'anthropic', messages: [{ role: 'user', content: 'x'.repeat(2501) }] },
    { ...common, provider: 'anthropic', maxTokens: 0 },
    { ...common, provider: 'anthropic', temperature: 1.1 },
  ];

  for (const input of invalidCases) {
    await assert.rejects(callProvider({ ...input, fetcher: async () => response({}) }), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, 'config');
      return true;
    });
  }
});

test('HTTP, timeout, and network errors map to fixed codes without leaking secrets', async () => {
  const cases = [
    [401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [500, 'upstream'], [503, 'upstream'],
  ];
  for (const [status, code] of cases) {
    await assert.rejects(callProvider({
      ...common,
      provider: 'anthropic',
      fetcher: async () => response({}, status),
    }), (error) => assertProviderError(error, code));
  }

  await assert.rejects(callProvider({
    ...common,
    provider: 'anthropic',
    fetcher: async () => { throw new DOMException('private details', 'AbortError'); },
  }), (error) => assertProviderError(error, 'timeout'));
  await assert.rejects(callProvider({
    ...common,
    provider: 'anthropic',
    fetcher: async () => { throw new Error(KEY); },
  }), (error) => assertProviderError(error, 'upstream'));

  try {
    await callProvider({ ...common, provider: 'anthropic', fetcher: async () => { throw new Error(KEY); } });
  } catch (error) {
    assert.doesNotMatch(error.message, new RegExp(KEY));
    assert.doesNotMatch(JSON.stringify(error), new RegExp(KEY));
  }
});

test('redirects are blocked and provider bodies are size-limited', async () => {
  await assert.rejects(callProvider({
    ...custom,
    fetcher: async () => response('', 302, { location: 'http://169.254.169.254/latest/meta-data/' }),
  }), (error) => assertProviderError(error, 'blocked_url'));

  await assert.rejects(callProvider({
    ...common,
    provider: 'anthropic',
    fetcher: async () => response('x'.repeat(65 * 1024)),
  }), (error) => assertProviderError(error, 'bad_response'));
});

test('malformed, empty, oversized-text, and tool-bearing provider responses are rejected', async () => {
  const payloads = [
    ['not json', 'bad_response'],
    [{ content: [] }, 'bad_response'],
    [{ content: [{ type: 'text', text: '  ' }] }, 'bad_response'],
    [{ content: [{ type: 'text', text: 'x'.repeat(6001) }] }, 'bad_response'],
    [{ content: [{ type: 'tool_use', name: 'lookup' }] }, 'bad_response'],
  ];

  for (const [payload, code] of payloads) {
    await assert.rejects(callProvider({
      ...common,
      provider: 'anthropic',
      fetcher: async () => response(payload),
    }), (error) => assertProviderError(error, code));
  }

  await assert.rejects(callProvider({
    ...custom,
    fetcher: async () => response({ choices: [{ message: { content: 'answer', tool_calls: [] } }] }),
  }), (error) => assertProviderError(error, 'bad_response'));
});

function assertProviderError(error, code) {
  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /secret-provider-key/);
  assert.doesNotMatch(JSON.stringify(error), /secret-provider-key/);
  return true;
}
