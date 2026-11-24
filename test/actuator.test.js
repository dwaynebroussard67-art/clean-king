'use strict';

/**
 * The actuator: the part that actually touches a repository.
 *
 * These tests build REAL git repositories with REAL test suites, because a
 * referee that has not run anything has not refereed anything. The important
 * assertions are the refusals — that the machine will not commit red, will
 * not push a branch it does not own, and will not act on a signature it can
 * no longer vouch for.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { Actuator, FORGE_PREFIX } = require('../src/federation/actuator.js');
const { Gate } = require('../src/federation/gate.js');
const { LinkServer } = require('../src/federation/serve.js');
const { Federation, NodeRegistry } = require('../src/federation/index.js');
const { ToolRegistry } = require('../src/federation/serve.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-act-'));

const git = (cwd, args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};

/** A real repository with a real test suite that passes or fails. */
function makeRepo({ passing = true, testScript = 'node --test' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-repo-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { test: testScript } }, null, 2));
  fs.mkdirSync(path.join(dir, 'test'));
  // Real newlines. A file that does not parse is not a failing test, and
  // `node --test` on an unparseable file can exit 0 — which would let a
  // broken suite be committed as green.
  const body = [
    "'use strict';",
    "const t = require('node:test');",
    "const a = require('node:assert');",
    passing
      ? "t('works', () => a.equal(1, 1));"
      : "t('broken', () => a.equal(1, 2));",
    "",
  ].join(String.fromCharCode(10));
  fs.writeFileSync(path.join(dir, 'test', 'basic.test.js'), body);

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'fed@forge.test']);
  git(dir, ['config', 'user.name', 'Forge Federation']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'initial']);
  return dir;
}

function world({ passing = true, testScript = 'node --test' } = {}) {
  const dir = tmp();
  const repoDir = makeRepo({ passing, testScript });
  const registry = new NodeRegistry(dir, { gitRemote: () => 'https://github.com/owner/demo' }).load();
  registry.register({ remote: 'https://github.com/owner/demo', localPath: repoDir });
  const federation = new Federation(dir, { nodes: registry }).load();
  const gate = new Gate(dir, { delegation: 'ask' });
  const tools = new ToolRegistry();
  const server = new LinkServer(dir, { federation, registry, passports: new Map(), gate }).load();
  const actuator = new Actuator(dir, { gate, registry, tools }).load();
  return { dir, repoDir, registry, federation, gate, server, actuator };
}

/** Ask, release, and return the released ticket. */
function askAndRelease(server, gate, req, note) {
  const r = server.request({ from: 'repo:demo', ...req });
  if (r.status !== 'deferred') return { asked: r, ticket: null };
  const rel = gate.release(r.ticket.id, { actor: 'dwayne', note });
  return { asked: r, released: rel, ticket: r.ticket };
}

test('a released commit runs, and lands on a forge/* branch', async () => {
  const { repoDir, gate, server, actuator } = world({ passing: true });
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  // The agent works in the worktree, never in the person's checkout.
  const wrote = await actuator.invoke({ from: 'repo:demo', tool: 'repo.write_file', arg: { path: 'feature.txt', content: 'hello\n' } });
  assert.equal(wrote.ok, true, JSON.stringify(wrote));

  const { ticket } = askAndRelease(server, gate, { kind: 'tool', name: 'git.commit' }, 'ship it');
  const res = await actuator.invoke({ from: 'repo:demo', tool: 'git.commit', ticket: ticket.id });

  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.sha, 'a commit sha came back');
  assert.ok(res.branch.startsWith(FORGE_PREFIX), `landed on ${res.branch}`);
  assert.ok(res.files.includes('feature.txt'));

  // The commit exists, and it is on the forge branch, not on main.
  const onBranch = git(repoDir, ['show', '--stat', '--oneline', res.sha]);
  assert.equal(onBranch.code, 0);
  const mainHead = git(repoDir, ['rev-parse', 'main']).out;
  assert.notEqual(res.sha, mainHead, 'main did not move');
  // The operator is named in the commit message.
  const msg = git(repoDir, ['log', '-1', '--format=%B', res.sha]).out;
  assert.ok(msg.includes('dwayne'), 'the human is named in the commit');
  assert.ok(msg.includes(ticket.id), 'the ticket is named in the commit');
});

