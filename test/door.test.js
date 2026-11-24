'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { Desk } = require('../src/forge/desk.js');
const { listen, loadOrCreateToken, hostIsLoopback, briefing } = require('../src/forge/door.js');
const { Minds } = require('../src/forge/minds.js');
const scan = require('../door/extension/scan.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-door-'));
const TOKEN = 'a'.repeat(48);

function newDesk(dir = tmp()) {
  return new Desk(dir, { slug: 'demo', realm: 'repo:demo', fetch: async () => { throw new Error('offline'); } });
}

async function open() {
  const dir = tmp();
  const desk = newDesk(dir);
  const minds = new Minds(path.join(dir, 'hub', 'minds'));
  const server = await listen({ desk, token: TOKEN, minds, port: 0 });
  const port = server.address().port;
  const call = (method, pathname, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s ? JSON.parse(s) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
  const authed = { 'x-forge-door': TOKEN, 'content-type': 'application/json' };
  return { dir, desk, minds, server, call, authed, close: () => new Promise((r) => server.close(r)) };
}

test('door listens on loopback only', async () => {
  const d = await open();
  try { assert.equal(d.server.address().address, '127.0.0.1'); } finally { await d.close(); }
});

test('health answers without a pairing code and says nothing else', async () => {
  const d = await open();
  try {
    const r = await d.call('GET', '/health');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['door', 'ok', 'version']);
  } finally { await d.close(); }
});

test('link and remember refuse a missing or wrong pairing code', async () => {
  const d = await open();
  try {
    assert.equal((await d.call('GET', '/link')).status, 401);
    assert.equal((await d.call('GET', '/link', { headers: { 'x-forge-door': 'b'.repeat(48) } })).status, 401);
    assert.equal((await d.call('POST', '/remember', { headers: { 'content-type': 'application/json' }, body: { facts: ['x'] } })).status, 401);
    assert.equal(d.desk.passport.live().length, 0);
  } finally { await d.close(); }
});

test('a web page is refused even holding the right code, and gets no CORS header', async () => {
  const d = await open();
  try {
    for (const origin of ['https://chatgpt.com', 'https://evil.example', 'http://127.0.0.1:4747', 'null']) {
      const r = await d.call('POST', '/remember', { headers: { ...d.authed, origin }, body: { facts: ['planted'] } });
      assert.equal(r.status, 403, origin);
      assert.equal(r.headers['access-control-allow-origin'], undefined);
    }
    assert.equal(d.desk.passport.live().length, 0);
  } finally { await d.close(); }
});

test('the extension origin is let in', async () => {
  const d = await open();
  try {
    const r = await d.call('GET', '/link', { headers: { ...d.authed, origin: 'chrome-extension://abcdefghijklmnop' } });
    assert.equal(r.status, 200);
  } finally { await d.close(); }
});

test('a non-loopback Host header is refused (DNS rebinding)', async () => {
  const d = await open();
  try {
    const r = await d.call('GET', '/link', { headers: { ...d.authed, host: 'attacker.example:4848' } });
    assert.equal(r.status, 403);
    assert.equal(hostIsLoopback('localhost:4848'), true);
    assert.equal(hostIsLoopback('[::1]:4848'), true);
    assert.equal(hostIsLoopback('127.0.0.1.evil.example'), false);
  } finally { await d.close(); }
});

test('remember lands in the chain as a human-witnessed memory and rewrites PASSPORT.md', async () => {
  const d = await open();
  try {
    const r = await d.call('POST', '/remember', { headers: d.authed, body: { facts: ['I drink dark roast'], source: 'chatgpt.com' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.saved.length, 1);
    const lines = fs.readFileSync(d.desk.passport.memoriesPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].data.witnesses[0].kind, 'human');
    assert.match(lines[0].data.witnesses[0].reference, /^door:chatgpt\.com:/);
    assert.match(fs.readFileSync(d.desk.passport.docPath, 'utf8'), /I drink dark roast/);
  } finally { await d.close(); }
});

test('link carries the memories and the REMEMBER rule, not the repository evidence', async () => {
  const d = await open();
  try {
    d.desk.save('I drink dark roast');
    const r = await d.call('GET', '/link', { headers: d.authed });
    assert.equal(r.status, 200);
    assert.match(r.body.text, /^\[Forge Federation link\]/);
    assert.match(r.body.text, /REMEMBER: <the thing>/);
    assert.match(r.body.text, /- I drink dark roast/);
    assert.doesNotMatch(r.body.text, /Evidence index/);
    assert.deepEqual(r.body.memories, ['I drink dark roast']);
  } finally { await d.close(); }
});

test('the door sees a save the desk made after it opened, without duplicating evidence', async () => {
  const d = await open();
  try {
    const other = newDesk(d.dir);
    other.save('second desk wrote this');
    const evBefore = d.desk.passport.evidence.length;
    await d.call('GET', '/link', { headers: d.authed });
    const r = await d.call('GET', '/link', { headers: d.authed });
    assert.ok(r.body.memories.includes('second desk wrote this'));
    assert.equal(d.desk.passport.evidence.length, evBefore);
  } finally { await d.close(); }
});

test('empty, oversized and over-long requests are bounded', async () => {
  const d = await open();
  try {
    assert.equal((await d.call('POST', '/remember', { headers: d.authed, body: { facts: [] } })).status, 400);
    assert.equal((await d.call('POST', '/remember', { headers: d.authed, body: 'x'.repeat(70 * 1024) })).status, 413);
    const many = Array.from({ length: 30 }, (_, i) => `fact number ${i}`);
    const r = await d.call('POST', '/remember', { headers: d.authed, body: { facts: many } });
    assert.equal(r.body.saved.length, 20);
  } finally { await d.close(); }
});

test('the pairing code is created once, kept out of the repo, and reused', () => {
  const file = path.join(tmp(), 'hub', 'door.token');
  const a = loadOrCreateToken(file);
  const b = loadOrCreateToken(file);
  assert.match(a, /^[a-f0-9]{48}$/);
  assert.equal(a, b);
});

test('scan finds REMEMBER lines, ignores the placeholder, and skips what is known', () => {
  const page = [
    'REMEMBER: <one short fact>',
    'Sure, noted.',
    '**REMEMBER:** I drink dark roast',
    'REMEMBER: works nights',
    'remember: works nights',
    'Not a remember line',
  ].join('\n');
  assert.deepEqual(scan.rememberLines(page), ['I drink dark roast', 'works nights']);
  assert.deepEqual(scan.newFacts(page, { known: ['i drink dark roast'] }), ['works nights']);
  assert.deepEqual(scan.newFacts(page, { baseline: ['works nights'], offered: ['I drink dark roast'] }), []);
});

test('briefing is safe with an empty passport and no pool', () => {
  const desk = newDesk();
  assert.match(briefing(desk), /\(nothing yet\)/);
});

test('the desk binds loopback by default and no longer sends a wildcard CORS header', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'desk.js'), 'utf8');
  assert.match(src, /FORGE_DESK_HOST \|\| '127\.0\.0\.1'/);
  assert.doesNotMatch(src, /access-control-allow-origin/);
});
