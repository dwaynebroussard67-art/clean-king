'use strict';

/**
 * The door between the two carriers.
 *
 * Separation in the signature (carrier.test.js) stops contamination by
 * accident. These tests are about crossing ON PURPOSE: Forge Flight relaying a
 * repair is a real workflow, and what those seats establish belongs on the
 * repair side — and stays on the browser side too, because it is genuinely
 * both.
 *
 * The invariant the whole file exists to pin: an arrived fact INFORMS and never
 * VOTES. Two records, each with its own witness population, linked by a
 * provenance pointer — not one merged record with pooled witnesses, which is
 * what the collision used to produce silently.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Federation, DEFAULT_CARRIER } = require('../src/federation/store.js');
const { NodeRegistry } = require('../src/federation/nodes.js');
const { transfer, transferReference, REFUSALS } = require('../src/federation/bridge.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-bridge-'));

/** Two separate stores: the browser's and the repair one. Different directories,
 *  because that is the topology — the door connects two files, not two views of
 *  one file. */
function pair() {
  const browser = new Federation(tmp()).load();
  const repair = new Federation(tmp()).load();
  return { browser, repair };
}

/** A browser fact that has earned the right to travel: structural, so it is
 *  re-derivable by anybody holding the artifact. */
const browserFact = (over = {}) => ({
  shelf: 'operational',
  carrier: 'browser',
  equation: { subject: 'repo:twin-labs', predicate: 'test', object: 'npm test' },
  witness: 'structural',
  nodeId: 'local-cockpit',
  reference: 'sha256:manifest',
  target: 'repo:twin-labs',
  ...over,
});

const repairFact = (over = {}) => ({
  shelf: 'operational',
  carrier: 'repair',
  equation: { subject: 'repo:twin-labs', predicate: 'test', object: 'npm test' },
  witness: 'structural',
  nodeId: 'twin-labs',
  reference: 'sha256:manifest',
  target: 'repo:twin-labs',
  ...over,
});

// -------------------------------------------------------------------- crossing

test('browser -> repair crosses mechanically: this is the relay workflow', () => {
  const { browser, repair } = pair();
  browser.land(browserFact());

  // No actor. Seats worked a repository and what they established should inform
  // the repair side without a human signing every equation.
  const res = transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [browser.live()[0].signature] });

  assert.equal(res.ok, true);
  assert.equal(res.transferred.length, 1);
  assert.equal(res.refused.length, 0);
  assert.equal(res.mechanical, true);
  assert.equal(res.to, 'repair');

  const landed = repair.live()[0];
  assert.equal(landed.carrier, 'repair', 'it is now a repair fact');
  assert.equal(landed.witnesses.length, 1);
  assert.equal(landed.witnesses[0].kind, 'structural', 'a mechanical crossing is witnessed by its re-derivable provenance');
  assert.equal(landed.arrived, 1);
  assert.equal(landed.observed, 0, 'nothing was observed HERE');
});

test('the provenance is a complete pointer back to where it was earned', () => {
  const { browser, repair } = pair();
  const src = browser.land(browserFact()).fact;
  // Captured BEFORE the crossing: the door logs a transfer-out event on the
  // source, which moves the source head. The provenance dates the reading it
  // actually came from, not the state after the bridge finished writing.
  const headAtReading = browser.head;

  transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [src.signature] });

  const prov = repair.live()[0].witnesses[0].origin;
  assert.ok(prov, 'the witness carries its origin');
  assert.equal(prov.carrier, 'browser');
  assert.equal(prov.factId, src.id);
  assert.equal(prov.signature, src.signature);
  assert.equal(prov.head, headAtReading, 'the chain state it was read from');
  assert.notEqual(prov.head, browser.head, 'the source moved on afterwards; the origin still dates the reading');
  assert.equal(prov.mechanical, true);
  assert.equal(prov.actor, null);

  // And the source fact is untouched: two records, not one moved record.
  assert.equal(browser.live().length, 1);
  assert.equal(browser.live()[0].signature, src.signature);
  assert.equal(browser.live()[0].witnesses[0].origin, null, 'it was observed there, not arrived');
});

