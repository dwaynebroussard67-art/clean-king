'use strict';

/**
 * twin-labs-real.test.js — the seam, run against the REAL repair engine.
 *
 * THE LIMITATION THIS REMOVES
 *
 * Every cycle this repository had ever read was built by `test/helpers/cycle.js`
 * — a fixture that writes events in Twin Labs' format. That made the lesson seam
 * checkable but unproven: the fixture was our reading of their format, and a
 * change to their engine could not have failed a test here. The research doc
 * listed "no cycle came from a real repair engine" as the binding constraint on
 * the whole arc.
 *
 * Twin Labs is now in `twin-labs/`, so the constraint is gone for the reading
 * half. These tests drive `runRepositoryCycle` — their engine, their ledger,
 * their gates — and hand the result to `readCycle` unchanged.
 *
 * IT IMMEDIATELY FOUND A BUG, WHICH IS THE POINT
 *
 * The first run was refused as `summary-disagrees`: our reader counted four
 * passing gate evaluations where their summary said three, and accused them of
 * overstating. They were right and we were wrong. Their engine re-tests the
 * promoted source with fresh parameters AFTER promotion, against the same
 * candidate manifest, so "any passing evaluation against the candidate" is not
 * the set of gates. `repository.promoted.gateIds` is, and a gate is properly
 * defined as an evaluation the promotion DEPENDS ON.
 *
 * The fixture could never have caught that. It only ever recorded the events we
 * thought to write, and we did not think of the fresh retest.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TWIN = path.join(ROOT, 'twin-labs', 'Endgame2-main');

const { canonical, digest } = require(path.join(TWIN, 'twin-lab', 'lib', 'evidence-ledger.js'));
const { runRepositoryCycle } = require(path.join(TWIN, 'twin-lab', 'evolution', 'repository-cycle.js'));
const { readCycle, landLesson } = require(path.join(ROOT, 'src', 'forge', 'lessons.js'));
const { fedWith } = require(path.join(ROOT, 'test', 'helpers', 'fed.js'));

/**
 * A real source tree with a real defect: `value` is 1 and the contract wants 2.
 * Nothing here is a simulation of a defect -- the probe genuinely fails on the
 * baseline and genuinely passes on the candidate.
 */
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-twin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const source = path.join(root, 'source');
  const dependencies = path.join(root, 'dependencies');
  fs.mkdirSync(source);
  fs.mkdirSync(dependencies);
  fs.writeFileSync(path.join(source, 'app.json'), '{"value":1}\n');
  fs.writeFileSync(path.join(source, 'regression.cjs'), 'console.log("1 passed");\n');

  const probe = path.join(root, 'probe.cjs');
  fs.writeFileSync(
    probe,
    "const fs=require('fs'),path=require('path');const app=JSON.parse(fs.readFileSync(path.join(process.env.TWIN_TARGET,'app.json')));" +
      "console.log(JSON.stringify({schemaVersion:1,rows:[{id:'value-contract',passed:app.value===2},{id:'control',passed:true}]}));\n"
  );

  const dependencyLock = path.join(root, 'lock.json');
  fs.writeFileSync(dependencyLock, '{}');

  const patchFile = path.join(root, 'patch.json');
  fs.writeFileSync(
    patchFile,
    canonical([
      {
        path: 'app.json',
        beforeSha256: digest(fs.readFileSync(path.join(source, 'app.json'))),
        afterBase64: Buffer.from('{"value":2}\n').toString('base64'),
      },
    ])
  );

  return {
    root,
    out: path.join(root, 'cycle'),
    config: {
      project: 'forge-bridge-fixture',
      intake: { source: 'Forge-authored fixture, not customer evidence' },
      scope: 'bridge test: does a real engine cycle survive our reader',
      sourceDirectory: source,
      probeFile: probe,
      dependenciesRoot: dependencies,
      dependencyLock,
      patchFile,
      allowedPaths: ['app.json'],
      caseIds: ['value-contract', 'control'],
      native: [['regression.cjs']],
    },
  };
}

