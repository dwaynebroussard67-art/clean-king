'use strict';

/**
 * Two populations, one codebase, and the collision that used to be silent.
 *
 * The repair carrier and the browser carrier descend from the same store, so
 * they share SCHEMA, GENESIS, chainHash and — the part that mattered —
 * `equationSignature`. Before the carrier axis, the same equation observed on
 * both sides produced the SAME signature, `land()` found the existing record
 * and added a witness, and two populations that must never vote together
 * started voting together. No error, no finding, no log line.
 *
 * These tests pin the axis: that the collision is gone, that a carrier is part
 * of a fact's identity everywhere it matters (write, read, contradiction,
 * staleness, divergence), and that a record written before the axis existed is
 * ADOPTED rather than orphaned — the standard D26 set, where a reshape that
 * only changed strings would have started every existing carrier from nothing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  Federation,
  CARRIERS,
  DEFAULT_CARRIER,
  isCarrier,
  normalizeCarrier,
  legacyCarrier,
  origin,
  isOrigin,
  chainHash,
  GENESIS,
} = require('../src/federation/store.js');
const { federationSignature, SHARED_REALM } = require('../src/federation/realm.js');
const { equationSignature } = require('../src/passport/equation.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-carrier-'));
const open = () => new Federation(tmp()).load();

/** One equation, witnessed by a repo. Structural, so it is portable on its own. */
const repairSpec = (over = {}) => ({
  shelf: 'operational',
  equation: { subject: 'repo:twin-labs', predicate: 'test', object: 'npm test' },
  witness: 'structural',
  nodeId: 'twin-labs',
  reference: 'sha256:abc123',
  target: 'repo:twin-labs',
  ...over,
});

/** The same equation, as a browser seat would have observed it. */
const browserSpec = (over = {}) => ({
  shelf: 'operational',
  equation: { subject: 'repo:twin-labs', predicate: 'test', object: 'npm test' },
  witness: 'structural',
  nodeId: 'local-cockpit',
  reference: 'claim:c1 (claude.ai)',
  target: 'repo:twin-labs',
  carrier: 'browser',
  ...over,
});

// ------------------------------------------------------------------ vocabulary

test('the carrier vocabulary is closed, and this store is the repair one', () => {
  assert.deepEqual(CARRIERS, ['repair', 'browser']);
  assert.equal(DEFAULT_CARRIER, 'repair');
  assert.equal(legacyCarrier(), 'repair');

  assert.equal(isCarrier('repair'), true);
  assert.equal(isCarrier('browser'), true);
  // A third population is a decision with a migration attached, not a string.
  assert.equal(isCarrier('shared'), false);
  assert.equal(isCarrier('repo:twld'), false);
  assert.equal(isCarrier('REPAIR'), false, 'case is folded by normalizeCarrier, never by isCarrier');
  assert.equal(isCarrier(''), false);
  assert.equal(isCarrier(null), false);
  assert.equal(isCarrier(undefined), false);
});

test('normalizeCarrier folds case and refuses by returning null, never a default', () => {
  assert.equal(normalizeCarrier('REPAIR'), 'repair');
  assert.equal(normalizeCarrier('  Browser '), 'browser');
  assert.equal(normalizeCarrier('cockpit'), null);
  assert.equal(normalizeCarrier(''), null);
  assert.equal(normalizeCarrier(null), null);
});

// ------------------------------------------------------------------- identity

test('THE COLLISION IS GONE: one equation, two carriers, two signatures', () => {
  const eq = { subject: 'composer', predicate: 'selector', object: 'textarea#prompt' };
  const repair = federationSignature(eq, 'repair', 'shared', 'operational', equationSignature);
  const browser = federationSignature(eq, 'browser', 'shared', 'operational', equationSignature);

  assert.notEqual(repair, browser, 'the same equation in two populations must not be the same fact');
  // And the axes still compose: same carrier, different realm, still different.
  const repoScoped = federationSignature(eq, 'repair', 'repo:twld', 'operational', equationSignature);
  assert.notEqual(repair, repoScoped);
  assert.equal(repair, federationSignature(eq, 'repair', 'shared', 'operational', equationSignature), 'stable');
});

test('federationSignature refuses the pre-carrier call shape by name', () => {
  const eq = { subject: 'a', predicate: 'b', object: 'c' };
  // The old shape was (eq, realm, shelf, equationSignature). Calling it that way
  // would silently compute a different key, so it is detected instead.
  assert.throws(
    () => federationSignature(eq, 'shared', 'operational', equationSignature),
    /pre-carrier \(eq, realm, shelf, equationSignature\) shape/
  );
  // And an unknown carrier is refused as itself.
  assert.throws(() => federationSignature(eq, 'cockpit', 'shared', 'world', equationSignature), /carrier must be one of repair, browser/);
});

