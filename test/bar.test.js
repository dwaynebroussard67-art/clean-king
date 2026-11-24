'use strict';

/**
 * bar.test.js — the repair bar as a precondition, not as prose.
 *
 * The interesting assertions here are not "the check works". They are the ones
 * that pin what the guard REFUSES TO DO:
 *
 *   · it will not check a bar it could only half read, and call that a pass
 *   · it will not treat "I could not tell" as "fine"
 *   · it will not hold one repository to another repository's bar
 *   · it will not hold an agent to a bar the agent was never shown
 *   · it will not accept a receipt somebody loosened after issue
 *   · it writes nothing
 *
 * Every one of those is a way for a guide to become a rule, or for a rule to
 * become decoration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildCycle } = require('./helpers/cycle.js');
const { fedWith, tmp } = require('./helpers/fed.js');
const { readCycle, landLesson } = require('../src/forge/lessons.js');
const {
  parseBar,
  checkBar,
  readBar,
  issueBar,
  writeBarReceipt,
  readBarReceipt,
  guardCycle,
  drift,
  isTestPath,
  OBLIGATIONS,
  TEST_PATTERNS,
  LOCAL_PROMOTION,
  BAR_SCHEMA,
} = require('../src/forge/bar.js');

/** A whole-second timestamp on 2026-10-<day>. The fixture builder stamps every
 *  event with the same instant by default, so tests that care about recency have
 *  to say which cycle is later — recency is read off the cycle's own chain. */
const AT = (day, hour = 12) => new Date(Date.UTC(2026, 9, day, hour, 0, 0)).toISOString();

/** Build a cycle and read it back, failing loudly if it did not verify. */
function cycle(dir, opts = {}) {
  const built = buildCycle(dir, opts);
  const read = readCycle(dir);
  assert.equal(read.ok, true, `the fixture cycle must verify: ${JSON.stringify(read.reason || read.detail)}`);
  return { built, cycle: read.cycle };
}

/** Land a lesson so the commons holds a bar for `slug`, then return the pieces. */
function withBar(fed, slug, opts = {}) {
  const dir = tmp();
  const { built, cycle: c } = cycle(dir, { project: slug, ...opts });
  const res = landLesson(fed, c, { slug, nodeId: slug });
  assert.equal(res.refused.length, 0, `the fixture lesson must land cleanly: ${JSON.stringify(res.refused)}`);
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar' && f.equation.subject === `repo:${slug}`);
  assert.ok(bar, 'a landed lesson leaves a bar in the commons');
  return { dir, built, cycle: c, landed: res, bar };
}

// ---------------------------------------------------------------- parsing

test('a well-formed bar parses into obligations this reader can check', () => {
  const p = parseBar('exact-parent-edits-only;native-tests-unchanged;3-gates-passed;promoted-not-released');
  assert.equal(p.unverifiable, false);
  assert.deepEqual(p.unrecognized, []);
  assert.deepEqual(p.obligations.map((o) => o.kind), ['exact-parent-edits-only', 'native-tests-unchanged', 'gates-passed', 'promoted-not-released']);
  assert.equal(p.obligations[2].min, 3);
  assert.equal(p.tokens.length, 4);
});

test('an unknown token makes the WHOLE bar unverifiable — not partially checked', () => {
  // This is the assertion that matters. A reader that skipped the token it did
  // not know and reported `met` on the three it did would be reporting a pass
  // over a bar it never fully read.
  const p = parseBar('exact-parent-edits-only;no-new-dependencies;3-gates-passed');
  assert.equal(p.unverifiable, true);
  assert.deepEqual(p.unrecognized, ['no-new-dependencies']);
  assert.match(p.problems.join(' '), /no check for/);
  assert.match(p.problems.join(' '), /will not check the ones it recognises/);

  const checked = checkBar({ object: 'exact-parent-edits-only;no-new-dependencies;3-gates-passed' }, { gatesPassed: 9 });
  assert.equal(checked.comparable, false);
  assert.equal(checked.reason, 'bar-unverifiable');
  assert.deepEqual(checked.obligations, [], 'nothing is checked, so nothing is reported as met');
});

test('a bar that contradicts itself is refused rather than resolved', () => {
  const p = parseBar('3-gates-passed;5-gates-passed');
  assert.equal(p.unverifiable, true);
  assert.match(p.problems.join(' '), /conflicting gate minimums/);
  assert.match(p.problems.join(' '), /3 vs 5/);
});

test('an empty bar is unverifiable, not vacuously met', () => {
  for (const object of ['', '   ', ';;;']) {
    const p = parseBar(object);
    assert.equal(p.unverifiable, true, JSON.stringify(object));
    assert.deepEqual(p.obligations, []);
  }
  const checked = checkBar({ object: '' }, { gatesPassed: 3 });
  assert.equal(checked.comparable, false);
});

test('a repeated obligation is reported', () => {
  const p = parseBar('exact-parent-edits-only;exact-parent-edits-only;3-gates-passed');
  assert.equal(p.unverifiable, true);
  assert.match(p.problems.join(' '), /repeats obligation/);
});

