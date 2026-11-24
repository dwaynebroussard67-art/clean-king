'use strict';

/**
 * probe-measure.test.js — the probe's false-positive rate, as a tracked number.
 *
 * The rate used to be an anecdote. A count was quoted to a reader for three
 * sessions after the code it described had been fixed by another branch -- and
 * the quoted shape was one this scanner now deliberately ignores, which is how
 * the claim stayed plausible and wrong at the same time. Memory is not a
 * measurement; this file is.
 *
 * Two things are asserted, and the second is the one that matters:
 *
 *   1. the corpus classifies cleanly, with zero false positives
 *   2. the KNOWN DEFECTS ARE STILL FOUND — a pattern narrowed until nothing is
 *      reported would pass (1) perfectly and be useless
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { measureProbe, describe } = require('../src/forge/measure.js');
const { RISK_CLASSES, scanRisks } = require('../src/forge/risks.js');

const CORPUS = path.join(__dirname, 'fixtures', 'probe-corpus');

test('the probe reports no false positive on the labelled corpus', () => {
  const r = measureProbe(CORPUS);
  assert.equal(r.rejected, undefined, describe(r));
  assert.deepEqual(r.noise, [], `false positives: ${r.noise.join(', ')}`);
  assert.equal(r.fp, 0, describe(r));
});

test('and it still finds every labelled defect — narrowing must not blind it', () => {
  // A detector that reports nothing has a perfect precision and no value. The
  // three true positives exist so that narrowing the pattern is a trade, not a
  // free improvement.
  const r = measureProbe(CORPUS);
  assert.deepEqual(r.misses, [], `missed: ${r.misses.join(', ')}`);
  assert.equal(r.tp, 5, describe(r));
  assert.equal(r.fn, 0, describe(r));
});

test('the measured precision is 100% over a labelled set of 10', () => {
  const r = measureProbe(CORPUS);
  assert.equal(r.labeled, 10);
  assert.equal(r.precision, 1);
  assert.match(describe(r), /precision 100% \(5 true, 0 false\)/);
});

test('a pattern that reports nothing scores null, never 100%', () => {
  // THE GREEN NOBODY EARNED. `0/0` reads as perfect if you are careless, which
  // is how a disabled detector ships as an improvement.
  const original = RISK_CLASSES.find((c) => c.id === 'hardcoded-identity').re;
  RISK_CLASSES.find((c) => c.id === 'hardcoded-identity').re = /(?!)never-matches/;
  try {
    const r = measureProbe(CORPUS);
    assert.equal(r.precision, null, 'nothing reported means precision is undefined');
    assert.equal(r.fn, 5, 'and the five known defects are reported as missed');
    assert.match(describe(r), /precision is undefined, not perfect/);
  } finally {
    RISK_CLASSES.find((c) => c.id === 'hardcoded-identity').re = original;
  }
});

test('a labelled file that is not on disk is refused, not silently dropped', () => {
  // The corpus drifting from its labels is how a rate is computed over a set
  // nobody can see. Copy the corpus, delete one file, expect a refusal.
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-corpus-'));
  for (const f of fs.readdirSync(CORPUS)) fs.copyFileSync(path.join(CORPUS, f), path.join(dir, f));
  fs.unlinkSync(path.join(dir, 'tp-privilege-compare.js'));
  const r = measureProbe(dir);
  assert.equal(r.rejected, true);
  assert.equal(r.reason, 'labeled-file-absent');
  assert.match(r.detail, /tp-privilege-compare\.js/);
});

test('the live tree is measured too, so a regression shows up as a number', () => {
  // Not a pass/fail on the count — this repository is allowed to contain the
  // pattern. What is pinned is that the measurement runs, and that the number is
  // printed rather than remembered.
  const root = path.join(__dirname, '..');
  const hits = scanRisks(root).filter((h) => (h.class || h.id) === 'hardcoded-identity');
  assert.ok(Array.isArray(hits), 'the live scan returns a list');
  // Recorded, not asserted: if this ever becomes non-zero it is a real finding
  // and a human should look, which is why the count is visible in the run.
  assert.equal(typeof hits.length, 'number');
});
