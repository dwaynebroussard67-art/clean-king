'use strict';

/**
 * helpers/cycle.js — build a repair cycle in Twin Labs' published format.
 *
 * ONE BUILDER, NOT THREE. `test/lessons.test.js`, `test/redqueen.js` and
 * `test/bar.test.js` all need a genuine hash-chained cycle to attack or to read,
 * and a fixture that exists in three copies is a fixture that silently diverges:
 * the first version of this refactor already had two builders whose `project`
 * defaults differed, which made a witness look like it was filed by the wrong
 * repository and turned a setup mistake into a confusing failure.
 *
 * The builder writes a chain that is genuine in every respect, and then lets a
 * caller override exactly one property of it. That is the only way to test a
 * verifier: a cycle that is broken in two places at once tells you nothing about
 * which check caught it.
 *
 * Everything here is derived from the format documented in docs/REPAIR-MEMORY.md
 * — receipt.json + summary.json beside a `ledger/` of events.jsonl and
 * content-addressed blobs, where `id = sha256(canonical(body))` and each event's
 * `previous` is the id before it.
 */

const fs = require('node:fs');
const path = require('node:path');

const { canonicalJson, sha256Bytes, ZERO } = require('../../src/forge/ledger.js');
const { LESSON_SCOPE, LOCAL_PROMOTION } = require('../../src/forge/lessons.js');

const CLAIM = 'real uploaded source changed and passed the specified frozen checks; not a diamond/perfection certificate';

const DEFAULT_LIMITS = [
  'same case families with fresh parameters; not independent discovery of new vulnerability classes',
  'no prediction of future code correctness',
];

const DEFAULT_FAILURES = [
  { caseId: 'probe-1', expected: 'a.js', got: 'b.js' },
  { caseId: 'probe-2', expected: 'c.js', got: null },
];

/** Write one content-addressed blob and return its artifact row. */
function blob(ledgerDir, value) {
  const bytes = Buffer.from(canonicalJson(value), 'utf8');
  const id = sha256Bytes(bytes);
  fs.writeFileSync(path.join(ledgerDir, 'blobs', id), bytes);
  return { id, bytes: bytes.length, mediaType: 'application/json' };
}

/** Resolve the candidate's EVENT parents. `candidateParentsFrom` names event
 *  TYPES, which are known before the build; raw ids are not. */
function candidateParentsOf(opts, beforeCandidate, contract) {
  if (Array.isArray(opts.candidateParents)) return opts.candidateParents;
  if (!Array.isArray(opts.candidateParentsFrom)) return [beforeCandidate, contract];
  return opts.candidateParentsFrom.map((type) => {
    const found = opts.__events.find((e) => e.type === type);
    if (!found) throw new Error(`candidateParentsFrom asked for a '${type}' event that has not been appended yet`);
    return found.id;
  });
}

/**
 * @param {string} dir  the cycle root; `ledger/` is created inside it
 * @param {object} [opts]
 * @param {string}   [opts.runId='run-test-0001']
 * @param {string}   [opts.project='twin-labs']      the lesson artifact's project
 * @param {string}   [opts.timestamp]                override every event's timestamp
 * @param {string}   [opts.status='completed']       the RECEIPT's status
 * @param {string[]} [opts.changedPaths]
 * @param {Array}    [opts.failures]
 * @param {boolean}  [opts.reproduce=true]           include the reproduction evaluation
 * @param {string[]} [opts.gateNames]                gates run against the candidate
 * @param {number[]} [opts.gateOutcomes]             per-gate `passed` values
 * @param {object[]} [opts.gateResults]              per-gate result BLOB content,
 *        parallel to gateNames. Lets a gate report what its run produced -- e.g.
 *        `{passed:true, testsRun:0}` for a test command that ran no tests.
 * @param {number}   [opts.gatesPassed]              lie in the summary only, not the chain
 * @param {string}   [opts.promotedStatus]
 * @param {string[]} [opts.limits]
 * @param {string[]} [opts.candidateParents]         override the candidate's ancestry, by id
 * @param {string[]} [opts.candidateParentsFrom]     ...or by event TYPE, e.g. ['repository.contract']
 * @param {string}   [opts.candidateParentId]        the SOURCE parent the patch was applied to
 * @param {string}   [opts.patchParentId]            the patch blob's own copy of it
 * @param {object}   [opts.summaryOverrides]
 * @param {object}   [opts.receiptOverrides]
 * @returns {{head:string, receipt:object, summary:object, lines:string[], ids:string[],
 *            events:object[], ledgerDir:string, receiptPath:string, summaryPath:string}}
 */