test('nothing commits red — the build is the referee', async () => {
  const { repoDir, gate, server, actuator } = world({ passing: false });
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  await actuator.invoke({ from: 'repo:demo', tool: 'repo.write_file', arg: { path: 'feature.txt', content: 'hello\n' } });
  const { ticket } = askAndRelease(server, gate, { kind: 'tool', name: 'git.commit' });
  const res = await actuator.invoke({ from: 'repo:demo', tool: 'git.commit', ticket: ticket.id });

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'tests-red');
  assert.ok(res.detail.includes('Nothing commits red'));
  assert.ok(res.verdict, 'the verdict is returned, not swallowed');
});

test('a repository with no test command is refused, not guessed at', async () => {
  const { dir, repoDir, registry, gate, server, actuator } = world();
  fs.unlinkSync(path.join(repoDir, 'package.json'));
  fs.rmSync(path.join(repoDir, 'test'), { recursive: true, force: true });
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');
  void dir; void registry;

  const { ticket } = askAndRelease(server, gate, { kind: 'tool', name: 'git.commit' });
  const res = await actuator.invoke({ from: 'repo:demo', tool: 'git.commit', ticket: ticket.id });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no_test_command');
});

test('an unreleased ticket does not execute', async () => {
  const { gate, server, actuator } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  const asked = server.request({ from: 'repo:demo', kind: 'tool', name: 'git.commit' });
  assert.equal(asked.status, 'deferred');
  const res = await actuator.invoke({ from: 'repo:demo', tool: 'git.commit', ticket: asked.ticket.id });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not-released');
});

test('the gate is re-checked at execution time, not just at request time', async () => {
  const { repoDir, gate, server, actuator } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');
  await actuator.invoke({ from: 'repo:demo', tool: 'repo.write_file', arg: { path: 'feature.txt', content: 'hello\n' } });
  const { ticket } = askAndRelease(server, gate, { kind: 'tool', name: 'git.commit' });
  // The human walks away between the release and the execution.
  gate.operators.signOut();

  const res = await actuator.invoke({ from: 'repo:demo', tool: 'git.commit', ticket: ticket.id });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not-signed-in', 'a signature from an hour ago is not a signature now');
});

test('the actuator cannot push the default branch, or anything but forge/*', async () => {
  const { gate, server, actuator } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  for (const branch of ['main', 'master', 'develop', 'release']) {
    const { ticket } = askAndRelease(server, gate, { kind: 'tool', name: 'git.push', arg: { branch } });
    const res = await actuator.invoke({ from: 'repo:demo', tool: 'git.push', arg: { branch }, ticket: ticket.id });
    assert.equal(res.ok, false, `${branch} must never be pushable`);
    assert.equal(res.reason, 'branch-forbidden');
  }
});

test('a clean tree is a named refusal, not an empty commit', async () => {
  const { gate, server, actuator } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  const { ticket } = askAndRelease(server, gate, { kind: 'tool', name: 'git.commit' });
  const res = await actuator.invoke({ from: 'repo:demo', tool: 'git.commit', ticket: ticket.id });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'nothing-to-commit');
});

