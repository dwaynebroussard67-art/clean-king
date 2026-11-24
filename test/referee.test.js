'use strict';

/**
 * referee.test.js — the definition of a run that proves something.
 *
 * This vocabulary is load-bearing for TWO subsystems that were written
 * independently and originally disagreed:
 *
 *   · the actuator, which refuses to COMMIT a green that ran no tests
 *   · the bar, which refuses to COUNT a gate that ran no tests
 *
 * Before they shared it, a cycle the actuator would reject could still file a
 * lesson publishing its gate count to the whole federation. So the interesting
 * assertions here are not "the regex works". They are:
 *
 *   · a healthy run is never mistaken for an empty one (`failed: 0` is green)
 *   · an unfamiliar schema is `unknown`, NOT `absent` — the ledger format
 *     belongs to somebody else, and silence is not evidence of absence
 *   · there is exactly one definition, and the actuator imports it
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { gateSignal, hasTestSignal, TEST_SIGNAL, RUN_COUNT_FIELDS } = require('../src/forge/referee.js');

// ---------------------------------------------------------------- the vocabulary

test('TEST_SIGNAL recognises the runners this federation actually meets', () => {
  assert.ok(hasTestSignal('# tests 217\n# pass 217\n# fail 0'), 'node --test TAP summary');
  assert.ok(hasTestSignal('217 passing (1.2s)'), 'mocha');
  assert.ok(hasTestSignal('Tests: 41 passed, 41 total'), 'jest');
  assert.ok(hasTestSignal('Test Files  14 passed (14)'), 'vitest');
});

test('output that proves nothing is not signal', () => {
  assert.equal(hasTestSignal(''), false, 'empty output');
  assert.equal(hasTestSignal('   \n  '), false, 'whitespace');
  assert.equal(hasTestSignal('ok'), false, 'a word is not a count');
  assert.equal(hasTestSignal('Done in 1.2s'), false, 'a build that ran no tests still finishes');
  assert.equal(hasTestSignal(null), false, 'and a missing value does not throw');
  assert.equal(hasTestSignal(undefined), false);
});

// ---------------------------------------------------------------- the classifier

test('a gate that positively records an empty run is ABSENT', () => {
  assert.equal(gateSignal({ passed: true, testsRun: 0, output: '' }), 'absent');
  assert.equal(gateSignal({ passed: true, testsRun: 0 }), 'absent', 'a zero run-size alone is enough');
  assert.equal(gateSignal({ passed: true, output: '   ' }), 'absent', 'an output field present but blank');
  assert.equal(gateSignal({ passed: true, total: 0 }), 'absent');
});

test('a gate that positively records a run is PRESENT', () => {
  assert.equal(gateSignal({ passed: true, tests: 217 }), 'present', 'a run-size count');
  assert.equal(gateSignal({ passed: true, output: '# tests 3\n# pass 3' }), 'present', 'runner output');
  assert.equal(gateSignal({ passed: true, suites: 1 }), 'present');
});

test('a healthy run is never read as an empty one', () => {
  // THE IMPORTANT ONE. `failed: 0` is what green looks like. A classifier that
  // treated any zero as "nothing ran" would refuse every passing cycle in the
  // federation, which is noise dressed as rigor.
  assert.equal(gateSignal({ passed: true, failed: 0 }), 'unknown');
  assert.equal(gateSignal({ passed: true, failed: 0, skipped: 0 }), 'unknown');
  assert.equal(gateSignal({ passed: true, passed: 0 }), 'unknown', 'a boolean verdict is not a run size');
  for (const f of ['passed', 'failed', 'skipped', 'todo']) {
    assert.ok(!RUN_COUNT_FIELDS.includes(f), `${f} must not be a run-size field`);
  }
});

test('a schema this reader has never seen is UNKNOWN, not absent', () => {
  // The ledger format is Twin Labs'. Refusing what we do not recognise would
  // turn every unfamiliar cycle into a refusal nobody can act on.
  assert.equal(gateSignal({ passed: true }), 'unknown', 'a bare verdict');
  assert.equal(gateSignal({ passed: true, someFieldNobodyDefined: 0 }), 'unknown');
  assert.equal(gateSignal({}), 'unknown');
  assert.equal(gateSignal(null), 'unknown');
  assert.equal(gateSignal(undefined), 'unknown');
  assert.equal(gateSignal('passed'), 'unknown', 'a non-object does not throw');
  assert.equal(gateSignal([1, 2, 3]), 'unknown', 'nor does an array');
});

test('a positive run outweighs a zero elsewhere in the same blob', () => {
  assert.equal(gateSignal({ passed: true, testsRun: 41, skipped: 0 }), 'present');
});

// ---------------------------------------------------------------- one definition

test('the actuator imports this vocabulary instead of keeping its own', () => {
  // Duplication is the defect this file exists to prevent, so it is tested
  // rather than merely commented on. Two definitions of "a test ran" is how the
  // write path and the memory path came to disagree in the first place.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'federation', 'actuator.js'), 'utf8');
  assert.ok(!/const TEST_SIGNAL\s*=\s*\[/.test(src), 'actuator.js must not define its own TEST_SIGNAL');
  assert.match(
    src,
    /require\('\.\.\/forge\/referee\.js'\)/,
    'actuator.js must require the referee'
  );
  const importLine = src.split('\n').find((l) => l.includes("require('../forge/referee.js')"));
  assert.ok(importLine && importLine.includes('TEST_SIGNAL'), `the import must name TEST_SIGNAL: ${importLine}`);
});

test('the referee exports what both callers need', () => {
  assert.equal(typeof gateSignal, 'function');
  assert.equal(typeof hasTestSignal, 'function');
  assert.ok(Array.isArray(TEST_SIGNAL) && TEST_SIGNAL.length > 0);
  assert.ok(TEST_SIGNAL.every((re) => re instanceof RegExp), 'each pattern is a RegExp');
});
