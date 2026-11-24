/**
 * lessons.js — a repair cycle becomes memory, WITHOUT becoming a rule.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Twin Labs runs a real repair cycle on a real repository: it freezes a probe,
 * reproduces a failure twice, applies exact-parent edits, gates the candidate
 * against native regressions and a locked randomized retest, promotes it, and
 * retains a content-addressed ledger of every step. Then it stamps the result:
 *
 *     status: 'bounded-historical-observation-not-universal-rule'
 *
 * and refuses to generalize. That refusal is not a missing feature. It is a
 * soundness stance, and it is correct: generalizing from one repository is how
 * you get an agent that confidently patches the wrong thing somewhere else.
 *
 * The Federation is what makes generalizing HONEST rather than what makes it
 * possible. A lesson stops being a bounded local observation and becomes a fact
 * with a named target, a witness kind, a realm and a promotion rule — and it
 * carries its own boundary with it.
 *
 * SO WHAT MAY ACTUALLY TRAVEL, AND WHAT MAY NOT
 *
 * This is the whole design and it is a judgment about scope, not about plumbing.
 *
 *   TRAVELS (the commons): the METHOD and its BAR. That repo A's repair cleared
 *   exact-parent-only edits with native tests unchanged across N gates is
 *   guidance for an agent about to repair repo B, because it says what
 *   "verified" looked like somewhere that actually ran it. The predicate is
 *   `risk_repair_bar`, which the hub's `down()` already surfaces as "found
 *   elsewhere" — no change to the hub was needed to make a repair lesson reach
 *   another repository's passport.
 *
 *   DOES NOT TRAVEL (stays in `repo:<slug>`): the defect itself. Repo A's probe
 *   failures are defined by repo A's probe contract. Telling repo B "you have
 *   this risk" because repo A's probe found it is precisely the over-reach the
 *   lesson refuses, and it would be a lie dressed as collective learning.
 *
 *   TRAVELS WITH THE CLAIM, ALWAYS: the scope and every stated limit. A lesson
 *   that arrives somewhere without its boundary is a rule, and this file exists
 *   to make sure that never happens by accident.
 *
 * WHY THE WITNESS IS `structural` AND NOT `outcome`
 *
 * The reference is the ledger head plus the blob addresses, and `ledger.js`
 * re-derives the whole chain from the published format without importing the
 * repair engine's own verifier. So anybody holding the cycle directory can check
 * it on demand — which is what `structural` MEANS. Had this landed as `outcome`
 * it would have stayed local forever, because a single node's self-reported
 * outcome does not travel. The lesson is portable because it is checkable, not
 * because it was asserted.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { verifyLedger, readBlob, regularFile } = require('./ledger.js');
const { gateSignal } = require('./referee.js');
const { MAX_FIELD } = require('../passport/equation.js');
const { repoRealm, SHARED_REALM } = require('../federation/realm.js');
const { DEFAULT_CARRIER } = require('../federation/carrier.js');

/** The scope line Twin Labs stamps on every lesson, carried verbatim. Rewording
 *  it would soften it, and softening it is the failure this file guards. */
const LESSON_SCOPE = 'bounded-historical-observation-not-universal-rule';

/**
 * What the repair engine's own promotion says it was, verbatim.
 *
 * A cycle that records anything else is not a repair lesson. Filing one anyway
 * would put `promoted-not-released` into the bar beside a `promotion` fact saying
 * the opposite, and the pair travels into every other repository's passport as
 * guidance — so the mismatch is refused at the door rather than landed and
 * explained. See `promotion-is-not-local` below.
 */
const LOCAL_PROMOTION = 'local-exact-source-promotion-not-release';

/** The event types that make a cycle a COMPLETED cycle. */
const REQUIRED_EVENTS = ['repository.promoted', 'repository.lesson', 'repository.completed'];

const shortHead = (h) => String(h || '').slice(0, 12);

/**
 * A usable ISO timestamp, or null.
 *
 * The cycle's timestamp comes from somebody else's ledger, and `new Date(x)
 * .toISOString()` THROWS on a value it cannot parse. A malformed timestamp in
 * an otherwise sound cycle must not crash the write path — this repository's
 * standard is that a bad record is REPORTED, never a crash. So it is checked,
 * and a caller that gets null falls back to "now", which is honest: the fact is
 * landing now, and the ledger head in the reference still dates the cycle.
 */