test('THE INVARIANT: an arrived fact informs and never votes', () => {
  const { browser, repair } = pair();
  // Five browser nodes independently establish a WORLD fact on their side.
  const eq = { subject: 'capital', predicate: 'of', object: 'paris' };
  for (let i = 0; i < 5; i++) {
    browser.land({ shelf: 'world', carrier: 'browser', equation: eq, witness: 'structural', nodeId: `seat-${i}`, reference: `r${i}` });
  }
  assert.equal(browser.live()[0].status, 'established', 'established among browsers');

  // Cross it five times through five different bridge nodes: five distinct
  // arrived witnesses on one repair fact.
  const sig = browser.live()[0].signature;
  for (let i = 0; i < 5; i++) {
    transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: `bridge-${i}`, signatures: [sig] });
  }

  const landed = repair.live()[0];
  assert.equal(landed.distinct, 5, 'five witnesses are recorded');
  assert.equal(landed.arrived, 5);
  assert.equal(landed.observed, 0);
  assert.equal(landed.status, 'provisional', 'and NOT ONE of them counts toward promotion');
});

test('local witnesses still establish, with arrived ones present', () => {
  const { browser, repair } = pair();
  const eq = { subject: 'capital', predicate: 'of', object: 'paris' };
  browser.land({ shelf: 'world', carrier: 'browser', equation: eq, witness: 'structural', nodeId: 'seat', reference: 'r' });
  transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [browser.live()[0].signature] });

  // Four repos observe it locally: 4 observed, still short of five.
  for (let i = 0; i < 4; i++) {
    repair.land({ shelf: 'world', carrier: 'repair', equation: eq, witness: 'structural', nodeId: `repo-${i}`, reference: `r${i}` });
  }
  assert.equal(repair.live()[0].status, 'provisional');
  assert.equal(repair.live()[0].observed, 4);
  assert.equal(repair.live()[0].distinct, 5, 'the arrived one is visible in the count...');

  // A fifth local witness establishes it — on the strength of five OBSERVATIONS,
  // not four observations plus a visitor.
  repair.land({ shelf: 'world', carrier: 'repair', equation: eq, witness: 'structural', nodeId: 'repo-4', reference: 'r4' });
  assert.equal(repair.live()[0].status, 'established');
  assert.equal(repair.live()[0].observed, 5);
});

test('an arrived outcome cannot help a fact become portable', () => {
  const { browser, repair } = pair();
  const eq = { subject: 'x', predicate: 'y', object: 'z' };
  // One browser node's self-reported outcome is not portable even at home.
  const solo = browser.land({ shelf: 'world', carrier: 'browser', equation: eq, witness: 'outcome', nodeId: 'seat', reference: 'r' });
  const res = transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [solo.fact.signature] });
  assert.equal(res.transferred.length, 0);
  assert.equal(res.refused[0].reason, 'not-portable');
  assert.equal(res.refused[0].detail, 'single-node-outcome');
  assert.equal(repair.live().length, 0, 'it has not earned the right to travel at home, so it does not earn it by crossing');
});

// -------------------------------------------------------------- the directions

test('repair -> browser is REFUSED without a named human: this direction leaks', () => {
  const { browser, repair } = pair();
  repair.land(repairFact());

  const res = transfer(repair, browser, { from: 'repair', to: 'browser', nodeId: 'bridge', signatures: [repair.live()[0].signature] });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'unsigned-export');
  assert.match(res.detail, /chat composer/);
  assert.match(res.detail, /named human/);
  assert.equal(browser.live().length, 0, 'nothing crossed');
  assert.equal(repair.live().length, 1, 'and nothing left');
});

test('repair -> browser with a name lands as a human ruling', () => {
  const { browser, repair } = pair();
  const src = repair.land(repairFact()).fact;

  const res = transfer(repair, browser, {
    from: 'repair', to: 'browser', nodeId: 'bridge', actor: 'dwayne', signatures: [src.signature], reason: 'needed for the relay',
  });
  assert.equal(res.ok, true);
  assert.equal(res.mechanical, false);
  assert.equal(res.actor, 'dwayne');

  const landed = browser.live()[0];
  assert.equal(landed.carrier, 'browser');
  assert.equal(landed.witnesses[0].kind, 'human', 'a signed export is a ruling, with the name in the record');
  assert.equal(landed.witnesses[0].origin.actor, 'dwayne');
  assert.equal(landed.witnesses[0].origin.mechanical, false);
});

// -------------------------------------------------------------------- refusals

test('the door refuses by name, and every refusal is one of the closed set', () => {
  assert.deepEqual(
    REFUSALS,
    ['not-portable', 'closed', 'superseded', 'same-carrier', 'unsigned-export', 'unwitnessed']
  );
});