const readEvents = (out) =>
  fs
    .readFileSync(path.join(out, 'ledger', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

test('a REAL Twin Labs cycle is read by our reader, unmodified', (t) => {
  const { out, config } = fixture(t);
  runRepositoryCycle(out, config);

  const r = readCycle(out);
  assert.equal(r.ok, true, `refused: ${r.reason} — ${r.detail}`);
  assert.equal(r.cycle.project, 'forge-bridge-fixture');
  assert.deepEqual(r.cycle.changedPaths, ['app.json']);
});

test('the gate count follows the promotion, not every passing evaluation', (t) => {
  // THE BUG THIS TEST EXISTS FOR. If this ever reverts to "any passing
  // evaluation against the candidate", a genuine cycle is refused as
  // summary-disagrees and the reader accuses a correct engine of lying.
  const { out, config } = fixture(t);
  runRepositoryCycle(out, config);
  const events = readEvents(out);

  const promoted = events.find((e) => e.type === 'repository.promoted');
  const candidateId = events.find((e) => e.type === 'repository.candidate').data.manifestId;
  const passingAgainstCandidate = events.filter(
    (e) => e.type === 'repository.evaluated' && e.data.targetId === candidateId && e.data.passed === true
  );
  const freshRetest = events.filter((e) => e.type === 'repository.evaluated' && e.data.specName === 'fresh-retest');

  assert.equal(freshRetest.length, 1, 'the engine still runs a post-promotion fresh retest — the trap is still there');
  assert.equal(
    passingAgainstCandidate.length,
    promoted.data.gateIds.length + 1,
    'exactly one passing candidate evaluation is not a gate: the fresh retest'
  );

  const r = readCycle(out);
  assert.equal(r.ok, true);
  assert.equal(r.cycle.gatesRecorded, promoted.data.gateIds.length);
  assert.ok(r.cycle.gatesPassed > 0);
});

test('the summary is a claim: rewriting it changes nothing we read', (t) => {
  const { out, config } = fixture(t);
  runRepositoryCycle(out, config);
  const before = readCycle(out);
  assert.equal(before.ok, true);

  // Overstate the evidence in the one file nobody hashed.
  const summaryPath = path.join(out, 'summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  summary.passedGates = 11;
  summary.reproducedFailingCases = 9;
  summary.changedPaths = ['app.json', 'test/app.test.js'];
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const after = readCycle(out);
  assert.equal(after.rejected, true, 'a cycle whose summary was inflated must not read as clean');
  assert.equal(after.reason, 'summary-disagrees');
  assert.match(after.detail, /passedGates/);
});

test('a real cycle lands as a bar in a commons, with its scope intact', (t) => {
  const { out, config } = fixture(t);
  runRepositoryCycle(out, config);

  const read = readCycle(out);
  assert.equal(read.ok, true);

  const fed = fedWith('forge-bridge-fixture');
  const landed = landLesson(fed, read.cycle, { slug: 'forge-bridge-fixture', nodeId: 'forge-bridge-fixture' });
  assert.equal(landed.ok, true, `refused: ${landed.reason} — ${landed.detail || ''}`);

  // The bar must carry the count that actually passed, and the scope must travel
  // with it, or the lesson arrives somewhere as a rule.
  const bar = landed.landed.find((x) => x.predicate === 'risk_repair_bar');
  assert.ok(bar, 'a verified cycle lands a repair bar');
  assert.match(bar.rendered, /3-gates-passed/, `the bar names the gates that passed: ${bar.rendered}`);
  assert.match(bar.rendered, /exact-parent-edits-only/);
  assert.match(bar.rendered, /promoted-not-released/);

  const scope = landed.landed.find((x) => x.predicate === 'claim_scope');
  assert.ok(scope, 'the scope travels with the claim');
  assert.equal(landed.scope, 'bounded-historical-observation-not-universal-rule');
});

test('the engine refuses a repair when the defect does not reproduce here', (t) => {
  // Not our refusal — theirs. Recorded because a reader of this repository
  // should know the soundness stance is shared, and that we are not the only
  // thing standing between a claim and a lie.
  const { root, config } = fixture(t);
  const patchFile = path.join(root, 'patch.json');
  fs.writeFileSync(
    patchFile,
    canonical([
      {
        path: 'app.json',
        beforeSha256: digest(fs.readFileSync(path.join(config.sourceDirectory, 'app.json'))),
        afterBase64: Buffer.from('{"value":2}\n').toString('base64'),
      },
    ])
  );

  // A probe that reports the contract as already satisfied.
  fs.writeFileSync(
    config.probeFile,
    "console.log(JSON.stringify({schemaVersion:1,rows:[{id:'value-contract',passed:true},{id:'control',passed:true}]}));\n"
  );

  assert.throws(() => runRepositoryCycle(path.join(root, 'cycle2'), config), /No reproduced source defect/);
});