test('the obligation vocabulary is closed and every entry has a check written', () => {
  // Guard against the day somebody adds a token to OBLIGATIONS and forgets the
  // check: without this the omission degrades to `indeterminate` at best.
  const { CHECKS } = { CHECKS: null };
  void CHECKS;
  for (const token of OBLIGATIONS) {
    const res = checkBar({ object: token }, {
      gatesPassed: 3,
      changedPaths: ['src/a.js'],
      promotedStatus: LOCAL_PROMOTION,
      lineage: null,
    });
    assert.equal(res.obligations.length, 1, `${token} produced no obligation`);
    assert.notEqual(res.obligations[0].detail, 'this reader has an obligation with no check written for it', `${token} has no check`);
  }
});

// -------------------------------------------------------------- the checks

test('exact-parent-edits-only is met when the patch was applied to the exact baseline', () => {
  const dir = tmp();
  const { cycle: c } = cycle(dir, { project: 'clearcut' });
  const res = checkBar({ object: 'exact-parent-edits-only' }, c);
  assert.equal(res.comparable, true, res.detail);
  assert.equal(res.obligations[0].verdict, 'met');
  assert.match(res.obligations[0].detail, /both in-chain records agree/);
});

test('exact-parent-edits-only is unmet when the patch was applied to something else', () => {
  // A manifest that is not this cycle's baseline: edits accumulated between the
  // recorded baseline and the candidate, so the promotion is of a tree nobody
  // can rebuild from baseline-plus-patch. (The fixture is content-addressed and
  // deterministic, so naming "another cycle's manifest" would reproduce this
  // cycle's own ids — the wrong parent has to be named outright.)
  const dir = tmp();
  const { cycle: c } = cycle(dir, { project: 'clearcut', candidateParentId: 'e'.repeat(64) });
  const res = checkBar({ object: 'exact-parent-edits-only' }, c);
  assert.equal(res.comparable, false);
  assert.equal(res.obligations[0].verdict, 'unmet');
  assert.match(res.obligations[0].detail, /not to the baseline/);
});

test('exact-parent-edits-only is unmet when the two in-chain copies of the source parent disagree', () => {
  const dir = tmp();
  // Same value in the event, a different one inside the patch blob. Both are
  // hashed, so this is a cycle that disagrees with itself — and disagreeing is
  // the tell, because a genuine repair records the parent twice for that reason.
  const { cycle: c } = cycle(dir, { project: 'clearcut', patchParentId: 'f'.repeat(64) });
  const res = checkBar({ object: 'exact-parent-edits-only' }, c);
  assert.equal(res.obligations[0].verdict, 'unmet');
  assert.match(res.obligations[0].detail, /disagree about the source parent/);
});

test('exact-parent-edits-only is unmet when the candidate does not descend from the baseline at all', () => {
  const dir = tmp();
  const { cycle: c } = cycle(dir, { project: 'clearcut', candidateParentsFrom: ['repository.contract'] });
  assert.equal(c.lineage.descendsFromBaseline, false);
  const res = checkBar({ object: 'exact-parent-edits-only' }, c);
  assert.equal(res.obligations[0].verdict, 'unmet');
  assert.match(res.obligations[0].detail, /does not descend from the baseline/);
});

test('a check that cannot decide says so, and does NOT count as met', () => {
  // Three-valued on purpose. Collapsing `indeterminate` into `met` is the same
  // silent upgrade as reading a bar off an unhashed summary.
  const bare = { gatesPassed: 3, changedPaths: ['src/a.js'], promotedStatus: LOCAL_PROMOTION };
  const noLineage = checkBar({ object: 'exact-parent-edits-only' }, bare);
  assert.equal(noLineage.obligations[0].verdict, 'indeterminate');
  assert.equal(noLineage.comparable, false, 'indeterminate blocks comparability');

  const noPaths = checkBar({ object: 'native-tests-unchanged' }, { ...bare, changedPaths: [] });
  assert.equal(noPaths.obligations[0].verdict, 'indeterminate');
  assert.equal(noPaths.comparable, false);

  const noStatus = checkBar({ object: 'promoted-not-released' }, { ...bare, promotedStatus: null });
  assert.equal(noStatus.obligations[0].verdict, 'indeterminate');
  assert.equal(noStatus.comparable, false);

  const noGates = checkBar({ object: '3-gates-passed' }, { ...bare, gatesPassed: null });
  assert.equal(noGates.obligations[0].verdict, 'indeterminate');
  assert.equal(noGates.comparable, false);
});

test('native-tests-unchanged is unmet when the cycle edited the tests that graded it', () => {
  const dir = tmp();
  const { cycle: c } = cycle(dir, { project: 'clearcut', changedPaths: ['src/session/auth.js', 'test/auth.test.js'] });
  const res = checkBar({ object: 'native-tests-unchanged' }, c);
  assert.equal(res.obligations[0].verdict, 'unmet');
  assert.match(res.obligations[0].detail, /test\/auth\.test\.js/);
  assert.match(res.obligations[0].detail, /not a gate count/);
});

test('native-tests-unchanged records the vocabulary that decided it', () => {
  const dir = tmp();
  const { cycle: c } = cycle(dir, { project: 'clearcut' });
  const res = checkBar({ object: 'native-tests-unchanged' }, c);
  assert.equal(res.obligations[0].verdict, 'met');
  assert.deepEqual(res.obligations[0].vocabulary, TEST_PATTERNS.map(String), 'a verdict whose definition the reader cannot see is not auditable');
});

