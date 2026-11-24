'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Desk } = require('../src/forge/desk.js');
const { Minds } = require('../src/forge/minds.js');
const talk = require('../src/forge/talk.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-talk-'));
const fresh = () => new Minds(path.join(tmp(), 'minds'));
const desk = () => new Desk(tmp(), { slug: 'demo', realm: 'repo:demo', fetch: async () => { throw new Error('offline'); } });

/** A fake OpenAI-compatible server that plays back a script of replies. */
function server(script) {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    seen.push(body);
    const step = script.shift();
    if (typeof step === 'function') return step(body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: step }] }) };
  };
  return { fetchImpl, seen };
}
const call = (name, args, id = 'c1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('each local model is its own AI, named for the model', () => {
  assert.deepEqual(talk.whoIs('qwen3:8b'), { ai: 'qwen3-8b.local', name: 'Qwen3-8b' });
  assert.equal(talk.whoIs('llama3.1:8b').ai, 'llama3-1-8b.local');
  assert.notEqual(talk.whoIs('qwen3:8b').ai, talk.whoIs('qwen3:4b').ai);
  assert.equal(talk.aiUrl('qwen3:8b', 'abc'), 'http://qwen3-8b.local/chat/abc');
});

test('the model saves with a tool call, by its own choice, then answers', async () => {
  const minds = fresh();
  const s = server([
    { content: '', tool_calls: [call('remember', { fact: 'Dwayne drinks dark roast' })] },
    { content: 'Noted.' },
  ]);
  const r = await talk.turn({ minds, desk: desk(), model: 'qwen3:8b', chatId: 'a', text: 'I drink dark roast', fetchImpl: s.fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'Noted.');
  assert.equal(r.events[0].kind, 'remembered');
  assert.deepEqual(minds.liveIn('qwen3-8b.local').map((m) => m.fact), ['Dwayne drinks dark roast']);
  assert.ok(s.seen[0].tools.some((t) => t.function.name === 'remember'));
  assert.equal(s.seen[1].messages.at(-1).role, 'tool');
  assert.match(s.seen[1].messages.at(-1).content, /^Saved to your memory/);
});

test('a new conversation starts with what it kept, without pasting anything', async () => {
  const minds = fresh();
  minds.remember(talk.aiUrl('qwen3:8b', 'old'), ['Dwayne drinks dark roast']);
  const s = server([{ content: 'Dark roast.' }]);
  await talk.turn({ minds, desk: desk(), model: 'qwen3:8b', chatId: 'new', text: 'What do I drink?', fetchImpl: s.fetchImpl });
  const sys = s.seen[0].messages[0];
  assert.equal(sys.role, 'system');
  assert.match(sys.content, /^You are Qwen3-8b, and you can save memories\./);
  assert.match(sys.content, /- Dwayne drinks dark roast/);
  assert.equal(s.seen[0].messages.at(-1).content, 'What do I drink?');
});

test('one model cannot read another model\'s private memory', async () => {
  const minds = fresh();
  minds.remember(talk.aiUrl('llama3.1:8b', 'x'), ['llama private note']);
  const s = server([
    { content: '', tool_calls: [call('recall', { query: 'private note' })] },
    { content: 'Nothing.' },
  ]);
  await talk.turn({ minds, desk: desk(), model: 'qwen3:8b', chatId: 'y', text: 'any notes?', fetchImpl: s.fetchImpl });
  assert.doesNotMatch(s.seen[0].messages[0].content, /llama private note/);
  assert.equal(s.seen[1].messages.at(-1).content, 'Nothing found.');
});

test('recall finds its own memories with ids, and forget by id drops only its own', async () => {
  const minds = fresh();
  minds.remember(talk.aiUrl('qwen3:8b', 'o'), ['Dog is named Littlefoot', 'Lives in Baton Rouge']);
  minds.remember(talk.aiUrl('llama3.1:8b', 'o'), ['Dog is named Littlefoot']);
  const ctx = { minds, desk: desk(), model: 'qwen3:8b', chatId: 'z' };
  const found = talk.runTool(ctx, call('recall', { query: 'dog' }));
  const id = found.content.match(/\[(mind_[a-f0-9]+)\] Dog is named Littlefoot/)[1];
  const gone = talk.runTool(ctx, call('forget', { id }));
  assert.equal(gone.event.kind, 'forgot');
  assert.deepEqual(minds.liveIn('qwen3-8b.local').map((m) => m.fact), ['Lives in Baton Rouge']);
  assert.equal(minds.liveIn('llama3-1-8b.local').length, 1);
  const other = minds.liveIn('llama3-1-8b.local')[0].id;
  assert.match(talk.runTool(ctx, call('forget', { id: other })).content, /No memory of yours/);
});

test('a model without tools falls back to REMEMBER lines, hidden from the reply', async () => {
  const minds = fresh();
  const s = server([
    async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"registry.ollama.ai/library/gemma3 does not support tools"}}' }),
    { content: 'Got it.\nREMEMBER: Dwayne likes jazz' },
  ]);
  const r = await talk.turn({ minds, desk: desk(), model: 'gemma3', chatId: 'g', text: 'I like jazz', fetchImpl: s.fetchImpl });
  assert.equal(r.tools, false);
  assert.equal(r.reply, 'Got it.');
  assert.equal(s.seen[1].tools, undefined);
  assert.match(s.seen[1].messages[0].content, /REMEMBER: <fact>/);
  assert.deepEqual(minds.liveIn('gemma3.local').map((m) => m.fact), ['Dwayne likes jazz']);
});

