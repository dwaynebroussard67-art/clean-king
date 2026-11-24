'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { Desk } = require('../src/forge/desk.js');
const { listen, briefing } = require('../src/forge/door.js');
const { Minds, identify, displayName, SHARE_AT } = require('../src/forge/minds.js');
const scan = require('../door/extension/scan.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-minds-'));
const GPT = 'https://chatgpt.com/c/abc123';
const GPT2 = 'https://chatgpt.com/c/def456';
const CLAUDE = 'https://claude.ai/chat/xyz';
const GEMINI = 'https://gemini.google.com/app/1';
const PPLX = 'https://www.perplexity.ai/search/q1?x=1#y';

const fresh = () => new Minds(path.join(tmp(), 'minds'));

test('an AI is its host, and a conversation is its chat address', () => {
  assert.deepEqual(identify(GPT), { ai: 'chatgpt.com', conversation: 'chatgpt.com/c/abc123' });
  assert.deepEqual(identify(PPLX), { ai: 'perplexity.ai', conversation: 'perplexity.ai/search/q1' });
  assert.equal(identify('chrome://extensions'), null);
  assert.equal(identify('not a url'), null);
  assert.equal(displayName('gemini.google.com'), 'Gemini');
  assert.equal(displayName('claude.ai'), 'Claude');
});

test('an AI remembers what it chooses, with no approval, in its own lane', () => {
  const m = fresh();
  const r = m.remember(GPT, ['The user drinks dark roast', 'The user is building Forge Flight']);
  assert.equal(r.results.filter((x) => x.action === 'remembered').length, 2);
  assert.equal(m.liveIn('chatgpt.com').length, 2);
  assert.equal(m.liveIn('claude.ai').length, 0);
});

test("one AI cannot write into, or forget from, another AI's lane", () => {
  const m = fresh();
  m.remember(GPT, ['shared looking fact']);
  const f = m.forget(CLAUDE, ['shared looking fact']);
  assert.equal(f.results[0].action, 'not-yours');
  assert.equal(m.liveIn('chatgpt.com').length, 1);
});

test('the same AI saying it again, in another chat, is still one memory', () => {
  const m = fresh();
  m.remember(GPT, ['likes dark roast']);
  const again = m.remember(GPT2, ['Likes  dark roast.']);
  assert.equal(again.results[0].action, 'already-remembered');
  assert.equal(m.liveIn('chatgpt.com').length, 1);
});

test(`a memory is shared only when ${SHARE_AT} distinct AIs hold it — one AI repeating does not count`, () => {
  const m = fresh();
  m.remember(GPT, ['the user lives in Baton Rouge']);
  m.remember(GPT2, ['the user lives in Baton Rouge']);
  m.remember(CLAUDE, ['The user lives in Baton Rouge.']);
  assert.equal(m.shared().length, 0, 'two distinct AIs is not enough');
  m.remember(GEMINI, ['the user lives in baton rouge']);
  const [s] = m.shared();
  assert.ok(s);
  assert.deepEqual(s.ais, ['chatgpt.com', 'claude.ai', 'gemini.google.com']);
});

test('forgetting drops it from that AI and can un-share it', () => {
  const m = fresh();
  for (const u of [GPT, CLAUDE, GEMINI]) m.remember(u, ['works nights']);
  assert.equal(m.shared().length, 1);
  m.forget(GEMINI, ['works nights']);
  assert.equal(m.liveIn('gemini.google.com').length, 0);
  assert.equal(m.shared().length, 0);
  assert.equal(m.pool()[0].ais.length, 2, 'the pool still holds the other two');
});

test('a human retract is recorded as the human, not as the AI forgetting', () => {
  const m = fresh();
  const { results: [r] } = m.remember(CLAUDE, ['something wrong']);
  const x = m.retract(r.id);
  assert.equal(x.action, 'retracted');
  const ev = m.events.at(-1);
  assert.equal(ev.op, 'retract');
  assert.equal(ev.by, 'human');
  assert.equal(m.liveIn('claude.ai').length, 0);
});

test('the ledger knows which conversation went to which AI', () => {
  const m = fresh();
  m.link(GPT); m.remember(GPT, ['a']);
  m.link(CLAUDE); m.remember(CLAUDE, ['b']); m.remember(CLAUDE, ['c']);
  const convs = m.conversations();
  const claude = convs.find((c) => c.conversation === 'claude.ai/chat/xyz');
  assert.equal(claude.ai, 'claude.ai');
  assert.equal(claude.remembered, 2);
  const roster = m.roster();
  assert.deepEqual(roster.map((r) => r.ai).sort(), ['chatgpt.com', 'claude.ai']);
});