test('the test-path vocabulary catches the layouts it claims to', () => {
  for (const p of ['test/a.js', 'tests/a.js', 'src/__tests__/a.js', 'spec/a.js', 'a.test.js', 'a.spec.ts', 'test_a.py']) {
    assert.equal(isTestPath(p), true, p);
  }
  for (const p of ['src/session/auth.js', 'src/forge/bar.js', 'README.md', 'contest/entry.js']) {
    assert.equal(isTestPath(p), false, p);
  }
});

test('gates-passed is met at exactly the minimum and unmet below it', () => {
  const at = checkBar({ object: '3-gates-passed' }, { gatesPassed: 3 });
  assert.equal(at.obligations[0].verdict, 'met');
  const above = checkBar({ object: '3-gates-passed' }, { gatesPassed: 5 });
  assert.equal(above.obligations[0].verdict, 'met');
  const below = checkBar({ object: '3-gates-passed' }, { gatesPassed: 2 });
  assert.equal(below.obligations[0].verdict, 'unmet');
  assert.match(below.obligations[0].detail, /2 gate evaluation\(s\) passed .* the bar asks for 3/);
});

test('promoted-not-released refuses to witness a release as a repair, and says so harder', () => {
  const ok = checkBar({ object: 'promoted-not-released' }, { promotedStatus: LOCAL_PROMOTION });
  assert.equal(ok.obligations[0].verdict, 'met');

  const released = checkBar({ object: 'promoted-not-released' }, { promotedStatus: 'released-to-production' });
  assert.equal(released.obligations[0].verdict, 'unmet');
  assert.equal(released.obligations[0].escalated, true);
  assert.match(released.obligations[0].detail, /will not be filed beside one/);

  const odd = checkBar({ object: 'promoted-not-released' }, { promotedStatus: 'local-partial-promotion' });
  assert.equal(odd.obligations[0].verdict, 'unmet');
  assert.equal(odd.obligations[0].escalated, false, 'a status that is not a release is still wrong, just not alarming');
});

// ------------------------------------------------------------------ reading

test('readBar splits what BINDS this repository from what merely informs it', () => {
  const fed = fedWith('clearcut', 'fleets');
  withBar(fed, 'clearcut');
  withBar(fed, 'fleets', { gateNames: ['native', 'locked'] });

  const read = readBar(fed, { slug: 'clearcut' });
  assert.equal(read.ok, true);
  assert.equal(read.binding.subject, 'repo:clearcut');
  assert.equal(read.binding.binding, true);
  assert.equal(read.binding.unverifiable, false);
  assert.equal(read.advisory.length, 1);
  assert.equal(read.advisory[0].subject, 'repo:fleets');
  assert.equal(read.advisory[0].binding, false);
  assert.equal(read.provenance.facts, 2);
  assert.ok(read.provenance.head, 'the read records the store head it saw');
});

test('the scope line travels with the bar, because a bar without its boundary reads as a rule', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');
  const read = readBar(fed, { slug: 'clearcut' });
  assert.equal(read.binding.scope, 'bounded-historical-observation-not-universal-rule');
});

test('another repository\'s bar produces NO verdicts at all — there is no path from it to a refusal', () => {
  const fed = fedWith('clearcut', 'fleets');
  withBar(fed, 'clearcut');

  // `fleets` has never had a cycle ingested. `clearcut` has a bar. Guarding
  // fleets must not borrow it: that is exactly how a bounded historical
  // observation from one repository becomes a universal rule for another.
  const dir = tmp();
  const { built } = cycle(dir, { project: 'fleets', runId: 'run-fleets-1' });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'fleets' });
  assert.equal(res.rejected, undefined, 'an absent bar is not a refusal');
  assert.equal(res.comparable, false);
  assert.equal(res.blocking, false, 'and it is not a verdict against the cycle either');
  assert.equal(res.reason, 'no-bar-recorded');
  assert.equal(res.obligations, undefined, 'no obligation was evaluated');
  assert.equal(res.advisory.length, 1);
  assert.equal(res.advisory[0].subject, 'repo:clearcut');
  assert.equal(res.advisory[0].binding, false);
  void built;
});

test('readBar goes through the same portability door as every other read', () => {
  const fed = fedWith('clearcut', 'fleets');
  withBar(fed, 'clearcut');
  // An `outcome`-witnessed bar from a single node is not portable, so a reader
  // who did not witness it is not handed it — and the withholding is counted
  // rather than silent.
  fed.land({
    shelf: 'operational',
    realm: 'shared',
    equation: { subject: 'repo:fleets', predicate: 'risk_repair_bar', object: 'promoted-not-released' },
    witness: 'outcome',
    nodeId: 'fleets',
    reference: 'self-report',
    target: 'repo:fleets',
  });
  const read = readBar(fed, { slug: 'clearcut', viewer: 'clearcut' });
  assert.equal(read.binding.subject, 'repo:clearcut');
  assert.ok(read.withheld >= 1, 'the withheld count is reported');
  assert.equal(read.advisory.some((a) => a.subject === 'repo:fleets'), false, 'a bar that cannot travel is not handed over');
});

test('a bar on another carrier does not bind a repair guard — the populations do not pool', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');
  const browser = readBar(fed, { slug: 'clearcut', carrier: 'browser' });
  assert.equal(browser.binding, null);
  assert.deepEqual(browser.advisory, []);
  assert.equal(browser.provenance.facts, 0);
});

test('readBar refuses to guess which repository is being guarded', () => {
  const fed = fedWith('clearcut');
  assert.equal(readBar(fed, {}).reason, 'slug');
  assert.equal(readBar(fed, { slug: 'clearcut', carrier: 'carrier' }).reason, 'carrier');
});