test('an unrecognised carrier is refused at the write boundary, with a reason', () => {
  const fed = open();
  const res = fed.land(repairSpec({ carrier: 'cockpit' }));
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'carrier');
  assert.match(res.detail, /must be one of repair, browser/);
  assert.match(res.detail, /pool witnesses/, 'the refusal says what is at stake');
  assert.equal(fed.live().length, 0, 'nothing landed');
});

test('an absent carrier means this store\'s own population', () => {
  const fed = open();
  const res = fed.land(repairSpec());
  assert.equal(res.ok, true);
  assert.equal(res.fact.carrier, 'repair');
  assert.equal(fed.land(repairSpec({ carrier: '' })).action, 'already-witnessed');
  assert.equal(fed.land(repairSpec({ carrier: null })).action, 'already-witnessed');
  assert.equal(fed.live().length, 1, 'all three spellings are one fact');
});

// ------------------------------------------------------------------ the walls

test('two carriers holding the same equation are two facts, and neither closes the other', () => {
  const fed = open();
  const a = fed.land(repairSpec());
  const b = fed.land(browserSpec());

  assert.equal(a.ok && b.ok, true);
  assert.equal(fed.live().length, 2, 'not merged');
  assert.notEqual(a.fact.signature, b.fact.signature);
  assert.equal(a.fact.carrier, 'repair');
  assert.equal(b.fact.carrier, 'browser');

  // The contamination that mattered: a website redesign observed by a browser
  // seat must not permanently close a repair fact about source.
  const closed = fed.contradict(browserSpec({ equation: { subject: 'repo:twin-labs', predicate: 'test', object: 'yarn test' } }));
  assert.equal(closed.ok, true);
  assert.equal(closed.contradicted && closed.contradicted.carrier, 'browser', 'it closed a BROWSER fact');

  const repairStill = fed.findByPredicate('repo:twin-labs', 'test', 'operational', SHARED_REALM, 'repair');
  assert.ok(repairStill, 'the repair fact survives');
  assert.equal(repairStill.closedAt, null);
  assert.equal(repairStill.equation.object, 'npm test');
});

test('contradiction still fires inside one carrier', () => {
  const fed = open();
  fed.land(repairSpec({ shelf: 'world', target: undefined, equation: { subject: 'repo:twin-labs', predicate: 'runner', object: 'jest' } }));
  const res = fed.contradict(
    repairSpec({ shelf: 'world', target: undefined, equation: { subject: 'repo:twin-labs', predicate: 'runner', object: 'vitest' } })
  );
  assert.equal(res.ok, true);
  assert.ok(res.contradicted, 'a contradiction inside the carrier still closes');
  assert.equal(res.contradicted.status, 'closed');
});

test('findByPredicate is carrier-scoped, so a lookup cannot reach across', () => {
  const fed = open();
  fed.land(repairSpec());
  fed.land(browserSpec());
  const eq = { subject: 'repo:twin-labs', predicate: 'test' };
  assert.equal(fed.findByPredicate(eq.subject, eq.predicate, 'operational', SHARED_REALM, 'repair').carrier, 'repair');
  assert.equal(fed.findByPredicate(eq.subject, eq.predicate, 'operational', SHARED_REALM, 'browser').carrier, 'browser');
  assert.equal(
    fed.findByPredicate(eq.subject, eq.predicate, 'operational', SHARED_REALM).carrier,
    'repair',
    'an omitted carrier means this store\'s own population'
  );
});

// --------------------------------------------------------------------- reads

test('a repair briefing never sees browser facts, and says so', () => {
  const fed = open();
  fed.land(repairSpec());
  fed.land(browserSpec());
  fed.land(browserSpec({ equation: { subject: 'claude.ai', predicate: 'composer', object: 'textarea' }, target: 'claude.ai' }));

  const b = fed.briefing({ viewer: 'twin-labs' });
  assert.equal(b.carrier, 'repair');
  assert.equal(b.facts.length, 1, 'only the repair fact');
  assert.equal(b.facts[0].carrier, 'repair');
  // The exclusion is half the read: a briefing that quietly omits a population
  // is a briefing nobody can audit.
  assert.deepEqual(b.otherCarriers, { browser: 2 });

  const bb = fed.briefing({ carrier: 'browser', viewer: 'local-cockpit' });
  assert.equal(bb.facts.length, 2);
  assert.deepEqual(bb.otherCarriers, { repair: 1 });
});