test('a closed fact does not arrive alive', () => {
  const { browser, repair } = pair();
  browser.land({ shelf: 'world', carrier: 'browser', equation: { subject: 'a', predicate: 'b', object: 'one' }, witness: 'structural', nodeId: 's1', reference: 'r1' });
  browser.contradict({ shelf: 'world', carrier: 'browser', equation: { subject: 'a', predicate: 'b', object: 'two' }, witness: 'structural', nodeId: 's2', reference: 'r2' });

  const closed = browser.all().find((f) => f.status === 'closed');
  assert.ok(closed, 'precondition: something is closed');
  const res = transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [closed.signature] });
  assert.equal(res.transferred.length, 0);
  assert.equal(res.refused[0].reason, 'closed');
  assert.equal(repair.live().length, 0);
});

test('a superseded fact does not cross — the live replacement is the one worth moving', () => {
  const { browser, repair } = pair();
  browser.land(browserFact({ equation: { subject: 'site', predicate: 'composer', object: 'old-box' }, target: 'site' }));
  browser.contradict(browserFact({ equation: { subject: 'site', predicate: 'composer', object: 'new-box' }, target: 'site' }));

  const superseded = browser.all().find((f) => f.status === 'superseded');
  const live = browser.live()[0];
  assert.ok(superseded && live);

  const res = transfer(browser, repair, {
    from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [superseded.signature, live.signature],
  });
  assert.equal(res.refused.length, 1);
  assert.equal(res.refused[0].reason, 'superseded');
  assert.equal(res.transferred.length, 1, 'the live replacement crossed');
  assert.equal(repair.live()[0].equation.object, 'new-box');
});

test('a fact cannot be transferred into the carrier it is already in', () => {
  const { browser, repair } = pair();
  repair.land(repairFact());
  const res = transfer(repair, repair, { from: 'repair', to: 'repair', nodeId: 'bridge', signatures: [repair.live()[0].signature] });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'same-carrier');
  assert.match(res.detail, /launder/);
});

test('an unknown carrier is refused at the door, both ways', () => {
  const { browser, repair } = pair();
  assert.equal(transfer(browser, repair, { from: 'browser', to: 'cockpit', nodeId: 'b' }).reason, 'carrier');
  assert.equal(transfer(browser, repair, { from: 'cockpit', to: 'repair', nodeId: 'b' }).reason, 'carrier');
  assert.equal(transfer(browser, repair, { to: 'repair', nodeId: '' }).reason, 'nodeId');
});

test('a transfer names the node that witnesses the arrival — and the registry holds it to that', () => {
  const dir = tmp();
  const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();
  nodes.register({ remote: 'https://github.com/me/twin-labs', localPath: '/x/twin-labs' });
  const repair = new Federation(dir, { nodes }).load();

  const browser = new Federation(tmp()).load();
  const src = browser.land(browserFact()).fact;

  const bad = transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'nobody', signatures: [src.signature] });
  assert.equal(bad.transferred.length, 0);
  assert.equal(bad.refused[0].reason, 'unregistered-node', 'identity is a registered fact, not a string');

  const good = transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'twin-labs', signatures: [src.signature] });
  assert.equal(good.transferred.length, 1);
});

// ------------------------------------------------------------------ idempotence

test('transferring twice is one witness, not two', () => {
  const { browser, repair } = pair();
  const src = browser.land(browserFact()).fact;
  const opts = { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [src.signature] };

  const first = transfer(browser, repair, opts);
  const second = transfer(browser, repair, opts);
  assert.equal(first.transferred[0].action, 'landed');
  assert.equal(second.transferred[0].action, 'already-witnessed');
  assert.equal(repair.live().length, 1);
  assert.equal(repair.live()[0].distinct, 1, 'a repeat transfer does not mint a witness');
});

test('the witness reference EXCLUDES the head, so new source writes cannot mint witnesses', () => {
  const { browser, repair } = pair();
  const src = browser.land(browserFact()).fact;
  const headBefore = browser.head;

  transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [src.signature] });

  // The browser store moves on. The observation did not change, so the arrival
  // must not look like a new one.
  browser.land(browserFact({ equation: { subject: 'other', predicate: 'p', object: 'q' }, target: 'other' }));
  assert.notEqual(browser.head, headBefore);

  const again = transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [src.signature] });
  assert.equal(again.transferred[0].action, 'already-witnessed');
  assert.equal(repair.live()[0].distinct, 1);
  assert.equal(repair.live()[0].witnesses[0].origin.head, headBefore, 'the origin still dates the reading it actually came from');
  assert.ok(!transferReference('browser', src).includes(headBefore.slice(0, 8)), 'and the reference carries no head at all');
});