// ----------------------------------------------------------------- receipt

test('an issued receipt round-trips, and its id is recomputed on the way back in', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');
  const issued = issueBar(fed, { slug: 'clearcut' });
  assert.equal(issued.ok, true);
  assert.equal(issued.bar.schema, BAR_SCHEMA);
  assert.match(issued.bar.id, /^[a-f0-9]{64}$/);
  assert.deepEqual(issued.bar.vocabulary.obligations, OBLIGATIONS);
  assert.deepEqual(issued.bar.vocabulary.testPatterns, TEST_PATTERNS.map(String));

  const file = path.join(tmp(), 'bar.json');
  const written = writeBarReceipt(file, issued.bar);
  assert.equal(written.ok, true);
  const back = readBarReceipt(file);
  assert.equal(back.ok, true);
  assert.equal(back.bar.id, issued.bar.id);
});

test('a receipt loosened after issue is refused by name, and nothing is checked', () => {
  // THE IMPORTANT ONE. The bar is the thing that says no, so an agent that does
  // not like the bar edits the receipt. An unhashed receipt can be loosened
  // between being shown and being used to hold somebody.
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');
  const issued = issueBar(fed, { slug: 'clearcut' });
  const file = path.join(tmp(), 'bar.json');
  writeBarReceipt(file, issued.bar);

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const loosened = { ...onDisk, binding: { ...onDisk.binding, object: 'promoted-not-released', tokens: ['promoted-not-released'], obligations: onDisk.binding.obligations.slice(-1), unverifiable: false, problems: [] } };
  fs.writeFileSync(file, `${JSON.stringify(loosened, null, 2)}\n`);

  const back = readBarReceipt(file);
  assert.equal(back.rejected, true);
  assert.equal(back.reason, 'id-mismatch');
  assert.match(back.detail, /loosened between being shown to an agent and being used to hold one/);

  const dir = tmp();
  cycle(dir, { project: 'clearcut', changedPaths: ['test/auth.test.js'], runId: 'run-loose-1' });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut', barPath: file });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'id-mismatch', 'the guard stops at the receipt and never reaches the checks');
  assert.equal(res.obligations, undefined);
});

test('a receipt cannot be overwritten in place', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');
  const issued = issueBar(fed, { slug: 'clearcut' });
  const file = path.join(tmp(), 'bar.json');
  assert.equal(writeBarReceipt(file, issued.bar).ok, true);
  const again = writeBarReceipt(file, issued.bar);
  assert.equal(again.rejected, true);
  assert.equal(again.reason, 'exists');
  assert.match(again.detail, /loosened after the fact/);
});

test('a receipt refuses to be a symlink or a directory', () => {
  const dir = tmp();
  const link = path.join(dir, 'bar.json');
  fs.mkdirSync(path.join(dir, 'target'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'target'), link);
  const res = readBarReceipt(link);
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'symlink', 'a receipt that can be a link can be swapped');
});

test('a receipt from another repository, or another carrier, cannot hold this cycle', () => {
  const fed = fedWith('clearcut', 'fleets');
  withBar(fed, 'clearcut');
  const issued = issueBar(fed, { slug: 'clearcut' });
  const file = path.join(tmp(), 'bar.json');
  writeBarReceipt(file, issued.bar);

  const dir = tmp();
  cycle(dir, { project: 'fleets', runId: 'run-fleets-2' });
  const wrongRepo = guardCycle(fed, { cycleDir: dir, slug: 'fleets', barPath: file });
  assert.equal(wrongRepo.rejected, true);
  assert.equal(wrongRepo.reason, 'receipt-is-not-subject');

  const dir2 = tmp();
  cycle(dir2, { project: 'clearcut', runId: 'run-clearcut-3' });
  const wrongCarrier = guardCycle(fed, { cycleDir: dir2, slug: 'clearcut', carrier: 'browser', barPath: file });
  assert.equal(wrongCarrier.rejected, true);
  assert.equal(wrongCarrier.reason, 'receipt-is-not-carrier');
  assert.match(wrongCarrier.detail, /two populations do not pool/);
});

// -------------------------------------------------------------------- drift

test('drift is kind-aware: a raised minimum tightens, a lowered one does not', () => {
  const mk = (object) => ({ binding: parseBar(object), provenance: { signatures: ['a'], head: 'h' } });
  const bar3 = 'exact-parent-edits-only;native-tests-unchanged;3-gates-passed;promoted-not-released';
  const bar4 = 'exact-parent-edits-only;native-tests-unchanged;4-gates-passed;promoted-not-released';
  const bar2 = 'exact-parent-edits-only;native-tests-unchanged;2-gates-passed;promoted-not-released';

  const up = drift(mk(bar3), mk(bar4));
  assert.equal(up.harder, true);
  assert.deepEqual(up.raised, ['3-gates-passed -> 4-gates-passed']);
  assert.deepEqual(up.added, [], 'a changed minimum is not a new obligation');

  const down = drift(mk(bar3), mk(bar2));
  assert.equal(down.harder, false, 'the commons getting easier is not a reason to block anything');
  assert.deepEqual(down.lowered, ['3-gates-passed -> 2-gates-passed']);
  assert.equal(down.moved, true, 'but it is still reported');

  const gained = drift(mk(bar3), mk(`${bar3};no-new-dependencies`));
  assert.equal(gained.harder, true);
  assert.deepEqual(gained.added, ['no-new-dependencies']);

  const same = drift(mk(bar3), mk(bar3));
  assert.equal(same.moved, false);
  assert.equal(same.harder, false);
});

