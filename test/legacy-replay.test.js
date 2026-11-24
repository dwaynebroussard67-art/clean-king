'use strict';

/**
 * The reshape only counts if nothing already on disk is lost.
 *
 * These tests write logs in the OLD format — no `realm` field, signatures
 * computed with `equationSignature(equation, shelf)` — including one stamped
 * with the original OmniBox-era schema id — and then open them with the new
 * store. The standard is the one D26 set for the rename: a reshape that only
 * changed strings would have started every existing carrier from nothing,
 * with its whole history sitting one key over and invisible.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Federation, chainHash, GENESIS } = require('../src/federation/store.js');
const { equationSignature } = require('../src/passport/equation.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-legacy-'));

/** Write a log exactly the way the pre-realm store wrote it. */
function writeLegacyLog(dir, facts, schema = 'forgeflight.federation.v1') {
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, 'federation.jsonl');
  let head = GENESIS;
  const lines = [];
  for (const f of facts) {
    const data = {
      id: f.id,
      schema,
      // The old key: scope slot filled by the shelf, because realms did not exist.
      signature: equationSignature(f.equation, f.shelf),
      shelf: f.shelf,
      equation: f.equation,
      rendered: `${f.equation.predicate}(${f.equation.subject}) = ${f.equation.object}`,
      target: f.target || null,
      status: f.status || 'provisional',
      witnesses: f.witnesses || [],
      distinct: (f.witnesses || []).length || 1,
      landedAt: f.at,
      lastSeenAt: f.at,
      supersededBy: null,
      closedAt: null,
      closedBy: null,
    };
    const rec = { op: 'fact', data };
    const prev = head;
    const hash = chainHash(prev, rec);
    lines.push(JSON.stringify({ ...rec, prev, hash }));
    head = hash;
  }
  fs.writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');
  return logPath;
}

const OLD_FACTS = [
  {
    id: 'f_old1',
    shelf: 'world',
    equation: { subject: 'france', predicate: 'capital', object: 'paris', units: '', time: '' },
    witnesses: [{ sig: 'w1', kind: 'structural', nodeId: 'local-cockpit', reference: 'claim:1', at: '2026-09-04T00:00:00.000Z' }],
    at: '2026-09-04T00:00:00.000Z',
  },
  {
    id: 'f_old2',
    shelf: 'operational',
    equation: { subject: 'claude.ai', predicate: 'composer', object: '[data-testid=prompt-input]', units: '', time: '' },
    target: 'claude.ai',
    witnesses: [{ sig: 'w2', kind: 'structural', nodeId: 'local-cockpit', reference: 'claim:2', at: '2026-09-04T00:00:00.000Z' }],
    at: '2026-09-04T00:00:00.000Z',
  },
];

test('a pre-realm log replays with the chain intact', () => {
  const dir = tmp();
  writeLegacyLog(dir, OLD_FACTS);
  const fed = new Federation(dir).load();

  assert.deepEqual(fed.verify().breaks, []);
  assert.equal(fed.corrupt, 0);
  assert.equal(fed.live().length, 2);
});

test('an OmniBox-era log replays too — the schema id is a label, never a check', () => {
  const dir = tmp();
  writeLegacyLog(dir, OLD_FACTS, 'omnibox.collective.v1');
  const fed = new Federation(dir).load();

  assert.deepEqual(fed.verify().breaks, []);
  assert.equal(fed.live().length, 2);
  assert.equal(fed.live()[0].schema, 'omnibox.collective.v1');
  assert.equal(fed.live()[0].realm, 'shared');
});

test('old facts are adopted into the commons, not stranded', () => {
  const dir = tmp();
  writeLegacyLog(dir, OLD_FACTS);
  const fed = new Federation(dir).load();

  assert.equal(fed.migrated, 2);
  for (const f of fed.live()) assert.equal(f.realm, 'shared');
  assert.equal(fed.stats().byRealm.shared, 2);
});

test('the migration MERGES instead of duplicating — the whole point', () => {
  const dir = tmp();
  writeLegacyLog(dir, OLD_FACTS);
  const fed = new Federation(dir).load();
  const before = fed.live().length;

  // The same claim, witnessed again after the reshape.
  const res = fed.land({
    shelf: 'world',
    realm: 'shared',
    equation: { subject: 'france', predicate: 'capital', object: 'paris' },
    witness: 'structural',
    nodeId: 'twld',
    reference: 'claim:new',
  });

  // One fact with two witnesses — not two facts.
  assert.equal(res.action, 'witnessed');
  assert.equal(fed.live().length, before);
  assert.equal(res.fact.distinct, 2);
  assert.equal(res.fact.id, 'f_old1', 'the original record kept its identity');
});

test('re-keying on load does not touch the hash chain', () => {
  const dir = tmp();
  const logPath = writeLegacyLog(dir, OLD_FACTS);
  const bytesBefore = fs.readFileSync(logPath, 'utf8');

  new Federation(dir).load();
  new Federation(dir).load();
  const bytesAfter = fs.readFileSync(logPath, 'utf8');

  assert.equal(bytesAfter, bytesBefore, 'reading must never rewrite the log');
});

test('a torn final line is dropped and reported, never fatal', () => {
  const dir = tmp();
  const logPath = writeLegacyLog(dir, OLD_FACTS);
  fs.appendFileSync(logPath, '{"op":"fact","data":{"partial":tru', 'utf8');

  const fed = new Federation(dir).load();
  assert.equal(fed.live().length, 2);
  assert.equal(fed.verify().torn, true);
  assert.equal(fed.corrupt, 0);
});
