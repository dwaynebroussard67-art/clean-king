import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPinnedProvider } from '../lib/server/provider-url.mjs';

const body = JSON.stringify({ model: 'model', messages: [] });
const init = {
  method: 'POST',
  headers: { authorization: 'Bearer custom-only-key', 'content-type': 'application/json' },
  body,
  signal: AbortSignal.timeout(1000),
};
const url = 'https://provider.example/v1/chat/completions';

function publicResolver(addresses) {
  let calls = 0;
  return {
    resolver: async () => {
      calls += 1;
      return typeof addresses === 'function' ? addresses(calls) : addresses;
    },
    calls: () => calls,
  };
}

test('allowed public DNS is pinned to the checked address for the TLS request', async () => {
  const resolved = publicResolver((calls) => calls === 1 ? ['93.184.216.34'] : ['10.0.0.5']);
  let transportOptions;
  const response = await requestPinnedProvider({
    baseUrl: 'https://provider.example/v1',
    url,
    init,
    resolver: resolved.resolver,
    transport: async (options) => {
      transportOptions = options;
      return new Response('{"choices":[]}', { status: 200 });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(resolved.calls(), 1);
  assert.equal(transportOptions.hostname, 'provider.example');
  assert.equal(transportOptions.servername, 'provider.example');
  assert.equal(transportOptions.pinnedAddress, '93.184.216.34');
  assert.equal(transportOptions.path, '/v1/chat/completions');
  assert.equal(transportOptions.redirect, 'error');
  let lookupResult;
  transportOptions.lookup('provider.example', {}, (error, address, family) => {
    lookupResult = { error, address, family };
  });
  assert.deepEqual(lookupResult, { error: null, address: '93.184.216.34', family: 4 });
  assert.equal(transportOptions.headers.authorization, 'Bearer custom-only-key');
});

test('rejects loopback, private, link-local, CGNAT, cloud metadata, and IPv6 local answers', async () => {
  const blocked = [
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '172.20.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:169.254.169.254',
  ];
  for (const address of blocked) {
    let contacted = false;
    await assert.rejects(requestPinnedProvider({
      baseUrl: 'https://provider.example/v1',
      url,
      init,
      resolver: async () => [address],
      transport: async () => { contacted = true; return new Response(''); },
    }), { message: 'blocked_url' });
    assert.equal(contacted, false, address);
  }
});

test('does not follow redirects, including a redirect to a metadata address', async () => {
  let calls = 0;
  const response = await requestPinnedProvider({
    baseUrl: 'https://provider.example/v1',
    url,
    init,
    resolver: async () => ['93.184.216.34'],
    transport: async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      });
    },
  });
  assert.equal(response.status, 302);
  assert.equal(calls, 1);
});

test('rejects unsafe URL syntax and does not invoke the network transport', async () => {
  const blocked = [
    'http://provider.example/v1',
    'https://user:secret@provider.example/v1',
    'https://127.0.0.1/v1',
    'https://provider.example:444/v1',
  ];
  for (const baseUrl of blocked) {
    let contacted = false;
    await assert.rejects(requestPinnedProvider({
      baseUrl,
      url: `${baseUrl}/chat/completions`,
      init,
      resolver: async () => ['93.184.216.34'],
      transport: async () => { contacted = true; return new Response(''); },
    }));
    assert.equal(contacted, false);
  }
});
