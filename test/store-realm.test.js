'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Federation, portable, servable } = require('../src/federation/store.js');
const { NodeRegistry } = require('../src/federation/nodes.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-store-'));
const EQ = (object) => ({ subject: 'repo', predicate: 'test_command', object });

const REMOTES = {
  twld: 'git@github.com:dwaynebroussard67-art/TWLD.git',
  striper: 'https://github.com/dwaynebroussard67-art/striper.git',
  monorepo: 'https://github.com/dwaynebroussard67-art/monorepo.git',
};

function opened() {
  const dir = tmp();
  const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();
  nodes.register({ remote: REMOTES.twld, localPath: '/home/user/TWLD' });
  nodes.register({ remote: REMOTES.striper, localPath: '/home/user/striper' });
  nodes.register({ remote: REMOTES.monorepo, localPath: '/home/user/monorepo' });
  const federation = new Federation(dir, { nodes }).load();
  return { federation, nodes, dir };
}

test('the same equation in two realms is two facts, not one', () => {
  const { federation } = opened();
  const a = federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });
  const b = federation.land({ shelf: 'operational', realm: 'repo:striper', equation: EQ('pytest'), witness: 'structural', nodeId: 'striper', reference: 'sha256:bbb', target: 'pyproject.toml' });

  assert.equal(a.fact.realm, 'repo:twld');
  assert.equal(b.fact.realm, 'repo:striper');
  assert.notEqual(a.fact.signature, b.fact.signature);
  assert.equal(federation.live().length, 2);
});

test('a contradiction does not cross a realm boundary', () => {
  const { federation } = opened();
  federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });

  // The same left side, a different answer, in a different repository.
  const res = federation.contradict({ shelf: 'operational', realm: 'repo:striper', equation: EQ('pytest'), witness: 'structural', nodeId: 'striper', reference: 'sha256:bbb', target: 'pyproject.toml' });

  assert.equal(res.ok, true);
  assert.equal(res.contradicted, null, 'a different repository is not a contradiction');
  assert.equal(federation.live().length, 2);
  assert.equal(federation.live({ realm: 'repo:twld' })[0].equation.object, 'npm test');
  assert.equal(federation.live({ realm: 'repo:striper' })[0].equation.object, 'pytest');
});

test('inside one realm, a contradiction still supersedes as it always did', () => {
  const { federation } = opened();
  federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });
  const res = federation.contradict({ shelf: 'operational', realm: 'repo:twld', equation: EQ('pnpm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:ccc', target: 'package.json' });

  assert.equal(res.contradicted.status, 'superseded');
  assert.equal(federation.live({ realm: 'repo:twld' }).length, 1);
  assert.equal(federation.live({ realm: 'repo:twld' })[0].equation.object, 'pnpm test');
  // Nothing is deleted: the old record is still there, marked.
  assert.ok(federation.all().some((f) => f.equation.object === 'npm test' && f.status === 'superseded'));
});

test('divergences are reported for a human and never reconciled', () => {
  const { federation } = opened();
  federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });
  federation.land({ shelf: 'operational', realm: 'repo:striper', equation: EQ('pytest'), witness: 'structural', nodeId: 'striper', reference: 'sha256:bbb', target: 'pyproject.toml' });

  const d = federation.divergences();
  assert.equal(d.length, 1);
  assert.equal(d[0].subject, 'repo');
  assert.equal(d[0].count, 2);
  assert.deepEqual(new Set(d[0].values.map((v) => v.value)), new Set(['npm test', 'pytest']));

  // Reporting changed nothing.
  assert.equal(federation.live().length, 2);
});

test('agreement between realms is not a thing, and agreement is still not a witness kind', () => {
  const { federation } = opened();
  const res = federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'agreement', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'witness');
});

test('a realm outside the closed vocabulary is refused', () => {
  const { federation } = opened();
  const res = federation.land({ shelf: 'operational', realm: 'repo:../etc', equation: EQ('npm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'realm');
});

test('an unregistered node cannot witness once a registry is attached', () => {
  const { federation } = opened();
  const res = federation.land({ shelf: 'operational', realm: 'shared', equation: EQ('npm test'), witness: 'outcome', nodeId: 'twld-2', reference: 'req:1', target: 'package.json' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'unregistered-node');
});

test('without a registry the store behaves exactly as it always did', () => {
  const dir = tmp();
  const federation = new Federation(dir).load();
  const res = federation.land({ shelf: 'operational', equation: EQ('npm test'), witness: 'outcome', nodeId: 'local-cockpit', reference: 'req:1', target: 'package.json' });
  assert.equal(res.ok, true);
  assert.equal(res.fact.realm, 'shared');
});

test('D24, enforced: a single node outcome does not travel, three do', () => {
  const { federation } = opened();
  const landed = federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'outcome', nodeId: 'twld', reference: 'req:1', target: 'package.json' });

  assert.equal(portable(landed.fact).portable, false);
  assert.equal(portable(landed.fact).reason, 'single-node-outcome');

  // Visible where it was measured, invisible everywhere else.
  assert.equal(servable(landed.fact, 'twld').servable, true);
  assert.equal(servable(landed.fact, 'striper').servable, false);

  federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'outcome', nodeId: 'striper', reference: 'req:2', target: 'package.json' });
  federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'outcome', nodeId: 'monorepo', reference: 'req:3', target: 'package.json' });

  const promoted = federation.findByPredicate('repo', 'test_command', 'operational', 'repo:twld');
  assert.equal(portable(promoted).portable, true);
  assert.equal(portable(promoted).reason, 'replicated');
});