test('nothing is deleted and the chain catches an edit', () => {
  const m = fresh();
  m.remember(GPT, ['one']);
  m.forget(GPT, ['one']);
  assert.equal(m.events.length, 2);
  assert.equal(m.verify().ok, true);
  const raw = fs.readFileSync(m.file, 'utf8').replace('"one"', '"two"');
  fs.writeFileSync(m.file, raw);
  const v = new Minds(m.dir).verify();
  assert.equal(v.ok, false);
  assert.equal(v.breaks[0].kind, 'hash-mismatch');
});

test("each AI is briefed with its own lane, never another AI's private one", () => {
  const dir = tmp();
  const desk = new Desk(dir, { slug: 'demo', realm: 'repo:demo' });
  desk.save('I drink dark roast');
  const m = new Minds(path.join(dir, 'minds'));
  m.remember(GPT, ['ChatGPT private note']);
  m.remember(CLAUDE, ['Claude private note']);
  for (const u of [GPT, CLAUDE, GEMINI]) m.remember(u, ['common ground']);

  const forClaude = briefing(desk, { minds: m, url: CLAUDE });
  assert.match(forClaude, /^\[Forge Federation link\]\nYou are Claude, and you can save memories\.\n/);
  assert.match(forClaude, /- I drink dark roast/);
  assert.match(forClaude, /- Claude private note/);
  assert.doesNotMatch(forClaude, /ChatGPT private note/);
  assert.match(forClaude, /You decide what to remember\. Nobody approves it\./);

  const forPplx = briefing(desk, { minds: m, url: PPLX });
  assert.match(forPplx, /common ground \(3 AIs\)/, 'a new AI still gets what is shared');
  assert.doesNotMatch(forPplx, /private note/);
});

test('door: AI remember goes to the pool, human remember goes to the passport', async () => {
  const dir = tmp();
  const desk = new Desk(dir, { slug: 'demo', realm: 'repo:demo' });
  const minds = new Minds(path.join(dir, 'minds'));
  const TOKEN = 'c'.repeat(48);
  const server = await listen({ desk, token: TOKEN, minds, port: 0 });
  const port = server.address().port;
  const call = (method, p, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'x-forge-door': TOKEN, 'content-type': 'application/json' } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s) }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
  try {
    const link = await call('GET', `/link?url=${encodeURIComponent(GPT)}`);
    assert.equal(link.body.ai, 'chatgpt.com');
    assert.equal(link.body.name, 'Chatgpt');

    const ai = await call('POST', '/remember', { facts: ['user works nights'], url: GPT, by: 'ai' });
    assert.equal(ai.body.results[0].action, 'remembered');
    assert.equal(desk.passport.live().length, 0, 'an AI choice does not touch the human passport');

    const human = await call('POST', '/remember', { facts: ['I drink dark roast'], url: GPT, by: 'human' });
    assert.equal(human.body.saved.length, 1);

    const forgot = await call('POST', '/forget', { facts: ['user works nights'], url: GPT });
    assert.equal(forgot.body.results[0].action, 'forgotten');

    const id = (await call('POST', '/remember', { facts: ['wrong thing'], url: CLAUDE, by: 'ai' })).body.results[0].id;
    assert.equal((await call('POST', '/retract', { id })).body.action, 'retracted');

    const summary = await call('GET', '/minds');
    assert.equal(summary.body.chain.ok, true);
    assert.deepEqual(summary.body.roster.map((r) => r.ai).sort(), ['chatgpt.com', 'claude.ai']);
    assert.ok(summary.body.conversations.find((c) => c.conversation === 'chatgpt.com/c/abc123'));

    assert.equal((await call('POST', '/remember', { facts: ['x'], url: 'chrome://newtab', by: 'ai' })).status, 400);
  } finally { await new Promise((r) => server.close(r)); }
});

test('scan reads FORGET too, and ignores both placeholders', () => {
  const page = ['REMEMBER: <the thing>', 'FORGET: <the thing>', 'REMEMBER: likes tea', 'FORGET: likes coffee'].join('\n');
  assert.deepEqual(scan.lines(page), { remember: ['likes tea'], forget: ['likes coffee'] });
  const f = scan.fresh(page, { known: ['likes tea'], handled: { remember: [], forget: ['likes coffee'] } });
  assert.deepEqual(f, { remember: [], forget: [] });
});

test('two AIs remembering the same thing at the same instant get separate ids', () => {
  const m = fresh();
  const at = '2026-10-23T12:00:00.000Z';
  const a = m.remember(GPT, ['same instant'], { at }).results[0].id;
  const b = m.remember(CLAUDE, ['same instant'], { at }).results[0].id;
  assert.notEqual(a, b);
  m.forget(GPT, ['same instant']);
  assert.equal(m.liveIn('claude.ai').length, 1);
});
