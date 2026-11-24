'use strict';

/**
 * The write path under contention.
 *
 * `appendFileSync` with O_APPEND will not interleave the BYTES of one write, but
 * that was never the hazard. The hazard is the HEAD: two processes each hold
 * `this.head` from when they loaded, so both compute `prev` from the same stale
 * value and both append. Every line is intact and the chain is broken — measured
 * at 23 breaks over 120 concurrent appends before the lock went in. Nothing is
 * lost, which is what made it easy to miss: the file looks complete and reads as
 * tampered.
 *
 * The bridge made this newly reachable, because `transfer()` appends a
 * `transfer-out` event to a store it does not own — one another process may well
 * have open.
 *
 * These are the regressions for that, plus the two adjacent holes the fix turned
 * up: a torn tail (appending would glue a record onto a fragment and destroy
 * both) and a stale lock (breaking it is how two writers end up running at once).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  Federation,
  FederationError,
  headFromDisk,
  LOCK_STALE_MS,
  GENESIS,
} = require('../src/federation/store.js');
const { NodeRegistry } = require('../src/federation/nodes.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-lock-'));

function fedWith(dir, ...slugs) {
  const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();
  for (const slug of slugs) nodes.register({ remote: `https://github.com/me/${slug}`, localPath: `/tmp/${slug}` });
  return new Federation(dir, { nodes }).load();
}

const fact = (slug, i) => ({
  shelf: 'operational',
  carrier: 'repair',
  realm: `repo:${slug}`,
  equation: { subject: `repo:${slug}`, predicate: `k${i}`, object: `v${i}` },
  witness: 'structural',
  nodeId: slug,
  reference: `r${i}`,
  target: `repo:${slug}`,
});

// ------------------------------------------------------------------ contention

test('two processes appending to one store keep the chain intact', () => {
  const dir = tmp();
  fedWith(dir, 'w1', 'w2'); // register both, then let the children reopen

  const writer = path.join(dir, 'writer.js');
  fs.writeFileSync(writer, `
    const { Federation, NodeRegistry } = require(${JSON.stringify(path.resolve(__dirname, '../src/federation/index.js'))});
    const dir = ${JSON.stringify(dir)};
    const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();
    const fed = new Federation(dir, { nodes }).load();
    const me = process.argv[2];
    let ok = 0; const refused = [];
    for (let i = 0; i < 60; i++) {
      const r = fed.land({ shelf: 'operational', carrier: 'repair', realm: 'repo:' + me,
        equation: { subject: 'repo:' + me, predicate: 'k' + i, object: 'v' + i },
        witness: 'structural', nodeId: me, reference: 'r' + i, target: 'repo:' + me });
      if (r && r.rejected) refused.push(r.reason); else ok++;
    }
    // The writer REPORTS its refusals. land() returns them instead of throwing,
    // so a writer that ignores the result prints success over zero writes —
    // which is how the first version of this test proved nothing while passing.
    process.stdout.write('ok=' + ok + ':refused=' + refused.length + (refused[0] ? ':' + refused[0] : ''));
  `);

  // Both backgrounded in one shell, then `wait`: genuinely concurrent. A
  // concurrency test that serialises its writers proves nothing.
  const run = spawnSync('/bin/sh', ['-c', `node ${writer} w1 & node ${writer} w2 & wait`], { encoding: 'utf8', timeout: 120000 });
  const m1 = /ok=(\d+):refused=(\d+)/.exec(run.stdout || '');
  assert.ok(m1, `writers did not report: stdout=${run.stdout} stderr=${run.stderr}`);
  assert.equal(m1[1], '60', 'each writer landed all 60');
  assert.equal(m1[2], '0', 'and none were refused');

  const logPath = path.join(dir, 'federation.jsonl');
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length;
  assert.equal(lines, 120, 'no write was lost');

  const reloaded = new Federation(dir).load();
  assert.deepEqual(reloaded.chain.breaks, [], 'and the chain is intact across both writers');
  assert.equal(reloaded.chain.chained, 120);
  assert.equal(reloaded.live().length, 120);
});

test('every line chains to the one physically before it, not to a remembered head', () => {
  const dir = tmp();
  const fed = fedWith(dir, 'w1');
  for (let i = 0; i < 5; i++) fed.land(fact('w1', i));

  const lines = fs.readFileSync(path.join(dir, 'federation.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (let i = 1; i < lines.length; i++) {
    assert.equal(lines[i].prev, lines[i - 1].hash, `line ${i + 1} must chain to line ${i}`);
  }
  assert.equal(lines[0].prev, GENESIS);
});

test('a second store instance appending after the first does not fork the chain', () => {
  const dir = tmp();
  const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();
  nodes.register({ remote: 'https://github.com/me/w1', localPath: '/tmp/w1' });

  // Two handles on one file, both loaded before either writes — the stale-head
  // condition, in one process.
  const a = new Federation(dir, { nodes }).load();
  const b = new Federation(dir, { nodes }).load();
  const headAtLoad = a.head;
  assert.equal(b.head, headAtLoad);

  a.land(fact('w1', 1));
  assert.notEqual(a.head, headAtLoad, 'a moved on');
  assert.equal(b.head, headAtLoad, 'b still remembers the old head...');

  b.land(fact('w1', 2));
  const reloaded = new Federation(dir, { nodes }).load();
  assert.deepEqual(reloaded.chain.breaks, [], '...and its append still chained correctly, because it re-read the head');
  assert.equal(reloaded.chain.chained, 2);
});

// ------------------------------------------------------------------ torn tails

test('a torn tail refuses the append instead of gluing a record onto the fragment', () => {
  const dir = tmp();
  const fed = fedWith(dir, 'w1');
  fed.land(fact('w1', 1));
  const logPath = path.join(dir, 'federation.jsonl');
  const good = fs.readFileSync(logPath, 'utf8');

  // The power went out mid-write.
  fs.writeFileSync(logPath, good + '{"op":"fact","data":{"id":"f_torn","partial":tr');

  assert.throws(
    () => new Federation(dir, { nodes: new NodeRegistry(dir, { gitRemote: () => null }).load() }).land(fact('w1', 2)),
    (e) => e instanceof FederationError && e.field === 'torn-tail',
    'a torn tail is a named refusal, not a repair'
  );

  const after = fs.readFileSync(logPath, 'utf8');
  assert.equal(after, good + '{"op":"fact","data":{"id":"f_torn","partial":tr', 'nothing was appended onto the fragment');
  assert.ok(!after.includes('k2'), 'the new record is not in the file, glued or otherwise');
});

test('headFromDisk reports the true head, and GENESIS for no file', () => {
  const dir = tmp();
  assert.equal(headFromDisk(path.join(dir, 'nope.jsonl')), GENESIS);
  const fed = fedWith(dir, 'w1');
  fed.land(fact('w1', 1));
  assert.equal(headFromDisk(path.join(dir, 'federation.jsonl')), fed.head);
});

// ------------------------------------------------------------------ the lock

test('a successful append leaves no lock behind', () => {
  const dir = tmp();
  const fed = fedWith(dir, 'w1');
  fed.land(fact('w1', 1));
  assert.equal(fs.existsSync(path.join(dir, '.lock')), false, 'the lock is released, not left to go stale');
});

test('a stale lock is reported and NEVER broken', () => {
  const dir = tmp();
  const fed = fedWith(dir, 'w1');
  fed.land(fact('w1', 0)); // so the log exists and `before` is a real count
  const lockPath = path.join(dir, '.lock');
  fs.writeFileSync(lockPath, '999999\n');
  // Backdate it past the staleness window.
  const old = new Date(Date.now() - LOCK_STALE_MS - 60_000);
  fs.utimesSync(lockPath, old, old);

  const logPath = path.join(dir, 'federation.jsonl');
  const count = () => fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length;
  const before = count();
  assert.throws(
    () => fed.land(fact('w1', 1)),
    (e) => e instanceof FederationError && e.field === 'lock-stale',
    'a stale lock is a finding for an operator'
  );
  assert.ok(fs.existsSync(lockPath), 'the lock was NOT deleted to make progress');
  assert.match(fs.readFileSync(lockPath, 'utf8'), /999999/, 'and still names its holder');

  assert.equal(count(), before, 'nothing was appended around it');

  // Once an operator removes it by hand, the store works again.
  fs.unlinkSync(lockPath);
  assert.equal(fed.land(fact('w1', 1)).ok, true);
});

test('a fresh lock is waited for, and released by its holder', () => {
  const dir = tmp();
  const fed = fedWith(dir, 'w1');
  const lockPath = path.join(dir, '.lock');
  fs.writeFileSync(lockPath, '424242\n');

  // A timer cannot release this lock: `land()` blocks the event loop with
  // Atomics.wait, so nothing in THIS process runs while it waits. The holder has
  // to be a real separate process, which is also the honest version of the
  // scenario — the contention is between processes, not callbacks.
  const { spawn } = require('node:child_process');
  const holder = spawn('/bin/sh', ['-c', `sleep 0.4; rm -f ${lockPath}`], { stdio: 'ignore', detached: true });
  holder.unref();

  const started = Date.now();
  const res = fed.land(fact('w1', 1));
  const waited = Date.now() - started;

  assert.equal(res.ok, true, 'the write completed once the other process released');
  assert.ok(waited >= 200, `it actually waited (${waited}ms) rather than breaking the lock`);
  assert.equal(fs.existsSync(lockPath), false, 'and left nothing behind');
  assert.deepEqual(new Federation(dir).load().chain.breaks, []);
});

test('the lock is released even when the write itself fails', () => {
  const dir = tmp();
  const fed = fedWith(dir, 'w1');
  fed.land(fact('w1', 1));
  const logPath = path.join(dir, 'federation.jsonl');

  // Tear the tail so the append throws, then confirm no lock is left holding the
  // store hostage afterwards.
  fs.appendFileSync(logPath, '{"op":"fact","tr');
  assert.throws(() => fed.land(fact('w1', 2)));
  assert.equal(fs.existsSync(path.join(dir, '.lock')), false, 'released in the finally, not leaked');
});
