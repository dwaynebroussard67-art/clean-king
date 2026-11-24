'use strict';

/**
 * heldout.test.js — the held-out runner, and the rules that keep it honest.
 *
 * The runner is the one part of this system that grades the agent rather than
 * being graded by it, so its own failure modes are the ones that matter most.
 * Two rules are load-bearing:
 *
 *   · NOT-APPLICABLE is never a pass. An attack naming a seam this system does
 *     not have scored as "blocked" would make the whole set decoration.
 *   · A check that THROWS is a FAIL, not inapplicable. A seam that crashes
 *     instead of refusing cleanly has not held.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'test', 'fixtures', 'heldout-sample');
const BIN = path.join(ROOT, 'bin', 'heldout.js');
const { run, runOne, components } = require(path.join(ROOT, 'src', 'forge', 'heldout.js'));
const { SKIP } = require(path.join(ROOT, 'src', 'forge', 'risks.js'));

function tmpAttack(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-heldout-'));
  setup(dir);
  return dir;
}

const runBin = (env = {}) => {
  const e = { ...process.env, ...env };
  if (!('FORGE_HELDOUT_DIR' in env)) delete e.FORGE_HELDOUT_DIR;
  delete e.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [BIN], { cwd: ROOT, encoding: 'utf8', env: e });
};

test('the published vocabulary matches the components the spec lists', () => {
  const c = components();
  assert.deepEqual(Object.keys(c).sort(), ['bar', 'ledger', 'lesson', 'passport', 'probe', 'record', 'store']);
  for (const [name, spec] of Object.entries(c)) {
    assert.ok(spec.expected.length >= 2, `${name} must say what both outcomes are called`);
  }
});

test('the sample set produces the verdicts its metadata asks for', () => {
  const results = run(SAMPLE);
  const byId = Object.fromEntries(results.map((r) => [r.id, r.verdict]));
  assert.equal(byId[1], 'PASS', 'a clean file scans clean');
  assert.equal(byId[2], 'PASS', 'a privileged comparison is flagged');
  assert.equal(byId[3], 'NOT-APPLICABLE', 'an unknown check has no seam');
  assert.equal(byId[4], 'NOT-APPLICABLE', 'an unknown expected value has no seam');
  assert.equal(byId[5], 'PASS', 'an invented witness kind is refused');
  assert.equal(byId[6], 'PASS', 'the passport prints an instruction marker — the known hole');
});

test('an unset FORGE_HELDOUT_DIR is NOT RUN and is not a pass', () => {
  const r = runBin({});
  assert.equal(r.status, 0);
  assert.match(r.stdout, /NOT RUN/);
  assert.doesNotMatch(r.stdout, /\bPASS\b/, 'the word PASS must not appear in an unrun report');
});

test('a directory with no attacks is NOT RUN and exits non-zero', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-heldout-empty-'));
  const r = runBin({ FORGE_HELDOUT_DIR: empty });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NOT RUN/);
});

test('a failing attack exits non-zero and the report carries no wording', () => {
  const dir = tmpAttack((d) => {
    const a = path.join(d, 'attacks', '01');
    fs.mkdirSync(path.join(a, 'files'), { recursive: true });
    fs.writeFileSync(path.join(a, 'attack.json'), JSON.stringify({ id: 1, component: 'probe', check: 'scan', expected: 'flagged' }));
    fs.writeFileSync(path.join(a, 'files', 'clean.js'), 'module.exports = 1;\n');
  });
  const r = runBin({ FORGE_HELDOUT_DIR: dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^1\tFAIL$/m);
  assert.doesNotMatch(r.stdout, /hit\(s\)/, 'the operator log must not print by default');
});

test('a set that is entirely NOT-APPLICABLE does not pass', () => {
  const dir = tmpAttack((d) => {
    const a = path.join(d, 'attacks', '01');
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(a, 'attack.json'), JSON.stringify({ id: 1, component: 'probe', check: 'teleport', expected: 'clean' }));
  });
  const r = runBin({ FORGE_HELDOUT_DIR: dir });
  assert.equal(r.status, 1, 'zero applicable attacks is zero evidence');
  assert.match(r.stdout, /^1\tNOT-APPLICABLE$/m);
});

test('a seam that throws is a FAIL, not inapplicable', () => {
  const dir = tmpAttack((d) => {
    const a = path.join(d, 'attacks', '01');
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(a, 'attack.json'), JSON.stringify({ id: 1, component: 'store', check: 'land-fact', expected: 'landed' }));
    fs.writeFileSync(path.join(a, 'fact.json'), '{ this is not json');
  });
  const r = runOne(path.join(dir, 'attacks', '01'));
  assert.equal(r.verdict, 'FAIL');
  assert.match(r.detail, /threw/);
});

test('a missing input file is NOT-APPLICABLE, because the attack was misdeclared', () => {
  const dir = tmpAttack((d) => {
    const a = path.join(d, 'attacks', '01');
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(a, 'attack.json'), JSON.stringify({ id: 1, component: 'probe', check: 'scan', expected: 'clean' }));
  });
  const r = runOne(path.join(dir, 'attacks', '01'));
  assert.equal(r.verdict, 'NOT-APPLICABLE');
  assert.match(r.detail, /bad-attack/);
});

test('the skip list matches whole path segments, not substrings', () => {
  // THE BUG THIS EXISTS FOR. `/out/` was unanchored, so a directory called
  // `heldout-sample` contained "out" and every file under it was skipped — the
  // scanner reported `clean` about a tree it never opened. A held-out attack
  // stored in such a folder would have passed for the worst possible reason.
  assert.equal(SKIP.test('node_modules/x.js'), true);
  assert.equal(SKIP.test('dist/x.js'), true);
  assert.equal(SKIP.test('src/out/x.js'), true);
  assert.equal(SKIP.test('heldout-sample/x.js'), false);
  assert.equal(SKIP.test('src/about/x.js'), false);
  assert.equal(SKIP.test('checkout/x.js'), false);
  assert.equal(SKIP.test('layout/x.js'), false);
});