test('briefing refuses an unknown carrier rather than quietly widening', () => {
  const fed = open();
  const res = fed.briefing({ carrier: 'everything' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'carrier');
});

test('live() and stale() filter by carrier', () => {
  const fed = open();
  fed.land(repairSpec());
  fed.land(browserSpec());
  assert.equal(fed.live().length, 2, 'unfiltered stays unfiltered — the store view is not the reader view');
  assert.equal(fed.live({ carrier: 'repair' }).length, 1);
  assert.equal(fed.live({ carrier: 'browser' }).length, 1);

  const old = new Date(Date.now() - 90 * 86400000).toISOString();
  fed.land(repairSpec({ at: old, equation: { subject: 'repo:old', predicate: 'test', object: 'make test' }, target: 'repo:old' }));
  fed.land(browserSpec({ at: old, equation: { subject: 'site:old', predicate: 'composer', object: 'x' }, target: 'site:old' }));
  assert.equal(fed.stale({ days: 30 }).length, 1, 'staleness defaults to this carrier');
  assert.equal(fed.stale({ days: 30, carrier: 'browser' }).length, 1);
  // A recheck is work, and work belongs to whoever can do it — but "show me
  // everything that has gone stale" is still a legitimate question.
  assert.equal(fed.stale({ days: 30, carrier: null }).length, 2, 'null opts into every population');
  assert.equal(fed.stale({ days: 30, carrier: 'repair' }).every((f) => f.carrier === 'repair'), true);
});

test('divergences do not span carriers — that comparison is noise, not a finding', () => {
  const fed = open();
  // Same subject+predicate, different object, DIFFERENT CARRIERS.
  fed.land(repairSpec({ equation: { subject: 'repo:x', predicate: 'test', object: 'npm test' }, target: 'repo:x' }));
  fed.land(browserSpec({ equation: { subject: 'repo:x', predicate: 'test', object: 'pytest' }, target: 'repo:x' }));
  assert.equal(fed.divergences().length, 0, 'two populations describing two targets is not a divergence');

  // Same subject+predicate, different object, different REALMS, one carrier.
  fed.land(repairSpec({ realm: 'repo:a', equation: { subject: 'repo', predicate: 'test', object: 'npm test' }, target: 'repo:a' }));
  fed.land(repairSpec({ realm: 'repo:b', equation: { subject: 'repo', predicate: 'test', object: 'pytest' }, target: 'repo:b' }));
  const d = fed.divergences();
  assert.equal(d.length, 1, 'the divergence that IS a finding still reports');
  assert.equal(d[0].count, 2);
});

test('stats counts by carrier, and counts what arrived', () => {
  const fed = open();
  fed.land(repairSpec());
  fed.land(browserSpec());
  const s = fed.stats();
  assert.deepEqual(s.byCarrier, { repair: 1, browser: 1 });
  assert.equal(s.arrivedWitnesses, 0);
  assert.equal(s.schema, 'forgeflight.federation.v3');
});

// ----------------------------------------------------------------- migration

/** Write a log the way the pre-carrier (v2, realm-aware) store wrote it. */
function writeV2Log(dir, facts) {
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, 'federation.jsonl');
  let head = GENESIS;
  const lines = [];
  for (const f of facts) {
    const data = {
      id: f.id,
      schema: 'forgeflight.federation.v2',
      // The v2 key: realm and shelf, no carrier. Filled in below, because it
      // has to be computed from the canonical realm string.
      signature: null,
      realm: f.realm || SHARED_REALM,
      shelf: f.shelf,
      equation: f.equation,
      rendered: `${f.equation.predicate}(${f.equation.subject}) = ${f.equation.object}`,
      target: f.target || null,
      status: 'provisional',
      witnesses: f.witnesses,
      distinct: f.witnesses.length,
      landedAt: f.at,
      lastSeenAt: f.at,
      supersededBy: null,
      closedAt: null,
      closedBy: null,
    };
    // The genuine v2 signature: scope was `realm|shelf`, with no carrier slot.
    data.signature = equationSignature(f.equation, `${data.realm}|${f.shelf}`);
    assert.ok(data.signature, 'a v2 signature is computable');
    const rec = { op: 'fact', data };
    const line = { ...rec, prev: head, hash: chainHash(head, rec) };
    head = line.hash;
    lines.push(JSON.stringify(line));
  }
  fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
  return logPath;
}