function safeIso(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Read and verify one repair cycle directory.
 *
 * A cycle directory is what Twin Labs writes: `receipt.json`, `summary.json`,
 * and `ledger/` holding `events.jsonl` plus content-addressed `blobs/`.
 *
 * @returns {{ok:true, cycle:object} | {rejected:true, reason:string, detail:string}}
 */
function readCycle(dir) {
  const root = String(dir || '').trim();
  if (!root) return { rejected: true, reason: 'no-directory', detail: 'A cycle directory is required.' };

  const receiptFile = regularFile(path.join(root, 'receipt.json'), 'the receipt');
  if (receiptFile.rejected) return receiptFile;
  let receipt;
  try {
    receipt = JSON.parse(receiptFile.bytes.toString('utf8'));
  } catch {
    return { rejected: true, reason: 'receipt-unparseable', detail: 'receipt.json is not JSON.' };
  }

  // The receipt is the operator's claim about the run. It is checked against the
  // log rather than believed: a receipt saying `completed` over a ledger that
  // does not verify is exactly the case this reader exists to catch.
  if (receipt.status !== 'completed') {
    return { rejected: true, reason: 'incomplete', detail: `The receipt says '${receipt.status}'. Only a completed cycle is a lesson.` };
  }
  if (receipt.failed !== false) {
    return { rejected: true, reason: 'failed-run', detail: 'The receipt records a failed run. A failure is evidence, not a lesson.' };
  }
  if (!receipt.head) {
    return { rejected: true, reason: 'no-head', detail: 'The receipt pins no head, so there is nothing to verify against.' };
  }

  const ledgerDir = path.join(root, 'ledger');
  const verified = verifyLedger(ledgerDir, { expectedHead: receipt.head });
  if (verified.rejected) return verified;

  if (verified.events.length !== receipt.events) {
    return {
      rejected: true,
      reason: 'event-count',
      detail: `The receipt claims ${receipt.events} events; the log holds ${verified.events.length}.`,
    };
  }
  if (receipt.runId && verified.runId !== receipt.runId) {
    return { rejected: true, reason: 'run-id', detail: 'The receipt and the log disagree about which run this is.' };
  }

  for (const type of REQUIRED_EVENTS) {
    if (!verified.events.some((e) => e.type === type)) {
      return { rejected: true, reason: 'missing-event', detail: `A completed cycle records '${type}'. This ledger does not.` };
    }
  }

  // ------------------------------------------------------------------
  // EVERYTHING THAT TRAVELS IS DERIVED FROM INSIDE THE CHAIN.
  //
  // `summary.json` and `receipt.json` sit BESIDE the ledger and no hash covers
  // them. Reading the bar off summary.json means an attacker who can write one
  // plain file can make the commons assert "99-gates-passed" for a cycle that
  // ran three — and that claim then travels into every other repository's
  // passport as guidance. So the summary is not a source here. It is a CLAIM,
  // and it is checked against the events that were actually hashed.
  //
  // The passport footer already says it: the chain is the truth, the derived
  // file is the reading of it. This is that rule applied to somebody else's
  // derived file.
  // ------------------------------------------------------------------

  const lessonEvent = verified.events.find((e) => e.type === 'repository.lesson');
  const lessonArtifact = (lessonEvent.artifacts || [])[0];
  if (!lessonArtifact) {
    return { rejected: true, reason: 'no-lesson-artifact', detail: 'The lesson event carries no artifact.' };
  }
  const lessonBlob = readBlob(ledgerDir, lessonEvent.data && lessonEvent.data.lessonId, 'the lesson');
  if (lessonBlob.rejected) return lessonBlob;

  const baselineEvent = verified.events.find((e) => e.type === 'repository.baseline');
  const candidateEvent = verified.events.find((e) => e.type === 'repository.candidate');
  const promoted = verified.events.find((e) => e.type === 'repository.promoted');
  const completed = verified.events.find((e) => e.type === 'repository.completed');
  const evaluations = verified.events.filter((e) => e.type === 'repository.evaluated');

  if (!candidateEvent) {
    return { rejected: true, reason: 'missing-event', detail: "A completed cycle records 'repository.candidate'. This ledger does not." };
  }

  // What the repair changed: from the candidate EVENT, which is hashed.
  const changedPaths = Array.isArray(candidateEvent.data && candidateEvent.data.changedPaths)
    ? candidateEvent.data.changedPaths.filter((p) => typeof p === 'string' && p.trim())
    : [];

  // WHAT COUNTS AS A GATE: THE EVALUATIONS THE PROMOTION DEPENDS ON.
  //
  // The first version defined a gate as "any evaluation that passed against the
  // candidate", which is wrong, and only a REAL cycle showed it. Twin Labs
  // re-tests the promoted source with fresh parameters AFTER promotion; that
  // evaluation passes, runs against the same candidate manifest, and is not one
  // of the gates. Counting it made this reader refuse a genuine cycle as
  // `summary-disagrees` (summary: 3 gates, ledger: 4 passing candidate
  // evaluations) -- the reader disputing a correct summary because its own
  // definition was loose.
  //
  // The engine names its gates: `repository.promoted.gateIds`. That is also the
  // right definition on its merits -- a gate is an evaluation the promotion
  // depends on, not any evaluation that happens to have passed. Fall back to the
  // target-id rule only for a ledger with no promoted event, because refusing
  // every unfamiliar shape would be noise rather than rigor.
  const candidateId = candidateEvent.data && candidateEvent.data.manifestId;
  const namedGateIds = promoted && promoted.data && Array.isArray(promoted.data.gateIds) ? promoted.data.gateIds : null;
  const gateEvents = namedGateIds
    ? evaluations.filter((e) => namedGateIds.includes(e.id))
    : evaluations.filter((e) => e.data && e.data.targetId === candidateId);
  const passingGates = gateEvents.filter((e) => e.data && e.data.passed === true);

  // WHAT EACH PASSING GATE CAN PROVE ABOUT ITS RUN.
  //
  // A gate that records a run of zero tests is not a gate that passed. It is a
  // gate that did not happen -- and the actuator already refuses to COMMIT on
  // exactly that, as `no_test_signal`. Counting it here would let a cycle the
  // write path rejects file a lesson the whole federation then reads as a peer
  // observation. Two halves of one system, one definition of a pass.
  const gates = passingGates.map((e) => {
    const rid = (e.data && e.data.resultId) || null;
    const blob = rid ? readBlob(ledgerDir, rid, 'a gate result') : null;
    return {
      specName: (e.data && e.data.specName) || null,
      resultId: rid,
      signal: gateSignal(blob && blob.ok ? blob.value : null),
    };
  });

  // NO NEXT-ROUND RESULT COUNTS UNLESS IT RAN THE PROMOTED ARTIFACT.
  //
  // A cycle is only closed if the round that follows promotion executed the
  // thing that was promoted. Twin Labs' engine does this correctly -- it
  // materialises the promoted manifest and re-tests THAT -- but nothing here
  // checked it, so a genuine engine bug (or a doctored engine) could promote
  // artifact A and then report the next round's results from artifact B, and
  // this reader would call the cycle clean. The whole chain of reasoning above
  // would be attached to a version that was never tested again.
  //
  // The hash chain does not catch this. Tampering with an event breaks the
  // chain, but an engine that never had the right target in the first place
  // produces a perfectly valid chain describing the wrong experiment.
  //
  // Generic on purpose: "post-promotion" is any evaluation naming the promoted
  // event as a parent, not an evaluation whose spec happens to be called
  // `fresh-retest`. A spec name is a label the engine chooses.
  if (promoted) {
    const promotedTarget = promoted.data && promoted.data.targetId;
    const downstream = evaluations.filter((e) => Array.isArray(e.parents) && promoted.id && e.parents.includes(promoted.id));
    const wrong = downstream.filter((e) => e.data && e.data.targetId !== promotedTarget);
    if (wrong.length && promotedTarget) {
      return {
        rejected: true,
        reason: 'retest-not-closed',
        detail:
          `Promotion names target ${String(promotedTarget).slice(0, 12)} as the accepted artifact, but ` +
          `${wrong.length} evaluation(s) recorded after promotion ran a different target ` +
          `(${wrong.map((e) => String(e.data.targetId).slice(0, 12)).join(', ')}). ` +
          'The next round did not test the repair, so the cycle is not closed.',
      };
    }
  }

  // `absent` does not count. `unknown` still does: the ledger format belongs to
  // somebody else, and silence in a schema we do not fully know is not evidence
  // of absence. Refusing every unfamiliar cycle would be noise, not rigor.
  const gatesRecorded = passingGates.length;
  const gatesWithoutSignal = gates.filter((g) => g.signal === 'absent').map((g) => g.specName || '(unnamed gate)');
  const gatesUnproven = gates.filter((g) => g.signal === 'unknown').length;
  const gatesPassed = gatesRecorded - gatesWithoutSignal.length;

  // What reproduced: read through the content-addressed result blob the
  // discovery evaluation points at, so the number comes from a hash-checked
  // artifact rather than from the summary's transcription of it.
  const discovery = evaluations.find((e) => e.data && e.data.specName === 'discovery') || evaluations[0];
  let reproducedFailingCases = null;
  if (discovery && discovery.data && discovery.data.resultId) {
    const resultBlob = readBlob(ledgerDir, discovery.data.resultId, 'the discovery result');
    if (resultBlob.ok && Array.isArray(resultBlob.value.failures)) reproducedFailingCases = resultBlob.value.failures.length;
  }

  const baselineId = (baselineEvent && baselineEvent.data && baselineEvent.data.manifestId) || null;
  const patchId = (candidateEvent.data && candidateEvent.data.patchId) || null;

  // --------------------------------------------------------------
  // LINEAGE. Everything the repair bar needs in order to check
  // `exact-parent-edits-only` mechanically, derived from inside the chain.
  //
  // Two different kinds of parent live in a cycle and conflating them is the
  // easy mistake:
  //
  //   the EVENT parents   `candidate.parents` — which earlier events this one
  //                       cites. In a genuine cycle these are the reproduction
  //                       evaluation and the contract, NOT the baseline.
  //   the SOURCE parent   `candidate.data.parentId` — which manifest the patch
  //                       was applied to. THIS is the exact parent the bar
  //                       means: the candidate is the baseline plus the patch
  //                       and nothing else.
  //
  // The source parent is recorded twice, once in the candidate event and once
  // inside the content-addressed patch blob, and both are hashed. A cycle that
  // quietly accumulated edits between baseline and candidate therefore has to
  // disagree with itself or break its own ledger to hide it — so the two are
  // compared with each other as well as with the baseline.
  // --------------------------------------------------------------
  const candidateEventId = candidateEvent.id;
  const baselineEventId = baselineEvent ? baselineEvent.id : null;
  const candidateParents = Array.isArray(candidateEvent.parents) ? candidateEvent.parents.slice() : null;
  const candidateParentId = (candidateEvent.data && candidateEvent.data.parentId) || null;

  // The patch blob is named by the candidate event, so verifyLedger has already
  // checked that it hashes to its own address before this line runs.
  let patchParentId = null;
  if (patchId) {
    const patchBlob = readBlob(ledgerDir, patchId, 'the patch');
    if (patchBlob.ok && patchBlob.value && typeof patchBlob.value === 'object') {
      patchParentId = patchBlob.value.parentId != null ? String(patchBlob.value.parentId) : null;
    }
  }

  // Transitive descent, by id: is the baseline event an ancestor of the
  // candidate at all? Walked rather than assumed, because the direct-parent
  // shape is a convention of the repair engine and the ancestry is a fact.
  const byId = new Map(verified.events.map((e) => [e.id, e]));
  const descendsFrom = (targetId) => {
    if (!targetId) return false;
    const queue = [...(candidateParents || [])];
    const seen = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (id === targetId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const e = byId.get(id);
      if (e && Array.isArray(e.parents)) queue.push(...e.parents);
    }
    return false;
  };

  const lineage = {
    baselineEventId,
    candidateEventId,
    candidateParents,
    candidateParentId,
    baselineManifestId: baselineId,
    candidateManifestId: candidateId,
    patchId,
    patchParentId,
    descendsFromBaseline: descendsFrom(baselineEventId),
  };

  // The summary is read only to be CHECKED. Where it disagrees with the chain,
  // the cycle is refused outright rather than quietly preferring one source:
  // a disagreement means somebody edited a file they should not have, and
  // silently picking a winner hides exactly the thing worth knowing.
  const summaryFile = regularFile(path.join(root, 'summary.json'), 'the summary');
  let summary = null;
  if (summaryFile.ok) {
    try {
      summary = JSON.parse(summaryFile.bytes.toString('utf8'));
    } catch {
      return { rejected: true, reason: 'summary-unparseable', detail: 'summary.json is not JSON.' };
    }
  }
  if (summary) {
    const disputes = [];
    if (summary.project != null && lessonBlob.value.project != null && String(summary.project) !== String(lessonBlob.value.project)) {
      disputes.push(`project: summary says '${summary.project}', the lesson artifact says '${lessonBlob.value.project}'`);
    }
    if (summary.passedGates != null && Number(summary.passedGates) !== gatesRecorded) {
      disputes.push(`passedGates: summary says ${summary.passedGates}, the ledger holds ${gatesRecorded} passing gate evaluation(s) against the candidate`);
    }
    if (Array.isArray(summary.changedPaths) && canonicalList(summary.changedPaths) !== canonicalList(changedPaths)) {
      // Name the difference, not just the counts: two lists of the same length
      // that disagree are the interesting case, and "1 vs 1" reads like a bug.
      const onlySummary = summary.changedPaths.filter((x) => !changedPaths.includes(x));
      const onlyLedger = changedPaths.filter((x) => !summary.changedPaths.includes(x));
      disputes.push(
        `changedPaths: summary-only [${onlySummary.slice(0, 3).join(', ')}]${onlySummary.length > 3 ? ` +${onlySummary.length - 3}` : ''}` +
        ` vs ledger-only [${onlyLedger.slice(0, 3).join(', ')}]${onlyLedger.length > 3 ? ` +${onlyLedger.length - 3}` : ''}`
      );
    }
    if (summary.reproducedFailingCases != null && reproducedFailingCases != null && Number(summary.reproducedFailingCases) !== reproducedFailingCases) {
      disputes.push(`reproducedFailingCases: summary says ${summary.reproducedFailingCases}, the discovery result holds ${reproducedFailingCases}`);
    }
    if (summary.baselineId != null && baselineId != null && String(summary.baselineId) !== String(baselineId)) {
      disputes.push('baselineId: summary and the baseline event disagree');
    }
    if (disputes.length) {
      return {
        rejected: true,
        reason: 'summary-disagrees',
        detail: `summary.json is not covered by the ledger's hash chain and it does not match what is: ${disputes.join('; ')}.`,
      };
    }
  }

  // THE LADDER, AND WHY IT IS NOT ONE WORD.
  //
  // "recorded", "reproduced", "repaired", "accepted" and "verified" are five
  // different claims, and a dashboard that collapses them turns a discovery into
  // a fix in transit. Each rung is derived from an event, never asserted: the
  // rung is the highest one whose evidence is present, and every rung carries
  // whether it was met so a reader can see the gap rather than infer it.
  //
  //   recorded   the chain verifies and a candidate exists
  //   reproduced the defect was seen, and seen again against unmodified source
  //   repaired   the candidate differs from the baseline and its gates passed
  //   accepted   a promotion event names the candidate and its gates
  //   verified   a post-promotion evaluation ran the PROMOTED artifact and passed
  const rungs = [];
  rungs.push({ rung: 'recorded', met: true, why: 'the ledger verifies and records a candidate' });

  const reproduction = evaluations.filter((e) => e.data && (e.data.specName === 'reproduction' || e.data.specName === 'discovery'));
  rungs.push({
    rung: 'reproduced',
    met: Boolean(reproduction.length && reproducedFailingCases > 0),
    why: reproduction.length ? `${reproduction.length} discovery/reproduction evaluation(s)` : 'no reproduction evaluation recorded',
  });

  rungs.push({
    rung: 'repaired',
    met: Boolean(changedPaths.length && gatesPassed > 0),
    why: changedPaths.length ? `${changedPaths.length} path(s) changed, ${gatesPassed} gate(s) passed` : 'the candidate changed nothing',
  });

  rungs.push({
    rung: 'accepted',
    met: Boolean(promoted && promoted.data && promoted.data.targetId),
    why: promoted ? `promotion names ${String(promoted.data.targetId).slice(0, 12)}` : 'no promotion event',
  });

  const postPromotion = promoted
    ? evaluations.filter((e) => Array.isArray(e.parents) && promoted.id && e.parents.includes(promoted.id) && e.data)
    : [];
  const closedRetest = postPromotion.find(
    (e) => promoted && e.data.targetId === promoted.data.targetId && e.data.passed === true
  );
  rungs.push({
    rung: 'verified',
    met: Boolean(closedRetest),
    why: closedRetest
      ? `the next round ran the promoted artifact (${String(closedRetest.data.targetId).slice(0, 12)}) and passed`
      : postPromotion.length
        ? 'the next round did not run the promoted artifact'
        : 'no evaluation was recorded after promotion',
  });

  const highest = [...rungs].reverse().find((r) => r.met) || rungs[0];

  return {
    ok: true,
    cycle: {
      dir: path.resolve(root),
      status: highest.rung,
      ladder: rungs,
      runId: verified.runId,
      head: verified.head,
      headShort: shortHead(verified.head),
      eventCount: verified.events.length,
      // From the lesson ARTIFACT, which is content-addressed and inside the
      // chain — not from the summary's transcription of it.
      project: lessonBlob.value.project != null ? String(lessonBlob.value.project) : null,
      summary,
      summaryPresent: Boolean(summary),
      lesson: lessonBlob.value,
      lessonId: lessonEvent.data.lessonId,
      baselineId,
      patchId,
      promotedStatus: (promoted && promoted.data && promoted.data.status) || null,
      lineage,
      // Validated, not trusted: an unparseable timestamp is null, not a land()
      // crash three calls later.
      completedAt: safeIso(completed && completed.timestamp),
      completedAtRaw: (completed && completed.timestamp) || null,
      evaluations: evaluations.length,
      gatesRecorded,
      gatesPassed,
      gates,
      gatesWithoutSignal,
      gatesUnproven,
      changedPaths,
      reproducedFailingCases,
      claim: (summary && summary.claim) || null,
    },
  };
}

/** Order-insensitive comparison of two path lists, for the cross-check only. */
function canonicalList(list) {
  return (Array.isArray(list) ? list.map((x) => String(x)).slice() : []).sort().join('\u0000');
}

/**
 * Fit a value into an equation field, or summarise it.
 *
 * An equation field is capped, because a field longer than that is a sentence
 * and a sentence is not a reduction. A long list is NOT truncated character-wise
 * — a half a path is worse than a count. It becomes a count, and the full list
 * stays where the witness points: the ledger, which the reference names.
 */
function fitField(value, { prefix = '' } = {}) {
  const s = String(value ?? '').trim();
  const budget = MAX_FIELD - prefix.length;
  if (s.length <= budget) return `${prefix}${s}`;
  return `${prefix}${s.slice(0, Math.max(0, budget - 1)).trimEnd()}…`;
}

/**
 * The equations one cycle honestly supports.
 *
 * Two groups, and the split is the design:
 *
 *   commons  the method and its bar, plus the scope. Travels, because it is
 *            guidance about what verification looked like, not a claim about
 *            another repository's code.
 *   repo     the specifics — paths, failure counts, every stated limit. Stays in
 *            `repo:<slug>`, because it is about THIS code.
 *
 * Every object is bounded by MAX_FIELD and every reference points at something
 * re-derivable in the ledger.
 */
function lessonEquations(cycle, { slug }) {
  // May return a rejection instead of a group set: see the limit check below.
  const subject = `repo:${slug}`;
  const realm = repoRealm(slug);
  const at = safeIso(cycle.completedAt) || new Date().toISOString();
  const headRef = `ledger:${cycle.head}`;

  // What the repair engine's own promotion says it was. Carried verbatim: it
  // reads 'local-exact-source-promotion-not-release', and rewording that as
  // 'released' is exactly the kind of quiet upgrade this file must not do.
  const promotion = cycle.promotedStatus || 'unrecorded';

  // A RELEASE IS NOT A REPAIR LESSON.
  //
  // The bar below asserts `promoted-not-released` because that is what a local
  // promotion is. If the cycle's own hashed promotion event says otherwise, the
  // two facts contradict each other and BOTH would travel to the commons, where
  // another repository's passport would print a bar claiming no release beside a
  // promotion saying there was one. Deriving the token from the status would
  // quietly invent a new obligation nobody wrote a check for; refusing is the
  // only move that leaves the commons telling the truth.
  //
  // If the repair engine ever renames this status, every lesson refuses with a
  // named reason and an operator decides. That is the intended failure mode.
  if (promotion !== LOCAL_PROMOTION) {
    return {
      rejected: true,
      reason: 'promotion-is-not-local',
      detail:
        `The cycle's promotion event records '${promotion}', not '${LOCAL_PROMOTION}'. ` +
        'A release is a different kind of event with different authority, and filing it as a repair lesson would put ' +
        "'promoted-not-released' into the commons beside a promotion fact saying the opposite. Nothing landed.",
    };
  }

  // A GATE THAT RAN NOTHING IS NOT A GATE THAT PASSED.
  //
  // The actuator refuses to COMMIT on exactly this evidence, as `no_test_signal`:
  // "a command that proves nothing cannot referee a commit". If the memory path
  // counted it anyway, a cycle the write path rejects would still file a lesson
  // -- and would file it with a LOWER gate count than the project's standing
  // bar, which drift then reports as a loosening and every later cycle
  // satisfies. Refusing lands nothing, so nothing drifts, and the reason names
  // the gate to go and fix.
  const proved = Array.isArray(cycle.gatesWithoutSignal) ? cycle.gatesWithoutSignal : [];
  if (proved.length) {
    return {
      rejected: true,
      reason: 'gates-proved-nothing',
      detail:
        `${proved.length} gate(s) recorded a pass with no test run behind them: ${proved.join(', ')}. ` +
        'A gate that ran nothing is not a gate that passed -- the actuator refuses to commit on the same ' +
        "evidence as `no_test_signal`. Filing this cycle would lower the recorded gate count and loosen the " +
        "project's standing bar. Nothing landed.",
    };
  }

  // And a cycle that ran NO gates against its candidate cannot support an
  // `N-gates-passed` claim at any N. Filing `0-gates-passed` would put a bar in
  // the commons that is vacuous by construction -- parseable, and unusable.
  if (!cycle.gatesRecorded) {
    return {
      rejected: true,
      reason: 'no-gates-recorded',
      detail:
        'The cycle records no gate evaluation that passed against its candidate. There is no gate count to ' +
        'publish, and `0-gates-passed` would be a bar no cycle could ever fail. Nothing landed.',
    };
  }

  const gates = cycle.gatesPassed;
  const bar = [
    'exact-parent-edits-only',
    'native-tests-unchanged',
    `${gates}-gates-passed`,
    'promoted-not-released',
  ].join(';');

  const commons = [
    {
      shelf: 'operational',
      realm: SHARED_REALM,
      equation: { subject, predicate: 'repair_verified', object: fitField(`${cycle.headShort}:${cycle.eventCount}-events`) },
      target: subject,
      reference: headRef,
      note: 'a completed, independently re-verified repair cycle exists for this repository',
    },
    {
      shelf: 'operational',
      realm: SHARED_REALM,
      equation: { subject, predicate: 'risk_repair_bar', object: fitField(bar) },
      target: subject,
      reference: headRef,
      note: 'the bar a repair cleared here — the part that is guidance for another repository',
    },
    {
      // The refusal travels with the claim. Always, and in the commons, so no
      // reader can pick up the lesson and miss the boundary on it.
      shelf: 'operational',
      realm: SHARED_REALM,
      equation: { subject, predicate: 'claim_scope', object: fitField(LESSON_SCOPE) },
      target: subject,
      reference: headRef,
      note: 'what this lesson does NOT claim',
    },
    {
      shelf: 'operational',
      realm: SHARED_REALM,
      equation: { subject, predicate: 'promotion', object: fitField(promotion) },
      target: subject,
      reference: headRef,
      note: 'local promotion is not a release',
    },
  ];

  const scoped = [];
  if (cycle.changedPaths.length) {
    const joined = cycle.changedPaths.join(',');
    // The patch blob is named by the candidate EVENT, so it is inside the chain.
  // A reference to a blob nobody hashed would be a witness that cannot be
  // re-derived — which is what `structural` must never be.
  const patchRef = cycle.patchId ? `${headRef}|blob:${cycle.patchId}` : headRef;
  scoped.push({
      shelf: 'operational',
      realm,
      equation: {
        subject: `${subject}/cycle:${cycle.headShort}`,
        predicate: 'repaired_paths',
        // Over the cap, this becomes a count and the ledger holds the list —
        // never half a path.
        object: joined.length <= MAX_FIELD ? fitField(joined) : fitField(`${cycle.changedPaths.length}-paths-see-ledger`),
      },
      target: subject,
      reference: patchRef,
      note: 'which files the repair touched',
    });
  }
  scoped.push({
    shelf: 'operational',
    realm,
    equation: {
      subject: `${subject}/cycle:${cycle.headShort}`,
      predicate: 'reproduced_failures',
      object: fitField(String(cycle.reproducedFailingCases)),
    },
    target: subject,
    reference: headRef,
    note: 'failures reproduced twice on the unmodified source before any edit',
  });

  // Every stated limit becomes its own fact in the repository's own realm. A
  // limit that is summarised away is a limit nobody will read.
  //
  // AND A LIMIT IS NEVER TRUNCATED. This is decision D6 — refuse, never strip —
  // applied to a boundary: a limit cut to fit reads as a weaker limit than the
  // one the repair engine wrote, and quietly softening the boundary is the exact
  // failure this module exists to prevent. A limit that does not fit refuses the
  // whole lesson, so the operator decides rather than the field width deciding.
  const limits = Array.isArray(cycle.lesson && cycle.lesson.limits) ? cycle.lesson.limits : [];
  for (const limit of limits) {
    const text = String(limit ?? '').trim();
    if (text.length > MAX_FIELD) {
      return {
        rejected: true,
        reason: 'limit-too-long',
        detail:
          `A stated limit is ${text.length} characters and an equation field holds ${MAX_FIELD}. ` +
          'It will not be truncated, because a shortened boundary reads as a weaker one. ' +
          'Nothing landed. Shorten the limit at the source, or file it as its own record and reference it.',
      };
    }
  }
  limits.forEach((limit, i) => {
    scoped.push({
      shelf: 'operational',
      realm,
      equation: {
        subject: `${subject}/cycle:${cycle.headShort}`,
        predicate: `limit_${i + 1}`,
        // Already checked against MAX_FIELD above, so this cannot truncate.
        object: fitField(String(limit)),
      },
      target: subject,
      reference: `${headRef}|blob:${cycle.lessonId}`.slice(0, 160),
      note: 'a limit the lesson states about itself',
    });
  });

  return { commons, scoped, at, reference: headRef };
}

/**
 * Land one cycle's lesson on the repair carrier.
 *
 * @param {object} federation  a Federation store
 * @param {object} cycle       from `readCycle`
 * @param {object} opts
 * @param {string} opts.slug   the repository's registered slug
 * @param {string} opts.nodeId the node witnessing — must be registered
 * @param {string} [opts.carrier]  defaults to `repair`; a lesson is repair-side
 *                                 evidence and there is no honest alternative
 * @param {string} [opts.onBehalfOf]  set when a hub files on another node's
 *                                 behalf; recorded on the event so a lesson
 *                                 filed by proxy never looks self-observed
 * @param {string} [opts.at]
 */
function landLesson(federation, cycle, { slug, nodeId, carrier = DEFAULT_CARRIER, at, onBehalfOf } = {}) {
  if (!slug) return { rejected: true, reason: 'slug', detail: 'A lesson is about a repository; name it.' };
  if (!nodeId) return { rejected: true, reason: 'nodeId', detail: 'A lesson names the node that witnessed it.' };

  // THE WITNESS AND THE SUBJECT MUST BE THE SAME REPOSITORY.
  //
  // The registry checks that a node exists; it cannot check that a node is
  // talking about ITSELF. Without this, `twin-labs` could file
  // `risk_repair_bar(repo:fleets)` from a cycle it ran on its own source — and
  // fleets would then be told, in its own passport, that a bar was "found
  // elsewhere" when in fact it was found nowhere near fleets. That is a false
  // fact with a valid witness, which is the hardest kind to notice.
  //
  // `onBehalfOf` is the explicit escape hatch for a hub ingesting many
  // repositories in one pass. It is recorded on the event, so a lesson filed by
  // proxy says so on the record instead of looking self-observed.
  const behalf = String(onBehalfOf || '').trim() || null;
  if (String(nodeId) !== String(slug) && behalf !== String(nodeId)) {
    return {
      rejected: true,
      reason: 'witness-is-not-subject',
      detail:
        `Node '${nodeId}' cannot file a lesson whose subject is 'repo:${slug}'. ` +
        'A lesson is witnessed by the repository it is about. If a hub is ingesting on behalf of that ' +
        `repository, say so with onBehalfOf: '${nodeId}'.`,
    };
  }
  if (carrier !== DEFAULT_CARRIER) {
    // Not a limitation, a decision stated out loud: a repair cycle is repair-side
    // evidence. Landing one on the browser carrier would put source-level detail
    // where a chat composer can read it, for no benefit to either population.
    return {
      rejected: true,
      reason: 'carrier',
      detail:
        `A repair lesson lands on the '${DEFAULT_CARRIER}' carrier; '${carrier}' was requested. ` +
        'Source-level detail on the browser carrier reaches a surface that types into third-party chat composers, ' +
        'and it would tell a repair agent nothing it could not read in its own carrier.',
    };
  }

  const groups = lessonEquations(cycle, { slug });
  if (groups && groups.rejected) return groups;
  // `at` is checked here as well as in readCycle, because landLesson is public:
  // a caller can hand it a cycle object it built itself.
  const stamp = safeIso(at) || groups.at || new Date().toISOString();
  const landed = [];
  const refused = [];

  for (const group of ['commons', 'scoped']) {
    for (const row of groups[group]) {
      const res = federation.land({
        shelf: row.shelf,
        carrier,
        realm: row.realm,
        equation: row.equation,
        witness: 'structural', // re-derivable from the ledger, by anyone, on demand
        nodeId,
        reference: row.reference,
        target: row.target,
        at: stamp,
      });
      if (res.rejected) refused.push({ group, predicate: row.equation.predicate, reason: res.reason, detail: res.detail });
      else landed.push({ group, realm: row.realm, predicate: row.equation.predicate, rendered: res.fact.rendered, action: res.action, note: row.note });
    }
  }

  // A cycle is recorded as an event too, so the flow of lessons into the commons
  // is auditable from the carrier and not only from the facts it left behind.
  try {
    federation.append('event', {
      kind: 'lesson-landed',
      carrier,
      slug,
      nodeId,
      onBehalfOf: behalf,
      runId: cycle.runId,
      head: cycle.head,
      project: cycle.project,
      scope: LESSON_SCOPE,
      landed: landed.length,
      refused: refused.length,
      commons: landed.filter((l) => l.group === 'commons').length,
      scoped: landed.filter((l) => l.group === 'scoped').length,
      at: stamp,
    });
  } catch { /* the facts landed; a store that cannot log the event still holds them */ }

  return {
    ok: true,
    slug,
    carrier,
    runId: cycle.runId,
    head: cycle.head,
    scope: LESSON_SCOPE,
    landed,
    refused,
    detail: refused.length
      ? `${landed.length} fact(s) landed, ${refused.length} refused.`
      : `${landed.length} fact(s) landed: ${landed.filter((l) => l.group === 'commons').length} in the commons (the method and its boundary), ${landed.filter((l) => l.group === 'scoped').length} scoped to repo:${slug} (the specifics).`,
  };
}

/** Read a cycle and land it in one move. */
function ingestCycle(federation, dir, opts = {}) {
  const read = readCycle(dir);
  if (read.rejected) return read;
  const slug = opts.slug || read.cycle.project || null;
  return landLesson(federation, read.cycle, { ...opts, slug });
}

/** Exposed for the CLI: the slug a cycle claims for itself, from the chain. */
function cycleSlug(cycle) {
  return cycle && cycle.project ? String(cycle.project) : null;
}

module.exports = { readCycle, lessonEquations, landLesson, ingestCycle, cycleSlug, canonicalList, safeIso, LESSON_SCOPE, LOCAL_PROMOTION, REQUIRED_EVENTS, MAX_FIELD };