test('a bar that appeared after issue blocks, because the agent was shown nothing', () => {
  const none = { binding: null, provenance: { signatures: [], head: 'h' } };
  const some = { binding: parseBar('3-gates-passed'), provenance: { signatures: ['a'], head: 'h' } };
  const d = drift(none, some);
  assert.equal(d.harder, true);
  assert.deepEqual(d.added, ['3-gates-passed']);
});

test('a moved store head is noted even when the obligations did not change', () => {
  const mk = (head) => ({ binding: parseBar('3-gates-passed'), provenance: { signatures: ['a'], head } });
  const d = drift(mk('aaaa'), mk('bbbb'));
  assert.equal(d.moved, true);
  assert.equal(d.harder, false);
  assert.match(d.notes.join(' '), /store head moved/);
});

// -------------------------------------------------------------------- guard

test('a genuine second cycle is comparable to the bar the first one set', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');

  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-next-1' });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.comparable, true, res.detail);
  assert.equal(res.blocking, false);
  assert.equal(res.reason, 'bar-met');
  assert.equal(res.tally.met, 4);
  assert.equal(res.tally.unmet, 0);
  assert.equal(res.tally.indeterminate, 0);
  assert.equal(res.selfCheck, false, 'a different cycle is not a self-check');
  assert.equal(res.bar.scope, 'bounded-historical-observation-not-universal-rule');
});

test('guarding the cycle that SET the bar says so, rather than reading as corroboration', () => {
  const fed = fedWith('clearcut');
  const { dir } = withBar(fed, 'clearcut');
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.comparable, true, res.detail);
  assert.equal(res.selfCheck, true);
  assert.equal(res.reason, 'bar-met-self-check');
  assert.match(res.detail, /self-check/);
});

test('a cycle that edited its own tests is not comparable, end to end', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');

  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-tests-1', changedPaths: ['src/session/auth.js', 'test/auth.test.js'] });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.comparable, false);
  assert.equal(res.blocking, true);
  assert.equal(res.reason, 'bar-unmet');
  assert.equal(res.tally.unmet, 1);
  const failed = res.obligations.find((o) => o.verdict === 'unmet');
  assert.equal(failed.token, 'native-tests-unchanged');
});

test('a cycle that cleared fewer gates than the recorded bar is not comparable', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut'); // three gates
  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-fewer-1', gateOutcomes: [true, false, true] });
  const read = readCycle(dir);
  assert.equal(read.cycle.gatesPassed, 2, 'the fixture really did clear two');

  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.comparable, false);
  assert.equal(res.reason, 'bar-unmet');
  assert.match(res.detail, /3-gates-passed: unmet/);
});

test('guard refuses to measure a cycle against a different repository\'s bar', () => {
  const fed = fedWith('clearcut', 'fleets');
  withBar(fed, 'clearcut');
  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-mis-1' });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'fleets' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'cycle-is-not-subject');
  assert.match(res.detail, /names project 'clearcut'/);
  assert.match(res.detail, /Nothing was checked/);
});

test('guard writes nothing: no fact, no event, no byte appended', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');
  const before = { head: fed.head, facts: fed.stats().facts, events: fed.stats().events, bytes: fs.statSync(fed.logPath).size };

  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-nowrite-1' });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.comparable, true, res.detail);
  assert.equal(res.wrote, false);
  assert.equal(res.headUnchanged, true);

  const after = { head: fed.head, facts: fed.stats().facts, events: fed.stats().events, bytes: fs.statSync(fed.logPath).size };
  assert.deepEqual(after, before, 'a check that mutates memory is not a check — it is a witness filing itself');
});

test('guard passes through every refusal the cycle reader makes', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');

  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', status: 'failed', runId: 'run-failed-1' });
  const incomplete = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(incomplete.rejected, true);
  assert.equal(incomplete.reason, 'incomplete', 'only a completed cycle can be measured against anything');

  const dir2 = tmp();
  buildCycle(dir2, { project: 'clearcut', runId: 'run-failed-2', receiptOverrides: { failed: true } });
  const failed = guardCycle(fed, { cycleDir: dir2, slug: 'clearcut' });
  assert.equal(failed.rejected, true);
  assert.equal(failed.reason, 'failed-run', 'a failure is evidence, not something to grade against a bar');
});

test('guard refuses a cycle whose ledger was tampered with, before it reads any bar', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');
  const dir = tmp();
  const built = buildCycle(dir, { project: 'clearcut', runId: 'run-tamper-1' });
  const log = path.join(built.ledgerDir, 'events.jsonl');
  const lines = fs.readFileSync(log, 'utf8').trimEnd().split('\n');
  const forged = JSON.parse(lines[lines.length - 1]);
  forged.data = { ...forged.data, passedGates: 99 };
  lines[lines.length - 1] = JSON.stringify(forged);
  fs.writeFileSync(log, lines.join('\n') + '\n');

  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'id-mismatch');
  assert.equal(res.comparable, undefined, 'no verdict is offered over a cycle that does not verify');
});