test('a structural witness travels on its own — it is re-derivable', () => {
  const { federation } = opened();
  const landed = federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });
  assert.equal(portable(landed.fact).portable, true);
  assert.equal(portable(landed.fact).reason, 'self-verifying');
});

test('one node saying the same outcome five times is still one witness', () => {
  const { federation } = opened();
  for (let i = 0; i < 5; i++) {
    federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'outcome', nodeId: 'twld', reference: 'req:1', target: 'package.json' });
  }
  const f = federation.findByPredicate('repo', 'test_command', 'operational', 'repo:twld');
  assert.equal(f.distinct, 1);
  assert.equal(portable(f).portable, false);
});

test('the briefing hands a cockpit the commons plus its own realm, and no more', () => {
  const { federation } = opened();
  federation.land({ shelf: 'world', realm: 'shared', equation: { subject: 'france', predicate: 'capital', object: 'paris' }, witness: 'human', nodeId: 'twld', reference: 'dwayne', actor: 'dwayne' });
  federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });
  federation.land({ shelf: 'operational', realm: 'repo:striper', equation: EQ('pytest'), witness: 'structural', nodeId: 'striper', reference: 'sha256:bbb', target: 'pyproject.toml' });
  federation.land({ shelf: 'operational', realm: 'repo:twld', equation: { subject: 'repo', predicate: 'deploys_on', object: 'vercel' }, witness: 'outcome', nodeId: 'twld', reference: 'req:9', target: 'vercel.json' });

  const twld = federation.briefing({ realm: 'repo:twld', viewer: 'twld' });
  assert.ok(twld.facts.some((f) => f.equation.subject === 'france'), 'the commons rides along');
  assert.ok(twld.facts.some((f) => f.equation.object === 'npm test'));
  assert.ok(!twld.facts.some((f) => f.equation.object === 'pytest'), 'another repository operational fact does not');

  const striper = federation.briefing({ realm: 'repo:striper', viewer: 'striper' });
  assert.ok(striper.facts.some((f) => f.equation.subject === 'france'));
  assert.ok(striper.facts.some((f) => f.equation.object === 'pytest'));

  const stranger = federation.briefing({ realm: 'repo:twld', viewer: 'monorepo' });
  assert.equal(stranger.withheld, 1, 'the un-replicated outcome fact is withheld from a node that did not measure it');
  assert.ok(!stranger.facts.some((f) => f.equation.object === 'vercel'));
});

test('stats account for realms, and the chain still verifies', () => {
  const { federation } = opened();
  federation.land({ shelf: 'world', realm: 'shared', equation: { subject: 'france', predicate: 'capital', object: 'paris' }, witness: 'human', nodeId: 'twld', reference: 'dwayne', actor: 'dwayne' });
  federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });
  federation.land({ shelf: 'operational', realm: 'repo:striper', equation: EQ('pytest'), witness: 'structural', nodeId: 'striper', reference: 'sha256:bbb', target: 'pyproject.toml' });

  const s = federation.stats();
  assert.equal(s.live, 3);
  assert.equal(s.byRealm.shared, 1);
  assert.equal(s.byRealm['repo:twld'], 1);
  assert.equal(s.byRealm['repo:striper'], 1);
  assert.deepEqual(federation.verify().breaks, []);
});

test('a tampered log is a finding, never a crash', () => {
  const { federation, dir } = opened();
  federation.land({ shelf: 'operational', realm: 'repo:twld', equation: EQ('npm test'), witness: 'structural', nodeId: 'twld', reference: 'sha256:aaa', target: 'package.json' });

  const lines = fs.readFileSync(path.join(dir, 'federation.jsonl'), 'utf8').trim().split('\n');
  const rec = JSON.parse(lines[0]);
  rec.data.equation.object = 'attacker';
  fs.writeFileSync(path.join(dir, 'federation.jsonl'), `${JSON.stringify(rec)}\n${lines.slice(1).join('\n')}\n`, 'utf8');

  const reloaded = new Federation(dir).load();
  assert.ok(reloaded.verify().breaks.length > 0);
  assert.equal(reloaded.corrupt, 0);
});
