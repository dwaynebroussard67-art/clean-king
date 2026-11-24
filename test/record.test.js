'use strict';

/**
 * record.test.js — a cycle that is not built by the fixture.
 *
 * Every other cycle in this repository comes from `test/helpers/cycle.js`. That
 * helper is a faithful emitter of the published format and the red queen's forty
 * attacks all run against its output — which means, until this file, the
 * verifier was only ever cross-checked against itself.
 *
 * Here a real repair happens. A real bug is written to a real file, a real test
 * command is run against it and fails, a real edit is applied, the command runs
 * again and passes, and `src/forge/record.js` writes the ledger from those
 * observations. Then the ordinary reader verifies it without knowing any of that.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { recordRepair, manifest, changedBetween } = require('../src/forge/record.js');
const { readCycle, landLesson } = require('../src/forge/lessons.js');
const { fedWith } = require('./helpers/fed.js');

const TEST_CMD = { command: process.execPath, args: ['--test', '--test-reporter=tap', 'test/sum.test.js'] };

/** A tiny repository with one genuine bug: `sum` returns a difference. */
function repoWithBug() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-real-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'src', 'sum.js'), 'module.exports = (a, b) => a - b;\n');
  fs.writeFileSync(
    path.join(dir, 'test', 'sum.test.js'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const sum = require('../src/sum.js');",
      "test('adds', () => assert.equal(sum(2, 3), 5));",
      '',
    ].join('\n')
  );
  return dir;
}

/** The repair: a real edit to the real file. */
function fixSum(dir) {
  const p = path.join(dir, 'src', 'sum.js');
  const before = fs.readFileSync(p, 'utf8');
  const after = before.replace('a - b', 'a + b');
  if (after === before) return { rejected: true, reason: 'repair-found-nothing', detail: 'the bug was not where the repair expected it' };
  fs.writeFileSync(p, after);
  return { ok: true };
}

const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-cycle-'));

test('a real repair records a cycle the ordinary reader verifies', () => {
  const repo = repoWithBug();
  const out = outDir();
  const res = recordRepair({ repoDir: repo, outDir: out, project: 'clearcut', runId: 'run-real-1', test: TEST_CMD, repair: fixSum, gateNames: ['native', 'fresh-retest'] });
  assert.equal(res.rejected, undefined, `${res.reason}: ${res.detail}`);

  const read = readCycle(out);
  assert.equal(read.ok, true, `the recorded cycle must verify from scratch: ${read.reason} ${read.detail || ''}`);
  const c = read.cycle;
  assert.equal(c.runId, 'run-real-1');
  assert.deepEqual(c.changedPaths, ['src/sum.js'], 'one real file changed');
  assert.equal(c.gatesRecorded, 2);
  assert.equal(c.gatesPassed, 2, 'both gates ran the suite and it passed');
  assert.deepEqual(c.gatesWithoutSignal, [], 'and each recorded a real test signal');
  assert.equal(c.reproducedFailingCases, 1, 'the failing case was read from real TAP output');
  assert.match(c.promotedStatus, /promotion-not-release/);
});

test('the recorded cycle lands a lesson — a real cycle, not a fixture', () => {
  const repo = repoWithBug();
  const out = outDir();
  assert.equal(recordRepair({ repoDir: repo, outDir: out, project: 'clearcut', runId: 'run-real-2', test: TEST_CMD, repair: fixSum }).rejected, undefined);
  const { cycle } = readCycle(out);

  const fed = fedWith('clearcut');
  const res = landLesson(fed, cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  assert.equal(res.refused.length, 0, JSON.stringify(res.refused));
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar');
  assert.ok(bar, 'the commons holds a bar derived from a repair that happened');
  assert.match(bar.equation.object, /1-gates-passed/);
  assert.match(bar.equation.object, /exact-parent-edits-only/);
});

test('the manifests are hashes of real content, so an edit is visible', () => {
  const repo = repoWithBug();
  const before = manifest(repo);
  fs.appendFileSync(path.join(repo, 'src', 'sum.js'), '\n// a comment\n');
  const after = manifest(repo);
  assert.deepEqual(changedBetween(before, after), ['src/sum.js']);
  const f = after.files.find((x) => x.path === 'src/sum.js');
  assert.equal(f.sha256.length, 64);
  assert.ok(f.bytes > 0);
});

// ------------------------------------------------------------------ refusals
//
// The recorder is where a dishonest cycle would be manufactured, so every way it
// could be talked into writing one is a test.

test('it refuses to record a cycle when the suite already passes', () => {
  const repo = repoWithBug();
  fixSum(repo); // repaired before recording: nothing to record
  const res = recordRepair({ repoDir: repo, outDir: outDir(), project: 'clearcut', test: TEST_CMD, repair: fixSum });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'nothing-to-repair');
});

test('it refuses a cycle whose repair did not make the suite pass', () => {
  const repo = repoWithBug();
  const res = recordRepair({
    repoDir: repo,
    outDir: outDir(),
    project: 'clearcut',
    test: TEST_CMD,
    repair: (d) => {
      fs.appendFileSync(path.join(d, 'src', 'sum.js'), '\n// still wrong, but changed\n');
      return { ok: true };
    },
  });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'repair-did-not-pass');
  assert.match(res.detail, /will not write a cycle whose own tests fail/);
});

test('it refuses a repair that changed nothing', () => {
  const repo = repoWithBug();
  const res = recordRepair({ repoDir: repo, outDir: outDir(), project: 'clearcut', test: TEST_CMD, repair: () => ({ ok: true }) });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'repair-changed-nothing');
});

test('it refuses a harness that fails without naming a case', () => {
  const repo = repoWithBug();
  const res = recordRepair({
    repoDir: repo,
    outDir: outDir(),
    project: 'clearcut',
    test: { command: process.execPath, args: ['-e', 'process.exit(1)'] },
    repair: fixSum,
  });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'no-named-failing-case');
});

test('it refuses to put the cycle inside the tree it is hashing', () => {
  const repo = repoWithBug();
  const res = recordRepair({ repoDir: repo, outDir: path.join(repo, 'cycle'), project: 'clearcut', test: TEST_CMD, repair: fixSum });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'cycle-inside-repo');
});

test('it refuses to record a gate that exited 0 having run nothing', () => {
  // The D1 hole, in the recorder. A harness that names a failure before the
  // repair and then exits 0 silently afterwards is exactly the shape of a
  // test script that stopped discovering its tests: green, and proving nothing.
  // It must not be able to write a passing gate into a hash chain.
  const repo = repoWithBug();
  const script = [
    "const fs = require('node:fs');",
    "const src = fs.readFileSync('src/sum.js', 'utf8');",
    "if (src.includes('a - b')) { process.stdout.write('not ok 1 - adds\\n'); process.exit(1); }",
    'process.exit(0);',
  ].join(' ');
  const res = recordRepair({
    repoDir: repo,
    outDir: outDir(),
    project: 'clearcut',
    test: { command: process.execPath, args: ['-e', script] },
    repair: fixSum,
  });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'gate-ran-nothing');
  assert.match(res.detail, /produced no test signal/);
});