test('a commons that tightened after the receipt was issued blocks the cycle', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut'); // bar: 3-gates-passed
  const issued = issueBar(fed, { slug: 'clearcut' });
  const file = path.join(tmp(), 'bar.json');
  writeBarReceipt(file, issued.bar);

  // A later cycle raises the recorded bar to four gates.
  withBar(fed, 'clearcut', { runId: 'run-raise-1', gateNames: ['native', 'locked', 'fresh-retest', 'extra'], timestamp: AT(18) });
  const current = readBar(fed, { slug: 'clearcut' });
  assert.match(current.binding.object, /4-gates-passed/);

  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-held-1', timestamp: AT(19) }); // three gates
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut', barPath: file });
  assert.equal(res.comparable, false);
  assert.equal(res.blocking, true);
  assert.equal(res.reason, 'bar-drifted-harder');
  assert.deepEqual(res.drift.raised, ['3-gates-passed -> 4-gates-passed']);
  assert.equal(res.bar.issuedNow, false, 'the receipt, not the current commons, is what the agent saw');
  assert.match(res.bar.object, /3-gates-passed/);
  assert.match(res.detail, /never shown/);
});

test('a commons that loosened after issue is reported, and the receipt still holds', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut'); // bar: 3-gates-passed
  const issued = issueBar(fed, { slug: 'clearcut' });
  const file = path.join(tmp(), 'bar.json');
  writeBarReceipt(file, issued.bar);

  // A later cycle, and "later" has to be real: recency comes from the cycle's
  // own `completedAt`, which is inside its hash chain.
  withBar(fed, 'clearcut', { runId: 'run-lower-1', gateOutcomes: [true, false, true], timestamp: AT(18) }); // bar: 2-gates-passed
  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-held-2', gateOutcomes: [true, false, true], timestamp: AT(19) }); // clears two
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut', barPath: file });
  assert.equal(res.drift.moved, true);
  assert.equal(res.drift.harder, false);
  assert.deepEqual(res.drift.lowered, ['3-gates-passed -> 2-gates-passed']);
  assert.equal(res.comparable, false, 'held to the three it was shown, and it cleared two');
  assert.equal(res.reason, 'bar-unmet');
});

test('a receipt read straight from the commons when none was issued says so', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut');
  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-noreceipt-1' });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.bar.issuedNow, true, 'nothing was shown to the agent beforehand, and the result admits it');
});

test('when a repository has run more than one cycle, the MOST RECENT bar binds', () => {
  // `land()` keys on the equation signature and does not supersede, so a second
  // cycle with a different gate count leaves TWO bar facts for one subject.
  // Picking the first would freeze the bar at whatever the oldest cycle cleared;
  // picking the strictest would ratchet it upward forever. Recency, reported.
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut', { timestamp: AT(17) });
  withBar(fed, 'clearcut', { runId: 'run-two-1', gateNames: ['native', 'locked', 'fresh-retest', 'extra'], timestamp: AT(18) });

  const read = readBar(fed, { slug: 'clearcut' });
  assert.match(read.binding.object, /4-gates-passed/, 'the newest bar binds');
  assert.equal(read.prior.length, 1);
  assert.match(read.prior[0].object, /3-gates-passed/, 'and the older one is kept, not dropped');
  assert.equal(read.provenance.facts, 2);
});

test('a stricter EARLIER bar is reported as guidance and enforced as nothing', () => {
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut', { runId: 'run-strict-1', gateNames: ['native', 'locked', 'fresh-retest', 'extra'], timestamp: AT(17) }); // 4
  withBar(fed, 'clearcut', { runId: 'run-loose-2', timestamp: AT(18) }); // 3, and later

  const read = readBar(fed, { slug: 'clearcut' });
  assert.match(read.binding.object, /3-gates-passed/);
  assert.equal(read.notes.length, 1);
  assert.match(read.notes[0], /once recorded a stricter bar/);

  // A three-gate cycle is comparable to a three-gate bar even though this
  // repository once cleared four. The note travels; the refusal does not.
  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-after-1', timestamp: AT(19) });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.comparable, true, res.detail);
  assert.equal(res.notes.length, 1);
  assert.equal(res.prior.length, 1);
});

test('recency is decided by a timestamp inside the chain, not by arrival order', () => {
  const fed = fedWith('clearcut');
  // Land the NEWER cycle first and the older one second. If the choice were
  // "whichever landed last" the wrong bar would bind.
  withBar(fed, 'clearcut', { runId: 'run-new-1', timestamp: AT(18), gateNames: ['native', 'locked', 'fresh-retest', 'extra'] });
  withBar(fed, 'clearcut', { runId: 'run-old-1', timestamp: AT(16) });
  const read = readBar(fed, { slug: 'clearcut' });
  assert.match(read.binding.object, /4-gates-passed/, 'the later cycle binds even though it landed first');
});

test('two bars recorded at the same instant pick one deterministically, and keep both', () => {
  // The fixture stamps every event with one instant, so two cycles built the
  // same way complete "at the same time". The choice between them must not
  // depend on Map iteration order: same input, same binding bar, every run.
  const fed = fedWith('clearcut');
  withBar(fed, 'clearcut', { runId: 'run-tie-a', gateNames: ['native', 'locked', 'fresh-retest', 'extra'] }); // 4
  withBar(fed, 'clearcut', { runId: 'run-tie-b' }); // 3
  const one = readBar(fed, { slug: 'clearcut' });
  const two = readBar(fed, { slug: 'clearcut' });
  assert.equal(one.binding.signature, two.binding.signature);
  assert.equal(one.prior.length, 1);
  const fed2 = fedWith('clearcut');
  withBar(fed2, 'clearcut', { runId: 'run-tie-b' }); // landed in the other order
  withBar(fed2, 'clearcut', { runId: 'run-tie-a', gateNames: ['native', 'locked', 'fresh-retest', 'extra'] });
  const three = readBar(fed2, { slug: 'clearcut' });
  assert.equal(three.binding.signature, one.binding.signature, 'the tie-break is on the signature, not on arrival order');
});

