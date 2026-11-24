'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { NodeRegistry } = require('../src/federation/nodes.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-nodes-'));

const REMOTES = {
  twld: 'git@github.com:dwaynebroussard67-art/TWLD.git',
  striper: 'https://github.com/dwaynebroussard67-art/striper.git',
  forge: 'https://github.com/dwaynebroussard67-art/Forge-Federation.git',
};

function seeded(overrides = {}) {
  const reg = new NodeRegistry(tmp(), { gitRemote: overrides.gitRemote || (() => null) });
  reg.register({ remote: REMOTES.twld, localPath: '/home/user/TWLD' });
  reg.register({ remote: REMOTES.striper, localPath: '/home/user/striper' });
  return reg;
}

test('a node is keyed on its remote, not its name', () => {
  const reg = seeded();
  const first = reg.register({ remote: REMOTES.twld });
  assert.equal(first.action, 'already-registered');

  // The same repository written a different way is the same node.
  assert.ok(reg.has(first.node.id));
  assert.ok(reg.has('twld'));
  assert.ok(reg.has('TWLD'));
  assert.ok(reg.has('git@github.com:dwaynebroussard67-art/TWLD.git'));
  assert.ok(reg.has('https://github.com/dwaynebroussard67-art/TWLD'));
  assert.equal(reg.all().length, 2);
});

test('two different repositories cannot share a slug', () => {
  const reg = seeded();
  const clash = reg.register({ remote: REMOTES.forge, slug: 'twld' });
  assert.equal(clash.rejected, true);
  assert.equal(clash.reason, 'slug-taken');
});

test('a rename appends an alias and does NOT re-key the realm', () => {
  const reg = seeded();
  const before = reg.get('twld');

  const res = reg.rename('twld', 'twld-app');
  assert.equal(res.action, 'renamed');
  const after = reg.get('TWLD');

  assert.equal(before.id, after.id);
  assert.deepEqual(after.aliases, ['twld']);

  // THE POINT: the slug is a name, the realm is a key. Renaming must not
  // orphan every fact this repository ever landed.
  assert.equal(after.realm, 'repo:twld');
  assert.equal(before.realm, after.realm);

  // Both names resolve to the same node, and to the same realm.
  assert.equal(reg.get('twld').id, after.id);
  assert.equal(reg.get('twld-app').id, after.id);
  assert.equal(reg.resolveRealm('twld').realm, 'repo:twld');
  assert.equal(reg.resolveRealm('twld-app').realm, 'repo:twld');
});

test('resolution never guesses — every failure is named', () => {
  const reg = seeded();

  assert.equal(reg.resolveRealm('shared').realm, 'shared');
  assert.equal(reg.resolveRealm('repo:twld').realm, 'repo:twld');
  assert.equal(reg.resolveRealm('twld').via, 'slug');
  assert.equal(reg.resolveRealm(REMOTES.twld).via, 'remote');
  assert.equal(reg.resolveRealm('/home/user/striper').via, 'path');

  const unknownRepo = reg.resolveRealm('git@github.com:dwaynebroussard67-art/monorepo.git');
  assert.equal(unknownRepo.ok, false);
  assert.equal(unknownRepo.reason, 'unregistered-repo');

  const notARepo = reg.resolveRealm('/tmp/definitely-not-a-checkout');
  assert.equal(notARepo.ok, false);
  assert.equal(notARepo.reason, 'not-a-repository');
});

test('a path resolves through git, with the runner injected', () => {
  const dir = tmp();
  const reg = new NodeRegistry(dir, { gitRemote: (cwd) => (cwd === '/home/user/TWLD' ? REMOTES.twld : null) });
  reg.register({ remote: REMOTES.twld, localPath: '/home/user/TWLD' });

  const hit = reg.resolveRealm('/home/user/TWLD');
  assert.equal(hit.ok, true);
  assert.equal(hit.realm, 'repo:twld');
  assert.equal(hit.via, 'path');

  const miss = reg.resolveRealm('/home/user/whatever');
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'not-a-repository');
});

test('the registry is chained, and tampering is reported not thrown', () => {
  const dir = tmp();
  const reg = new NodeRegistry(dir, { gitRemote: () => null });
  reg.register({ remote: REMOTES.twld });
  reg.register({ remote: REMOTES.striper });

  const reloaded = new NodeRegistry(dir, { gitRemote: () => null }).load();
  assert.equal(reloaded.all().length, 2);
  assert.deepEqual(reloaded.chain.breaks, []);
  assert.equal(reloaded.corrupt, 0);

  const lines = fs.readFileSync(reloaded.logPath, 'utf8').trim().split('\n');
  const rec = JSON.parse(lines[0]);
  rec.data.slug = 'attacker';
  fs.writeFileSync(reloaded.logPath, `${JSON.stringify(rec)}\n${lines.slice(1).join('\n')}\n`, 'utf8');

  const tampered = new NodeRegistry(dir, { gitRemote: () => null }).load();
  assert.ok(tampered.chain.breaks.length > 0);
  assert.equal(tampered.chain.breaks[0].kind, 'hash-mismatch');
});

test('discovery upserts and never deletes', () => {
  const reg = seeded();
  const sync = reg.syncFromGitHub([
    { nameWithOwner: 'dwaynebroussard67-art/TWLD', url: 'https://github.com/dwaynebroussard67-art/TWLD' },
    { nameWithOwner: 'dwaynebroussard67-art/Fleets', url: 'https://github.com/dwaynebroussard67-art/Fleets' },
    { nameWithOwner: 'dwaynebroussard67-art/garbage', url: 'not-a-url' },
  ]);

  assert.equal(sync.already, 1); // TWLD
  assert.equal(sync.registered, 1); // Fleets
  assert.equal(sync.skipped, 1); // the unparseable row
  assert.equal(reg.all().length, 3);

  // A repository missing from a later sync is NOT retired — a bad sync must
  // never strand a repository's facts.
  reg.syncFromGitHub([{ nameWithOwner: 'dwaynebroussard67-art/TWLD', url: 'https://github.com/dwaynebroussard67-art/TWLD' }]);
  assert.equal(reg.all().length, 3);
  assert.equal(reg.active().length, 3);
});

test('retiring is a status, never an erasure', () => {
  const reg = seeded();
  reg.retire('twld');
  assert.equal(reg.get('twld').status, 'retired');
  assert.equal(reg.all().length, 2); // still there
  assert.equal(reg.active().length, 1);
  assert.equal(reg.resolveRealm('twld').realm, 'repo:twld'); // still resolvable
});

test('registerHere takes identity from origin, not from the folder name', () => {
  const dir = tmp();
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-here-'));
  spawnGit(checkout);
  const reg = new NodeRegistry(dir).load();
  const res = reg.registerHere(checkout);
  assert.equal(res.rejected, undefined);
  assert.equal(res.action, 'registered');
  assert.equal(res.node.slug, 'forge-federation');
  assert.equal(res.node.localPath, path.resolve(checkout));
  const again = reg.registerHere(checkout);
  assert.equal(again.action, 'already-registered');
});

function spawnGit(dir) {
  const { spawnSync } = require('node:child_process');
  const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  g(['init']);
  g(['remote', 'add', 'origin', 'https://github.com/dwaynebroussard67-art/Forge-Federation.git']);
}

test('the commons is always resolvable, with no repository involved', () => {
  const reg = seeded();
  assert.deepEqual(reg.realms().slice(0, 1), ['shared']);
  assert.equal(reg.resolveRealm('shared').ok, true);
});