test('every action is chained and re-reads', async () => {
  const { dir, repoDir, gate, server, actuator } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');
  await actuator.invoke({ from: 'repo:demo', tool: 'repo.write_file', arg: { path: 'a.txt', content: 'a\n' } });
  const one = askAndRelease(server, gate, { kind: 'tool', name: 'git.commit' });
  await actuator.invoke({ from: 'repo:demo', tool: 'git.commit', ticket: one.ticket.id });

  await actuator.invoke({ from: 'repo:demo', tool: 'repo.write_file', arg: { path: 'b.txt', content: 'b\n' } });
  const two = askAndRelease(server, gate, { kind: 'tool', name: 'git.commit' });
  await actuator.invoke({ from: 'repo:demo', tool: 'git.commit', ticket: two.ticket.id });

  // Two writes and two commits: every invocation is logged, not just the
  // ones that needed permission.
  const lines = fs.readFileSync(path.join(dir, 'actions.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 4);

  const reloaded = new Actuator(dir, {}).load();
  assert.equal(reloaded.actions.length, 4);
  const commits = reloaded.actions.filter((a) => a.tool === 'git.commit');
  assert.equal(commits.length, 2);
  for (const a of commits) {
    assert.equal(a.operator, 'dwayne', 'the human who released it is in the record');
    assert.ok(a.ticket, 'the ticket is in the record');
    assert.ok(a.verdict, 'the referee verdict is in the record');
  }
});

test('a write cannot escape the worktree', async () => {
  const { gate, actuator } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  for (const bad of ['../outside.txt', '/etc/passwd', '../../tmp/evil.txt']) {
    const res = await actuator.invoke({ from: 'repo:demo', tool: 'repo.write_file', arg: { path: bad, content: 'x' } });
    assert.equal(res.ok, false, `${bad} must be refused`);
    assert.ok(['absolute-path', 'path-escape'].includes(res.reason), `got ${res.reason}`);
  }
});

test('the agent works in a worktree and the checkout is never touched', async () => {
  const { repoDir, gate, actuator } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  const before = git(repoDir, ['status', '--porcelain']).out;
  const headBefore = git(repoDir, ['rev-parse', 'main']).out;

  await actuator.invoke({ from: 'repo:demo', tool: 'repo.write_file', arg: { path: 'agent.txt', content: 'written by the agent\n' } });

  // The person's checkout is untouched: no new untracked files, HEAD unchanged.
  const after = git(repoDir, ['status', '--porcelain']).out;
  assert.equal(after, before, 'the working checkout did not change');
  assert.equal(git(repoDir, ['rev-parse', 'main']).out, headBefore, 'main did not move');

  // But the write is real and readable back through the same tool.
  const read = await actuator.invoke({ from: 'repo:demo', tool: 'repo.read_file', arg: { path: 'agent.txt' } });
  assert.equal(read.ok, true);
  assert.equal(read.content, 'written by the agent\n');
});

test('a ticket for one tool cannot be spent on another', async () => {
  const { gate, server, actuator } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  const { ticket } = askAndRelease(server, gate, { kind: 'tool', name: 'git.commit' });
  const res = await actuator.invoke({ from: 'repo:demo', tool: 'git.push', arg: { branch: 'forge/x' }, ticket: ticket.id });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'ticket-mismatch');
});

test('a test script that runs nothing cannot referee a commit', async () => {
  // The classic silent-green: a test command that always succeeds.
  const { gate, server, actuator } = world({ passing: true, testScript: 'true' });
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  await actuator.invoke({ from: 'repo:demo', tool: 'repo.write_file', arg: { path: 'x.txt', content: 'x\n' } });
  const { ticket } = askAndRelease(server, gate, { kind: 'tool', name: 'git.commit' });
  const res = await actuator.invoke({ from: 'repo:demo', tool: 'git.commit', ticket: ticket.id });

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no_test_signal');
  assert.ok(res.detail.includes('proves nothing'), 'the refusal explains itself');
});

test('a nested test runner actually runs', async () => {
  const { gate, actuator } = world({ passing: true });
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  // This suite runs under `node --test`, which marks children with
  // NODE_TEST_CONTEXT. Without stripping it, a nested runner exits 0 having
  // run nothing — green, and completely hollow. Reaching `green` here is only
  // meaningful because the signal guard demands evidence that tests ran.
  assert.ok(process.env.NODE_TEST_CONTEXT, 'this assertion only bites inside a test run');

  const ran = await actuator.invoke({ from: 'repo:demo', tool: 'repo.run_tests' });
  assert.equal(ran.ok, true, JSON.stringify(ran));
  assert.equal(ran.verdict.status, 'green');
});

test('a write tool runs without a ticket; a commit does not', async () => {
  const { gate, actuator } = world();
  gate.operators.configure(['dwayne']);
  gate.operators.signIn('dwayne');

  const wrote = await actuator.invoke({ from: 'repo:demo', tool: 'repo.write_file', arg: { path: 'x.txt', content: 'x\n' } });
  assert.equal(wrote.ok, true, 'create is auto-grantable');

  const committed = await actuator.invoke({ from: 'repo:demo', tool: 'git.commit' });
  assert.equal(committed.ok, false);
  assert.equal(committed.reason, 'needs-ticket');
});