// ------------------------------------------------------- who may set a bar

test('a bar another repository wrote about this one binds nothing, and is named', () => {
  const fed = fedWith('clearcut', 'fleets');
  withBar(fed, 'clearcut');
  // `fleets` tries to reduce `clearcut` to a single obligation. `land()` accepts
  // it — a node may witness any equation, which is how five witnesses establish
  // a claim — but a bar is not a claim, it is a standard, and only the
  // repository it is about may set it.
  const forged = fed.land({
    shelf: 'operational', realm: 'shared',
    equation: { subject: 'repo:clearcut', predicate: 'risk_repair_bar', object: 'promoted-not-released' },
    witness: 'structural', nodeId: 'fleets', reference: 'trust-me', target: 'repo:clearcut', at: AT(25),
  });
  assert.equal(forged.rejected, undefined, 'the store still accepts the fact; the bar reader is what refuses to be held by it');

  const read = readBar(fed, { slug: 'clearcut' });
  assert.match(read.binding.object, /native-tests-unchanged/, 'the repository\'s own bar still binds');
  assert.deepEqual(read.binding.witnessNodeIds, ['clearcut']);
  assert.equal(read.disputed.length, 1);
  assert.equal(read.disputed[0].object, 'promoted-not-released');
  assert.match(read.disputed[0].authority.reason, /witnessed by fleets/);
  assert.equal(read.notes.length, 1);
  assert.match(read.notes[0], /bind nothing/);

  // And it makes no difference at the guard: a cycle that edited its own tests
  // is still not comparable.
  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-forged-1', changedPaths: ['src/a.js', 'test/a.test.js'], timestamp: AT(26) });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.comparable, false);
  assert.equal(res.reason, 'bar-unmet');
  assert.equal(res.disputed.length, 1);
});

test('a bar citing something that is not a ledger head binds nothing', () => {
  const fed = fedWith('clearcut');
  fed.land({
    shelf: 'operational', realm: 'shared',
    equation: { subject: 'repo:clearcut', predicate: 'risk_repair_bar', object: 'promoted-not-released' },
    witness: 'structural', nodeId: 'clearcut', reference: 'trust-me', target: 'repo:clearcut', at: AT(25),
  });
  const read = readBar(fed, { slug: 'clearcut' });
  assert.equal(read.binding, null, 'a repository cannot set its own bar by asserting it');
  assert.equal(read.disputed.length, 1);
  assert.match(read.disputed[0].authority.reason, /not a ledger head/);
});

test('a bar a named human ruled on binds, without a ledger behind it', () => {
  const fed = fedWith('clearcut');
  const ruled = fed.land({
    shelf: 'operational', realm: 'shared',
    equation: { subject: 'repo:clearcut', predicate: 'risk_repair_bar', object: 'native-tests-unchanged;2-gates-passed' },
    witness: 'human', nodeId: 'clearcut', reference: 'ruling-2026-10-19', actor: 'dwayne', target: 'repo:clearcut', at: AT(25),
  });
  assert.equal(ruled.rejected, undefined, JSON.stringify(ruled));
  const read = readBar(fed, { slug: 'clearcut' });
  assert.ok(read.binding, 'a human ruling is re-derivable in the sense that matters: the name is in the record');
  assert.deepEqual(read.disputed, []);
});

// ----------------------------------------------------------- a stale receipt

test('a receipt issued before any bar existed blocks once a bar appears', () => {
  const fed = fedWith('clearcut');
  const issued = issueBar(fed, { slug: 'clearcut' });
  assert.equal(issued.bar.binding, null);
  const file = path.join(tmp(), 'bar.json');
  writeBarReceipt(file, issued.bar);

  withBar(fed, 'clearcut');
  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-stale-1', changedPaths: ['test/a.test.js'], timestamp: AT(20) });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut', barPath: file });
  assert.equal(res.comparable, false);
  assert.equal(res.blocking, true, 'asking for the bar early is not a standing exemption');
  assert.equal(res.reason, 'bar-drifted-harder');
  assert.equal(res.bar.object, null);
  assert.match(res.detail, /not a standing exemption/);
});

test('guard names a slug it was not given, rather than defaulting to the cycle', () => {
  const fed = fedWith('clearcut');
  const dir = tmp();
  cycle(dir, { project: 'clearcut' });
  const res = guardCycle(fed, { cycleDir: dir });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'slug');
});

// ------------------------------------------------------ a bar that asks for nothing
//
// `0-gates-passed` parses cleanly and every cycle satisfies it forever. It is not
// an unrecognised token, it is a VACUOUS one -- and a standard lowered to nothing
// by whichever cycle happened to record no gates is worse than no standard,
// because it reads like one.