test('a v2 record is ADOPTED into the repair carrier, and MERGES instead of duplicating', () => {
  const dir = tmp();
  const eq = { subject: 'repo:twin-labs', predicate: 'test', object: 'npm test' };
  writeV2Log(dir, [
    { id: 'f_legacy01', shelf: 'operational', target: 'repo:twin-labs', at: '2026-01-01T00:00:00.000Z', equation: eq,
      witnesses: [{ sig: 'w1', kind: 'structural', nodeId: 'twin-labs', reference: 'sha256:old', at: '2026-01-01T00:00:00.000Z' }] },
  ]);

  const fed = new Federation(dir).load();
  assert.equal(fed.live().length, 1);
  assert.equal(fed.live()[0].carrier, 'repair', 'adopted into this store\'s own population');
  assert.equal(fed.live()[0].realm, SHARED_REALM);
  assert.equal(fed.carrierMigrated, 1);
  assert.equal(fed.migrated, 1, 'and re-keyed');
  assert.equal(fed.corrupt, 0);
  assert.deepEqual(fed.chain.breaks, [], 'the chain still verifies — the key is inside the record, not the hash');

  // The whole point: a fact landed NOW about the same thing meets the old one
  // instead of sitting beside it as a duplicate.
  const res = fed.land(repairSpec());
  assert.equal(res.action, 'witnessed', 'merged, not duplicated');
  assert.equal(fed.live().length, 1);
  assert.equal(fed.live()[0].distinct, 2);
});

test('a v1 record with neither realm nor carrier is adopted into both', () => {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  const eq = { subject: 'capital', predicate: 'of', object: 'paris' };
  const data = {
    id: 'f_v1', schema: 'omnibox.collective.v1',
    signature: equationSignature(eq, 'world'), // the v1 key: shelf only
    shelf: 'world', equation: eq, rendered: 'of(capital) = paris', target: null,
    status: 'provisional',
    witnesses: [{ sig: 'w', kind: 'structural', nodeId: 'n1', reference: 'r', at: '2025-01-01T00:00:00.000Z' }],
    distinct: 1, landedAt: '2025-01-01T00:00:00.000Z', lastSeenAt: '2025-01-01T00:00:00.000Z',
    supersededBy: null, closedAt: null, closedBy: null,
  };
  const rec = { op: 'fact', data };
  fs.writeFileSync(path.join(dir, 'federation.jsonl'), JSON.stringify({ ...rec, prev: GENESIS, hash: chainHash(GENESIS, rec) }) + '\n', 'utf8');

  const fed = new Federation(dir).load();
  const f = fed.live()[0];
  assert.equal(f.realm, SHARED_REALM);
  assert.equal(f.carrier, 'repair');
  assert.equal(f.schema, 'omnibox.collective.v1', 'the per-record label is never rewritten');
  assert.equal(fed.migrated, 1);
});

// ------------------------------------------------------------------ provenance

test('origin is a complete, checkable pointer — or it is not an origin', () => {
  const good = origin({ carrier: 'browser', factId: 'f_1', signature: 'abc', head: 'def', at: '2026-01-01T00:00:00.000Z' });
  assert.equal(isOrigin(good), true);
  assert.equal(good.mechanical, false);
  assert.equal(good.actor, null);

  // A partial provenance looks checkable and is not, so every field is required.
  assert.equal(isOrigin(origin({ carrier: 'browser', factId: 'f_1', signature: 'abc', head: '', at: 'x' })), false);
  assert.equal(isOrigin(origin({ carrier: 'nope', factId: 'f_1', signature: 'a', head: 'b', at: 'x' })), false);
  assert.equal(isOrigin(null), false);
  assert.equal(isOrigin({}), false);

  const signed = origin({ carrier: 'repair', factId: 'f_2', signature: 's', head: 'h', at: 'x', actor: 'dwayne' });
  assert.equal(signed.actor, 'dwayne');
  assert.equal(Object.isFrozen(signed), true, 'provenance is not editable after the fact');
});

test('a fact cannot claim an origin in the carrier it is landing in', () => {
  const fed = open();
  const prov = origin({ carrier: 'repair', factId: 'f_x', signature: 's', head: 'h', at: '2026-01-01T00:00:00.000Z' });
  const res = fed.land(repairSpec({ carrier: 'repair', origin: prov }));
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'origin-same-carrier');
  assert.match(res.detail, /cannot arrive from where it already is/);
});

test('a partial origin is refused, because it looks checkable and is not', () => {
  const fed = open();
  const res = fed.land(repairSpec({ carrier: 'browser', origin: { carrier: 'repair', factId: 'f_x' } }));
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'origin');
});

test('an arrived fact may not carry an outcome witness — this node did not act', () => {
  const fed = open();
  const prov = origin({ carrier: 'repair', factId: 'f_x', signature: 's', head: 'h', at: '2026-01-01T00:00:00.000Z' });
  const res = fed.land(browserSpec({ carrier: 'browser', witness: 'outcome', origin: prov }));
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'origin-outcome');
  assert.match(res.detail, /did not act/);
  // The same fact witnessed structurally is fine — that is what a transfer is.
  assert.equal(fed.land(browserSpec({ carrier: 'browser', witness: 'structural', origin: prov })).ok, true);
});
