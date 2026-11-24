'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SHARED_REALM,
  isRealm,
  isRepoRealm,
  repoRealm,
  realmSlug,
  sanitizeSlug,
  normalizeRemote,
  ownerRepo,
  repoName,
  slugFromRemote,
} = require('../src/federation/realm.js');

test('the realm vocabulary is closed', () => {
  assert.equal(isRealm('shared'), true);
  assert.equal(isRealm('repo:twld'), true);
  assert.equal(isRealm(repoRealm('Forge-Federation')), true);

  // An unrecognised realm is a fact living somewhere nobody can find it again.
  assert.equal(isRealm('repo:'), false);
  assert.equal(isRealm('twld'), false);
  assert.equal(isRealm('repo:has spaces'), false);
  assert.equal(isRealm('repo:../escape'), false);
  assert.equal(isRealm(''), false);
  assert.equal(isRealm(null), false);
  assert.equal(isRealm(undefined), false);
});

test('there is exactly one spelling of every realm', () => {
  // If `repo:TWLD` and `repo:twld` were both accepted they would be two keys
  // for one repository — two nodes, and a promotion you can mint by capitalising.
  assert.equal(isRealm('repo:TWLD'), false);
  assert.equal(repoRealm('TWLD'), repoRealm('twld'));
  assert.equal(repoRealm('Twld'), repoRealm('TWLD'));
  // Case-insensitivity belongs to LOOKUP (NodeRegistry.resolveRealm), not to
  // the key itself.
});

test('slugs are canonicalised, and an unusable slug is a refusal', () => {
  assert.equal(repoRealm('TWLD'), 'repo:twld');
  assert.equal(repoRealm('My Repo!'), 'repo:my-repo');
  assert.equal(repoRealm('  striper  '), 'repo:striper');
  assert.equal(repoRealm(''), null);
  assert.equal(repoRealm('///'), null);
  assert.equal(realmSlug('repo:twld'), 'twld');
  assert.equal(realmSlug('shared'), null);
});

test('an over-long slug is refused, never truncated into a collision', () => {
  const one = sanitizeSlug('a'.repeat(76) + '-one');
  const two = sanitizeSlug('a'.repeat(76) + '-two');
  assert.equal(one.length, 80);
  assert.notEqual(one, two, 'two long names must not collapse into one repository');

  // One character over, and it is a refusal rather than a silent truncation.
  assert.equal(sanitizeSlug('a'.repeat(81)), null);
  assert.equal(sanitizeSlug('a'.repeat(77) + '-one'), null);
});

test('every way of writing a remote collapses to one identity', () => {
  const forms = [
    'git@github.com:dwaynebroussard67-art/TWLD.git',
    'ssh://git@github.com/dwaynebroussard67-art/TWLD.git',
    'https://github.com/dwaynebroussard67-art/TWLD.git',
    'https://github.com/dwaynebroussard67-art/TWLD',
    'https://github.com/dwaynebroussard67-art/TWLD.git/',
    'git://github.com/dwaynebroussard67-art/TWLD.git',
    'https://token@github.com/dwaynebroussard67-art/TWLD.git',
  ];
  const want = 'https://github.com/dwaynebroussard67-art/twld';
  for (const f of forms) assert.equal(normalizeRemote(f), want, f);
});

test('a remote is refused rather than guessed at', () => {
  assert.equal(normalizeRemote(''), null);
  assert.equal(normalizeRemote('not a remote at all'), null);
  assert.equal(normalizeRemote('https://github.com'), null);
  assert.equal(normalizeRemote(null), null);
  // A bare path is not a remote — the registry decides that, not this module.
  assert.equal(normalizeRemote('/home/user/TWLD'), null);
});

test('owner/repo and repo name come out of the canonical remote', () => {
  const r = normalizeRemote('git@github.com:dwaynebroussard67-art/Forge-Federation.git');
  assert.equal(ownerRepo(r), 'dwaynebroussard67-art/forge-federation');
  assert.equal(repoName(r), 'forge-federation');
  assert.equal(slugFromRemote(r), 'forge-federation');
});