// ------------------------------------------------------------------ the ledger

test('the door is logged on BOTH sides — a transfer only one side knows about cannot be audited', () => {
  const { browser, repair } = pair();
  const src = browser.land(browserFact()).fact;
  transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [src.signature], reason: 'relay run 7' });

  const out = browser.events.find((e) => e.kind === 'transfer-out');
  const inn = repair.events.find((e) => e.kind === 'transfer-in');
  assert.ok(out && inn, 'both sides recorded the crossing');
  assert.equal(out.to, 'repair');
  assert.equal(inn.from, 'browser');
  assert.equal(out.count, 1);
  assert.equal(inn.count, 1);
  assert.equal(inn.mechanical, true);
  assert.match(out.note, /relay run 7/);
  assert.deepEqual(inn.signatures, [repair.live()[0].signature]);
  assert.deepEqual(out.signatures, [src.signature]);

  // And the chains still verify on both sides.
  assert.deepEqual(new Federation(browser.dir).load().chain.breaks, []);
  assert.deepEqual(new Federation(repair.dir).load().chain.breaks, []);
});

test('the chains survive a reload: an arrived fact replays with its provenance', () => {
  const { browser, repair } = pair();
  const src = browser.land(browserFact()).fact;
  transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: [src.signature] });

  const reloaded = new Federation(repair.dir).load();
  assert.equal(reloaded.corrupt, 0);
  assert.equal(reloaded.carrierMigrated, 0, 'a v3 record needs no adoption');
  const f = reloaded.live()[0];
  assert.equal(f.carrier, 'repair');
  assert.equal(f.arrived, 1);
  assert.equal(f.observed, 0);
  assert.equal(f.witnesses[0].origin.factId, src.id);
  assert.equal(f.status, 'provisional');
});

test('"move everything" is not a default — a transfer moves named facts or a filter', () => {
  const { browser, repair } = pair();
  browser.land(browserFact());
  browser.land(browserFact({ equation: { subject: 'other', predicate: 'p', object: 'q' }, target: 'other' }));

  const nothing = transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'bridge' });
  assert.equal(nothing.ok, true);
  assert.equal(nothing.transferred.length, 0);
  assert.match(nothing.detail, /does not move everything by default/);
  assert.equal(repair.live().length, 0);

  const filtered = transfer(browser, repair, {
    from: 'browser', to: 'repair', nodeId: 'bridge',
    where: (f) => f.equation.subject === 'other',
  });
  assert.equal(filtered.transferred.length, 1);
  assert.equal(repair.live()[0].equation.subject, 'other');
});

test('a carrierless source export takes the declared carrier', () => {
  const { repair } = pair();
  // The browser store predates the axis, so its facts have no `carrier` field.
  // The caller names the population; the bridge does not guess per record.
  const legacyStore = {
    head: 'deadbeef'.repeat(8),
    live: () => [{
      id: 'f_old', signature: 'oldsig', shelf: 'operational', realm: 'shared',
      equation: { subject: 'site', predicate: 'composer', object: 'box', units: '', time: '' },
      rendered: 'composer(site) = box', target: 'site', status: 'provisional',
      witnesses: [{ sig: 'w', kind: 'structural', nodeId: 'seat', reference: 'r', at: '2026-01-01T00:00:00.000Z' }],
      distinct: 1, closedAt: null,
    }],
    all() { return this.live(); },
  };

  const noDecl = transfer(legacyStore, repair, { to: 'repair', nodeId: 'bridge', signatures: ['oldsig'] });
  assert.equal(noDecl.refused[0].reason, 'carrier', 'without a declaration it refuses rather than guesses');

  const declared = transfer(legacyStore, repair, { from: 'browser', to: 'repair', nodeId: 'bridge', signatures: ['oldsig'] });
  assert.equal(declared.transferred.length, 1);
  assert.equal(repair.live()[0].carrier, 'repair');
  assert.equal(repair.live()[0].witnesses[0].origin.carrier, 'browser');
});

test('the default destination carrier is this store\'s own population', () => {
  const { browser, repair } = pair();
  const src = browser.land(browserFact()).fact;
  const res = transfer(browser, repair, { from: 'browser', nodeId: 'bridge', signatures: [src.signature] });
  assert.equal(res.to, DEFAULT_CARRIER);
  assert.equal(repair.live()[0].carrier, 'repair');
});
