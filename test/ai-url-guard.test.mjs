import test from 'node:test';
import assert from 'node:assert/strict';
import { callProvider, validateCustomBaseUrl } from '../lib/ai/index.mjs';

const urlCases = [
  ['https://example.com', true],
  ['https://api.example.com/v1', true],
  ['https://8.8.8.8', true],
  ['https://1.1.1.1:443/path', true],
  ['https://localhost', false],
  ['https://worker.localhost', false],
  ['https://printer.local', false],
  ['https://service.internal', false],
  ['https://127.0.0.1', false],
  ['https://127.1', false],
  ['https://0x7f000001', false],
  ['https://2130706433', false],
  ['https://0.0.0.0', false],
  ['https://10.0.0.5', false],
  ['https://100.64.0.1', false],
  ['https://100.127.255.255', false],
  ['https://127.255.255.255', false],
  ['https://169.254.169.254', false],
  ['https://172.16.0.1', false],
  ['https://172.31.255.255', false],
  ['https://192.0.0.1', false],
  ['https://192.0.2.4', false],
  ['https://192.168.1.1', false],
  ['https://192.88.99.1', false],
  ['https://198.18.0.1', false],
  ['https://198.19.255.255', false],
  ['https://198.51.100.2', false],
  ['https://203.0.113.9', false],
  ['https://224.0.0.1', false],
  ['https://240.0.0.1', false],
  ['https://255.255.255.255', false],
  ['https://[::]', false],
  ['https://[::1]', false],
  ['https://[fc00::1]', false],
  ['https://[fd12:3456::1]', false],
  ['https://[fe80::1]', false],
  ['https://[ff02::1]', false],
  ['https://[::ffff:10.0.0.5]', false],
  ['https://[2001:db8::1]', false],
];

test('custom base URL policy covers allowed and blocked host forms', () => {
  assert.ok(urlCases.length >= 30);
  for (const [url, expected] of urlCases) {
    assert.equal(validateCustomBaseUrl(url).ok, expected, url);
  }
  assert.deepEqual(validateCustomBaseUrl('https://api.example.com/v1/'), {
    ok: true,
    url: 'https://api.example.com/v1',
  });
});

test('custom URL rejects credentials, query, fragment, unsafe ports, and long values', () => {
  const blocked = [
    'https://user:pass@example.com',
    'https://@example.com',
    'https://example.com?',
    'https://example.com#',
    'https://example.com/path?token=x',
    'https://example.com/path#fragment',
    'https://example.com:444',
    `https://example.com/${'x'.repeat(201)}`,
    'http://example.com',
  ];
  for (const url of blocked) assert.equal(validateCustomBaseUrl(url).ok, false, url);
  assert.deepEqual(validateCustomBaseUrl('http://localhost:3000', { allowLocal: true }).ok, false);
  assert.equal(validateCustomBaseUrl('http://localhost', { allowLocal: true }).ok, true);
  assert.equal(validateCustomBaseUrl('http://127.0.0.1', { allowLocal: true }).ok, true);
  assert.equal(validateCustomBaseUrl('http://127.0.0.2', { allowLocal: true }).ok, false);
});

test('DNS resolution blocks a public-looking hostname resolving to private space', async () => {
  await assert.rejects(callProvider({
    provider: 'custom',
    apiKey: 'safe-test-key',
    model: 'model',
    baseUrl: 'https://evil.example/v1',
    system: 'Test',
    messages: [{ role: 'user', content: 'Hi' }],
    maxTokens: 50,
    temperature: 0,
    resolver: async () => ['93.184.216.34', '10.0.0.5'],
    fetcher: async () => { throw new Error('Must not fetch'); },
  }), (error) => error.code === 'blocked_url');
});

test('metadata redirect is blocked even when the configured host resolves publicly', async () => {
  await assert.rejects(callProvider({
    provider: 'custom',
    apiKey: 'safe-test-key',
    model: 'model',
    baseUrl: 'https://provider.example/v1',
    system: 'Test',
    messages: [{ role: 'user', content: 'Hi' }],
    maxTokens: 50,
    temperature: 0,
    resolver: async () => ['93.184.216.34'],
    fetcher: async () => new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    }),
  }), (error) => error.code === 'blocked_url');
});

test('any non-public DNS answer blocks the custom host before a request', async () => {
  const addresses = [
    ['127.0.0.1'], ['169.254.1.2'], ['::1'], ['fe80::1234'], ['fc00::42'],
  ];
  for (const resolved of addresses) {
    await assert.rejects(callProvider({
      provider: 'custom',
      apiKey: 'safe-test-key',
      model: 'model',
      baseUrl: 'https://mixed.example',
      system: 'Test',
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 50,
      temperature: 0,
      resolver: async () => resolved,
      fetcher: async () => { throw new Error('Must not fetch'); },
    }), (error) => error.code === 'blocked_url');
  }
});