function buildCycle(dir, opts = {}) {
  const ledgerDir = path.join(dir, 'ledger');
  fs.mkdirSync(path.join(ledgerDir, 'blobs'), { recursive: true });

  const runId = opts.runId || 'run-test-0001';
  const project = opts.project || 'twin-labs';
  const changedPaths = opts.changedPaths || ['src/federation/store.js', 'src/forge/runner.js'];
  const failures = opts.failures || DEFAULT_FAILURES;
  const limits = opts.limits || DEFAULT_LIMITS;
  const gateNames = opts.gateNames || ['native', 'locked', 'fresh-retest'];

  const lines = [];
  const ids = [];
  const events = [];
  // Passed through opts so candidateParentsOf can resolve event TYPES to ids
  // without the caller having to know an id before the chain exists.
  opts = { ...opts, __events: events };
  let previous = ZERO;

  const append = (type, data, { parents = [], artifacts = [] } = {}) => {
    const body = {
      schemaVersion: 1,
      runId,
      sequence: lines.length + 1,
      previous,
      type,
      // Overridable so a test can build a chain that is genuine in every
      // respect except one value.
      timestamp: opts.timestamp || new Date(Date.UTC(2026, 9, 17, 12, 0, lines.length)).toISOString(),
      elapsedNs: String(1000000 * (lines.length + 1)),
      parents,
      artifacts,
      rationale: null,
      data,
    };
    const id = sha256Bytes(Buffer.from(canonicalJson(body), 'utf8'));
    lines.push(canonicalJson({ ...body, id }));
    ids.push(id);
    events.push({ ...body, id });
    previous = id;
    return id;
  };

  const contract = append('repository.contract', { specs: ['discovery', 'reproduction', ...gateNames] });

  const baselineSource = Buffer.from('original\n');
  const baselineFiles = [{ path: changedPaths[0], sha256: sha256Bytes(baselineSource), bytes: baselineSource.length }];
  fs.writeFileSync(path.join(ledgerDir, 'blobs', baselineFiles[0].sha256), baselineSource);
  const baselineManifest = blob(ledgerDir, { files: baselineFiles });
  const baseline = append('repository.baseline', { manifestId: baselineManifest.id }, { parents: [contract], artifacts: [baselineManifest] });

  const discoveryResult = blob(ledgerDir, { failures });
  const discoveryProc = blob(ledgerDir, { exitCode: 1, stdout: 'not ok 1', stderr: '' });
  const discovery = append(
    'repository.evaluated',
    { targetId: baselineManifest.id, specName: 'discovery', passed: false, processId: discoveryProc.id, resultId: discoveryResult.id },
    { parents: [baseline, contract], artifacts: [discoveryProc, discoveryResult] }
  );

  // The repair engine reproduces the failure on unmodified source before it
  // edits anything. A cycle that skipped this is still a well-formed ledger, so
  // the omission is a knob rather than a defect in the fixture.
  let beforeCandidate = discovery;
  if (opts.reproduce !== false) {
    const reproResult = blob(ledgerDir, { failures });
    beforeCandidate = append(
      'repository.evaluated',
      { targetId: baselineManifest.id, specName: 'reproduction', passed: false, resultId: reproResult.id },
      { parents: [discovery], artifacts: [reproResult] }
    );
  }

  // The SOURCE parent -- which manifest the patch was applied to -- is recorded
  // twice in a genuine cycle: once in the candidate event and once inside the
  // content-addressed patch blob. Both knobs exist so a test can make them
  // disagree with each other, or with the baseline, one at a time.
  const sourceParent = opts.candidateParentId || baselineManifest.id;
  const patchParent = opts.patchParentId || sourceParent;

  const patch = blob(ledgerDir, { parentId: patchParent, edits: changedPaths.map((p) => ({ path: p })) });
  const candidateManifest = blob(ledgerDir, { files: baselineFiles });
  const candidate = append(
    'repository.candidate',
    { parentId: sourceParent, manifestId: candidateManifest.id, patchId: patch.id, changedPaths },
    { parents: candidateParentsOf(opts, beforeCandidate, contract), artifacts: [candidateManifest, patch] }
  );

  const gates = [];
  gateNames.forEach((name, i) => {
    const passed = opts.gateOutcomes ? Boolean(opts.gateOutcomes[i]) : true;
    // A gate's result blob normally holds nothing but the verdict. `gateResults`
    // lets a test say what the run actually PRODUCED -- how many tests, what
    // output -- so a cycle can claim a pass that ran nothing. Omitted keeps the
    // original blob byte-for-byte, so every existing fixture is unchanged.
    const r = blob(ledgerDir, opts.gateResults && opts.gateResults[i] ? opts.gateResults[i] : { passed });
    gates.push(
      append('repository.evaluated', { targetId: candidateManifest.id, specName: name, passed, resultId: r.id }, { parents: [candidate], artifacts: [r] })
    );
  });
  const passingGates = gates.filter((_, i) => (opts.gateOutcomes ? Boolean(opts.gateOutcomes[i]) : true));

  // `undefined` means "use the real one"; an explicit empty string means "record
  // no status at all", which is a different cycle and a test needs to build it.
  const promotedStatus = opts.promotedStatus === undefined ? LOCAL_PROMOTION : opts.promotedStatus;
  const promoted = append('repository.promoted', { targetId: candidateManifest.id, gateIds: gates, status: promotedStatus }, { parents: gates });

  const lessonValue = {
    status: LESSON_SCOPE,
    project,
    failures,
    patchId: patch.id,
    baselineId: baselineManifest.id,
    candidateId: candidateManifest.id,
    evidence: [discovery, ...(beforeCandidate === discovery ? [] : [beforeCandidate]), ...gates],
    limits,
  };
  const lessonArtifact = blob(ledgerDir, lessonValue);
  const lessonEvent = append('repository.lesson', { lessonId: lessonArtifact.id }, { parents: [promoted], artifacts: [lessonArtifact] });

  // THE NEXT ROUND, AFTER PROMOTION.
  //
  // Twin Labs' engine re-tests the promoted source with fresh parameters once
  // the candidate has been promoted, and the ledger records which artifact that
  // evaluation actually executed. The fixture had no such step -- every
  // evaluation ran before promotion against the candidate -- so a cycle whose
  // "next round" ran some OTHER artifact was indistinguishable from a closed
  // one. `nextRoundTarget` builds that case on purpose:
  //
  //   undefined / 'promoted'  a genuine post-promotion retest of the promoted artifact
  //   'other'                 a retest that executed a different artifact
  //   null                    no post-promotion retest at all
  let nextRoundEvent = null;
  if (opts.nextRoundTarget !== null) {
    const targetId = opts.nextRoundTarget === 'other' ? sha256Bytes(Buffer.from('some older artifact\n')) : candidateManifest.id;
    const nextResult = blob(ledgerDir, { passed: true });
    const nextProc = blob(ledgerDir, { exitCode: 0, stdout: '# pass 5' });
    nextRoundEvent = append(
      'repository.evaluated',
      { targetId, specName: 'fresh-retest', passed: true, processId: nextProc.id, resultId: nextResult.id },
      { parents: [promoted], artifacts: [nextProc, nextResult] }
    );
  }

  const summary = {
    schemaVersion: 1,
    project,
    baselineId: baselineManifest.id,
    promotedId: candidateManifest.id,
    reproducedFailingCases: failures.length,
    registeredCases: 5,
    changedPaths,
    // The chain is the truth; this number is only a claim about it. Overriding
    // it without overriding the events is how the M1 attack forges a bar.
    passedGates: opts.gatesPassed == null ? passingGates.length : opts.gatesPassed,
    nextTargetId: nextRoundEvent ? (opts.nextRoundTarget === 'other' ? sha256Bytes(Buffer.from('some older artifact\n')) : candidateManifest.id) : candidateManifest.id,
    lessonId: lessonEvent,
    claim: CLAIM,
    ...(opts.summaryOverrides || {}),
  };
  const summaryArtifact = blob(ledgerDir, summary);
  append('repository.completed', summary, { parents: [promoted, lessonEvent], artifacts: [summaryArtifact] });

  fs.writeFileSync(path.join(ledgerDir, 'events.jsonl'), lines.join('\n') + '\n');
  const receipt = { runId, events: lines.length, head: previous, failed: false, status: opts.status || 'completed', ...(opts.receiptOverrides || {}) };
  const receiptPath = path.join(dir, 'receipt.json');
  const summaryPath = path.join(dir, 'summary.json');
  fs.writeFileSync(receiptPath, canonicalJson(receipt) + '\n');
  fs.writeFileSync(summaryPath, canonicalJson(summary) + '\n');

  return { head: previous, receipt, summary, lines, ids, events, ledgerDir, receiptPath, summaryPath };
}

module.exports = { buildCycle, blob, LOCAL_PROMOTION, CLAIM, DEFAULT_LIMITS, DEFAULT_FAILURES };
