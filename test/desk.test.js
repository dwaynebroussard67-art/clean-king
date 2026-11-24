'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Desk, extractSaves, trimMemory, speakable } = require('../src/forge/desk.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-desk-'));
const nl = (...lines) => lines.join('\n');

function open(extra = {}) {
  const dir = tmp();
  const desk = new Desk(dir, {
    slug: 'demo',
    realm: 'repo:demo',
    fetch: async () => { throw new Error('offline'); },
    ...extra,
  });
  return { dir, desk };
}

test('remember from the human line is extracted', () => {
  assert.deepEqual(extractSaves('remember I drink dark roast', ''), ['I drink dark roast']);
  assert.deepEqual(extractSaves('What is coffee?', nl('REMEMBER: they like dark roast', 'Sure.')), ['they like dark roast']);
  assert.deepEqual(extractSaves('hello', 'hi'), []);
});

test('over-long memories are trimmed at a word', () => {
  const long = `remember ${'word '.repeat(200)}`;
  const [one] = extractSaves(long, '');
  assert.ok(one.length <= 450);
  assert.equal(one.endsWith('word'), true);
});

test('a save is written into PASSPORT.md', () => {
  const { desk } = open();
  const res = desk.save('I drink dark roast');
  assert.equal(res.rejected, undefined);
  const md = fs.readFileSync(desk.passport.docPath, 'utf8');
  assert.match(md, /I drink dark roast/);
  assert.equal(desk.recall('dark')[0].proposition, 'I drink dark roast');
});

test('turn without a model still saves remember …', async () => {
  const { desk } = open();
  const out = await desk.turn('remember the test command is npm test');
  assert.equal(out.ok, true);
  assert.deepEqual(out.saved, ['the test command is npm test']);
  assert.match(desk.boot(), /the test command is npm test/);
});

test('turn with an injected model saves REMEMBER lines and not questions', async () => {
  const { desk } = open({
    generate: async ({ boot, text }) => {
      assert.match(boot, /Passport/);
      if (/coffee/i.test(text)) return nl('Got it.', 'REMEMBER: they prefer dark roast');
      return 'I do not know that.';
    },
  });
  const a = await desk.turn('I prefer dark roast coffee');
  assert.deepEqual(a.saved, ['they prefer dark roast']);
  const b = await desk.turn('what do I drink?');
  assert.deepEqual(b.saved, []);
  assert.match(b.reply, /do not know|dark roast/i);
});

test('trimMemory is a no-op under the cap', () => {
  assert.equal(trimMemory('  short  '), 'short');
});

test('the speaker does not read REMEMBER lines', () => {
  assert.equal(speakable(nl('Got it.', 'REMEMBER: they prefer dark roast', 'See you.')), nl('Got it.', 'See you.'));
});

test('turn returns speak without the tool line', async () => {
  const { desk } = open({
    generate: async () => nl('Saved in my head.', 'REMEMBER: the sky is blue'),
  });
  const out = await desk.turn('the sky is blue');
  assert.equal(out.speak, 'Saved in my head.');
  assert.match(out.reply, /REMEMBER/);
});
