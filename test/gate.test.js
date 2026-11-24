'use strict';

/**
 * The gate. A human is always the last step, and this file is the proof.
 *
 * The interesting assertions here are the negative ones: that an agent CANNOT
 * commit, CANNOT push, and CANNOT promote its own self-reported outcome into
 * the commons — and that every refusal is NAMED, so an agent can tell the
 * difference between "not yet" and "never".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Gate, OperatorStore, ReleaseQueue, PROMOTE_AFTER } = require('../src/federation/gate.js');
const { LinkServer } = require('../src/federation/serve.js');
const { Federation, NodeRegistry } = require('../src/federation/index.js');
const { RepoPassport } = require('../src/passport/passport.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-gate-'));

function world() {
  const dir = tmp();
  const registry = new NodeRegistry(dir, { gitRemote: () => null }).load();
  registry.register({ remote: 'https://github.com/owner/twld', localPath: '/tmp/twld' });
  const federation = new Federation(dir, { nodes: registry }).load();
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-repo-'));
  const passport = new RepoPassport(repoDir, { realm: 'repo:twld', slug: 'twld', remote: 'https://github.com/owner/twld' }).init({ name: 'twld' });
  const gate = new Gate(dir, { delegation: 'ask' });
  const server = new LinkServer(dir, { federation, registry, passports: new Map([['repo:twld', passport]]), gate }).load();
  return { dir, registry, federation, passport, gate, server };
}

const ask = (server, req) => server.request({ from: 'repo:twld', ...req });

test('no operator configured means nothing releases — fail closed', () => {
  const { gate, server } = world();
  assert.equal(gate.operators.hasOperators(), false);

  const res = ask(server, { kind: 'tool', name: 'git.commit' });
  assert.equal(res.status, 'deferred');
  assert.equal(res.reason, 'needs-human-release');

  // The release is refused, and the refusal names the real problem.
  const rel = gate.release(res.ticket.id, { actor: 'somebody' });
  assert.equal(rel.ok, false);
  assert.equal(rel.reason, 'no-operators-configured');
});

test('a name on disk is a memory, not a session — sign-in is per launch', () => {
  const { gate, server } = world();
  gate.operators.configure(['dwayne']);
  assert.equal(gate.operators.hasOperators(), true);

  const res = ask(server, { kind: 'tool', name: 'git.commit' });
  const rel = gate.release(res.ticket.id, { actor: 'dwayne' });
  assert.equal(rel.ok, false);
  assert.equal(rel.reason, 'not-signed-in', 'configuring is not signing');

  assert.equal(gate.operators.signIn('mallory').ok, false);
  assert.equal(gate.operators.signIn('dwayne').ok, true);

  const rel2 = gate.release(res.ticket.id, { actor: 'dwayne' });
  assert.equal(rel2.ok, true);
  assert.equal(rel2.ticket.status, 'released');
  assert.equal(rel2.ticket.decidedBy, 'dwayne');
});

test('an agent cannot commit, push, or self-promote an outcome', () => {
  const { gate, server } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  for (const name of ['git.commit', 'git.push']) {
    const res = ask(server, { kind: 'tool', name });
    assert.equal(res.status, 'deferred', `${name} must never be granted on request`);
    assert.equal(res.reason, 'needs-human-release');
  }

  const mem = ask(server, { kind: 'remember', arg: { proposition: 'the deploy worked', witness: 'outcome', reference: 'req:1' } });
  assert.equal(mem.status, 'deferred');
  assert.equal(mem.reason, 'outcome-needs-replication');
});

test('the hub ignores a supplied actor — identity comes from the session', () => {
  const { gate, server } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  const res = ask(server, { kind: 'tool', name: 'git.push' });
  // A renderer-supplied actor is void by design; the signature is dwayne's.
  const rel = gate.release(res.ticket.id, { actor: 'mallory', note: 'let me through' });
  assert.equal(rel.ok, true);
  assert.equal(rel.ticket.decidedBy, 'dwayne');
  assert.notEqual(rel.ticket.decidedBy, 'mallory');
});

test('reads and structural evidence are granted without a human', () => {
  const { server } = world();
  const read = ask(server, { kind: 'tool', name: 'repo.read_file' });
  assert.equal(read.status, 'granted');

  const ev = ask(server, {
    kind: 'evidence',
    arg: { category: 'structure', subject: 'repo', detail: '11 files', witness: { kind: 'structural', ref: 'sha256:abc' } },
  });
  assert.equal(ev.status, 'granted', 'evidence is re-derivable, so it needs no permission');
});

test('a refusal blocks that shape permanently — the lock cannot be picked by asking again', () => {
  const { gate, server } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  const req = { from: 'repo:twld', kind: 'tool', name: 'git.commit' };
  const shape = ReleaseQueue.shapeOf(req);

  const first = server.request(req);
  gate.release(first.ticket.id, { actor: 'dwayne' });
  const second = server.request(req);
  gate.release(second.ticket.id, { actor: 'dwayne' });
  assert.equal(gate.queue.shapes.get(shape).approvals, 2);

  const third = server.request(req);
  gate.refuse(third.ticket.id, { actor: 'dwayne', note: 'not on main' });
  assert.equal(gate.queue.shapes.get(shape).rejections, 1);

  // Even after many more approvals, one refusal means never.
  for (let i = 0; i < 10; i++) {
    const r = server.request(req);
    if (r.ticket && !r.duplicate) gate.release(r.ticket.id, { actor: 'dwayne' });
  }
  assert.equal(gate.queue.earned(shape), false, 'a shape with a refusal never earns delegation');
});

test('delegation `earned` releases a shape approved five times with zero refusals', () => {
  const { gate, server } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');
  gate.setDelegation('ask');

  const req = { from: 'repo:twld', kind: 'tool', name: 'git.commit' };

  // Five approvals under `ask`: every one still waits, because the bar is on
  // the SHAPE, not on the current request.
  for (let i = 0; i < PROMOTE_AFTER; i++) {
    const r = server.request(req);
    assert.equal(r.status, 'deferred', `approval ${i + 1} should still wait`);
    gate.release(r.ticket.id, { actor: 'dwayne' });
  }
  assert.equal(gate.queue.shapes.get(ReleaseQueue.shapeOf(req)).approvals, PROMOTE_AFTER);

  gate.setDelegation('earned');
  const now = server.request(req);
  assert.equal(now.status, 'granted');
  assert.equal(now.releasedBy, 'delegation:earned');
  assert.equal(now.ticket.status, 'released');
  // The human is still named in the record — the machine did not authorize itself.
  assert.equal(now.ticket.decidedBy, 'delegation:earned');
  assert.ok(now.ticket.note.includes('zero refusals'));
});

test('delegation `sealed` defers even a read; `none` refuses everything', () => {
  const { gate, server } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  gate.setDelegation('sealed');
  const read = ask(server, { kind: 'tool', name: 'repo.read_file' });
  assert.equal(read.status, 'deferred', 'sealed means everything waits');

  gate.setDelegation('none');
  const anything = ask(server, { kind: 'tool', name: 'repo.grep' });
  assert.equal(anything.status, 'refused');
  assert.equal(anything.reason, 'gate-closed');
});

test('every request is logged, and the log is chained', () => {
  const { dir, server } = world();
  ask(server, { kind: 'tool', name: 'repo.read_file' });
  ask(server, { kind: 'tool', name: 'git.commit' });
  ask(server, { kind: 'nonsense' });

  const lines = fs.readFileSync(path.join(dir, 'requests.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);

  const reloaded = new LinkServer(dir, {}).load();
  assert.equal(reloaded.requests.length, 3);
  assert.deepEqual(
    reloaded.requests.map((r) => r.status),
    ['granted', 'deferred', 'refused']
  );
});

test('an unregistered realm cannot ask at all', () => {
  const { server } = world();
  const res = server.request({ from: 'repo:stranger', kind: 'context' });
  assert.equal(res.status, 'refused');
  assert.equal(res.reason, 'unregistered-realm');
});

test('a duplicate of an open ticket is not filed twice', () => {
  const { gate, server } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');
  const req = { from: 'repo:twld', kind: 'tool', name: 'git.commit' };

  const a = server.request(req);
  const b = server.request(req);
  assert.equal(b.duplicate, true);
  assert.equal(b.ticket.id, a.ticket.id);
  assert.equal(gate.queue.open().length, 1, 'asking twice does not speed it up');
});