test('a bar asking for zero gates to have passed is unverifiable, not easy', () => {
  const p = parseBar('exact-parent-edits-only;native-tests-unchanged;0-gates-passed;promoted-not-released');
  assert.equal(p.unverifiable, true);
  assert.deepEqual(p.unrecognized, [], 'the token is recognised — it is the obligation that is empty');
  assert.match(p.problems.join(' '), /0 gates/);
  assert.match(p.problems.join(' '), /minimum of zero is not an obligation/);
});

test('`0-gates-passed` alone falls foul of the same rule as any other vacuous bar', () => {
  const p = parseBar('0-gates-passed');
  assert.equal(p.unverifiable, true);
  assert.match(p.problems.join(' '), /minimum of zero/);
});

test('one gate is still a real obligation — the rule is about zero, not about small numbers', () => {
  const p = parseBar('exact-parent-edits-only;1-gates-passed');
  assert.equal(p.unverifiable, false);
  assert.equal(p.obligations.find((o) => o.kind === 'gates-passed').min, 1);
});

test('no cycle is comparable to a vacuous bar, and no obligation is reported met', () => {
  const object = 'exact-parent-edits-only;native-tests-unchanged;0-gates-passed;promoted-not-released';
  const checked = checkBar({ object }, { gatesPassed: 0, changedPaths: ['src/a.js'], promotedStatus: LOCAL_PROMOTION });
  assert.equal(checked.comparable, false);
  assert.equal(checked.reason, 'bar-unverifiable');
  assert.deepEqual(checked.obligations || [], [], 'nothing is checked, so nothing is reported as met');
});

test('even a named human ruling cannot make a vacuous bar usable', () => {
  // The authority question and the checkability question are different doors.
  // A ruling settles WHO may set the bar; it cannot make an obligation that asks
  // for nothing into something a reader can verify.
  const fed = fedWith('clearcut');
  fed.land({
    shelf: 'operational', realm: 'shared',
    equation: { subject: 'repo:clearcut', predicate: 'risk_repair_bar', object: 'native-tests-unchanged;0-gates-passed' },
    witness: 'human', nodeId: 'clearcut', reference: 'ruling-zero-gates', actor: 'dwayne', target: 'repo:clearcut', at: AT(25),
  });
  const read = readBar(fed, { slug: 'clearcut' });
  assert.ok(read.binding, 'the human ruling does bind — that is not the question here');
  assert.equal(read.binding.unverifiable, true, 'and the bar it binds is still unverifiable');

  const dir = tmp();
  cycle(dir, { project: 'clearcut', runId: 'run-vacuous-1', timestamp: AT(26) });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  assert.equal(res.comparable, false);
  assert.equal(res.reason, 'bar-unverifiable');
  // `blocking` is "the guard reached a verdict", and it IS true here: the cycle
  // cannot be filed while the standard is illegible, so the run stops and the
  // operator fixes the bar. That is deliberately different from `no-bar-recorded`
  // below, where nothing was cleared but nothing was held against the work
  // either -- and the two are told apart by `reason`, never by one exit code.
  assert.equal(res.blocking, true);
});

test('a vacuous bar blocks the run, where an absent bar does not', () => {
  // Both answer `comparable: false`. Only one of them is a reason to stop.
  const empty = fedWith('clearcut');
  const d1 = tmp();
  cycle(d1, { project: 'clearcut', runId: 'run-nobar-1' });
  const absent = guardCycle(empty, { cycleDir: d1, slug: 'clearcut' });
  assert.equal(absent.reason, 'no-bar-recorded');
  assert.equal(absent.comparable, false);
  assert.equal(absent.blocking, false, 'a new repository has nothing to compare against — that is not a failure');

  const vacuous = fedWith('clearcut');
  vacuous.land({
    shelf: 'operational', realm: 'shared',
    equation: { subject: 'repo:clearcut', predicate: 'risk_repair_bar', object: 'native-tests-unchanged;0-gates-passed' },
    witness: 'human', nodeId: 'clearcut', reference: 'ruling-zero-gates-2', actor: 'dwayne', target: 'repo:clearcut', at: AT(25),
  });
  const d2 = tmp();
  cycle(d2, { project: 'clearcut', runId: 'run-vacuous-2', timestamp: AT(26) });
  const held = guardCycle(vacuous, { cycleDir: d2, slug: 'clearcut' });
  assert.equal(held.reason, 'bar-unverifiable');
  assert.equal(held.comparable, false);
  assert.equal(held.blocking, true, 'a standard that cannot be read is a reason to stop, not a pass');
});

test('drift reads 3 -> 0 gates as a loosening, and never as a ratchet', () => {
  const issued = { binding: { tokens: ['exact-parent-edits-only', 'native-tests-unchanged', '3-gates-passed', 'promoted-not-released'] } };
  const current = { binding: { tokens: ['exact-parent-edits-only', 'native-tests-unchanged', '0-gates-passed', 'promoted-not-released'] } };
  const d = drift(issued, current);
  assert.equal(d.harder, false, 'lowering the gate minimum can never be a hardening');
  assert.deepEqual(d.lowered, ['3-gates-passed -> 0-gates-passed']);
  assert.deepEqual(d.added, []);
});

test('drift still reports the raising direction correctly for gate minimums', () => {
  const issued = { binding: { tokens: ['exact-parent-edits-only', '0-gates-passed'] } };
  const current = { binding: { tokens: ['exact-parent-edits-only', '3-gates-passed'] } };
  const d = drift(issued, current);
  assert.equal(d.harder, true);
  assert.deepEqual(d.raised, ['0-gates-passed -> 3-gates-passed']);
});