test('thinking is not shown, and a dead server is a plain error', async () => {
  assert.equal(talk.visible('<think>hmm</think>\nHello'), 'Hello');
  const minds = fresh();
  const s = server([async () => ({ ok: false, status: 404, text: async () => '{"error":{"message":"model not found"}}' })]);
  const r = await talk.turn({ minds, desk: desk(), model: 'nope', chatId: 'n', text: 'hi', fetchImpl: s.fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.error, /404: model not found/);
  const m = await talk.models({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.match(m.error, /Is Ollama running/);
});

test('the ledger records which conversation went to which model, once per chat', async () => {
  const minds = fresh();
  const s = server([{ content: 'a' }, { content: 'b' }]);
  await talk.turn({ minds, desk: desk(), model: 'qwen3:8b', chatId: 'c1', text: 'hi', fetchImpl: s.fetchImpl });
  await talk.turn({ minds, desk: desk(), model: 'qwen3:8b', chatId: 'c1', history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'a' }], text: 'again', fetchImpl: s.fetchImpl });
  const convs = minds.conversations();
  assert.equal(convs.length, 1);
  assert.equal(convs[0].conversation, 'qwen3-8b.local/chat/c1');
  assert.equal(minds.events.filter((e) => e.op === 'link').length, 1);
});

test('thinking is off unless asked for, and a server that rejects it is asked again', async () => {
  const minds = fresh();
  const s = server([{ content: 'hi' }]);
  await talk.turn({ minds, desk: desk(), model: 'qwen3.5:4b', chatId: 't1', text: 'hello', fetchImpl: s.fetchImpl });
  assert.equal(s.seen[0].reasoning_effort, 'none');
  const s2 = server([{ content: 'hi' }]);
  await talk.turn({ minds, desk: desk(), model: 'qwen3.5:4b', chatId: 't2', text: 'hello', fetchImpl: s2.fetchImpl, think: true });
  assert.equal(s2.seen[0].reasoning_effort, undefined);
  const s3 = server([
    () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'unknown field reasoning_effort' } }) }),
    { content: 'ok' },
  ]);
  const r = await talk.turn({ minds, desk: desk(), model: 'm', chatId: 't3', text: 'hello', fetchImpl: s3.fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'ok');
  assert.equal(s3.seen[1].reasoning_effort, undefined);
});
