/**
 * bar.js — the repair bar, from prose to precondition.
 *
 * THE PROBLEM THIS FILE EXISTS BECAUSE OF
 *
 * A completed repair cycle lands `risk_repair_bar(repo:clearcut) =
 * exact-parent-edits-only;native-tests-unchanged;3-gates-passed;
 * promoted-not-released` in the commons. Another repository's passport picks it
 * up through `hub.down()` and prints it under "Found elsewhere in the system".
 *
 * That is a GUIDE with no teeth. An agent reads the sentence, and then does
 * whatever it was going to do anyway, and nothing in the system ever finds out.
 * A memory that can be ignored without consequence is a suggestion, and this
 * repository's whole posture is that conventions do not hold — enforcement lives
 * in the identity, not in the file path, not in the prose.
 *
 * WHY THE OBVIOUS FIX IS WRONG
 *
 * The obvious fix is to make the bar a rule: refuse work that does not clear it.
 * That breaks the design in the place the design is most careful. Every lesson
 * carries `claim_scope = bounded-historical-observation-not-universal-rule`.
 * Making repository B refuse a repair because repository A once cleared three
 * gates is precisely "a method that arrived looking like a rule" — the failure
 * `lessons.js` splits commons from scoped to prevent, reintroduced one layer up.
 *
 * THE RESOLUTION: THE BAR IS THE CONDITION OF COMPARISON, NOT A RULE
 *
 * `exact-parent-edits-only;3-gates-passed` is not a claim about how repairs
 * ought to be done. It is the set of conditions under which the promotion this
 * repository already recorded MEANT what it says. So the question the bar can
 * honestly answer is not "are you allowed to do this?" but:
 *
 *     can this cycle be measured against what this repository already knows?
 *
 * If the new cycle clears two gates where the recorded bar is three, the two
 * cycles are not comparable, and any claim of continuity between them — "we
 * repaired it again, the same way" — is unsupported. That is a statement about
 * evidence, not about permission. It refuses to WITNESS, not to ACT. The agent
 * is still free to promote whatever it likes; it just cannot file it beside the
 * earlier work as though the two were the same kind of thing.
 *
 * THREE CONSEQUENCES THAT ARE LOAD-BEARING
 *
 *  1. THREE-VALUED VERDICTS. An obligation is `met`, `unmet`, or
 *     `indeterminate`. `indeterminate` NEVER counts as met. An obligation the
 *     guard could not decide is not an obligation the guard discharged, and a
 *     two-valued check turns "I could not tell" into "fine" — which is the same
 *     silent upgrade as reading a bar off an unhashed summary.
 *
 *  2. A CLOSED VOCABULARY, AND AN UNKNOWN TOKEN POISONS THE WHOLE BAR. If the
 *     bar string contains a token this reader does not know, the bar is
 *     `unverifiable` and no cycle is comparable to it. Checking only the tokens
 *     it recognises and reporting "met" would be reporting a pass over a bar it
 *     did not fully read. This is decision D6 — refuse, never strip — applied to
 *     an obligation list.
 *
 *  3. YOUR BAR BINDS YOU; NOBODY ELSE'S DOES. The binding bar is the one whose
 *     subject is `repo:<the slug being guarded>`. Every other repository's bar is
 *     reported as ADVISORY and there is no code path from an advisory obligation
 *     to a refusal. Guarding repo B against repo A's bar is refused outright,
 *     because that is how a bounded observation becomes a universal rule.
 *
 * THE RECEIPT IS HASHED, BECAUSE THE BAR IS WHAT HOLDS THE AGENT
 *
 * A bar read at the moment of checking is a bar nobody was ever shown. So
 * `issueBar()` produces a RECEIPT: the obligations, the signature of every fact
 * they were derived from, the store head at issue time, and the pattern
 * vocabulary the checks will use. The receipt is content-addressed over its own
 * body, exactly like a ledger event.
 *
 * That is not decoration. The bar is the thing that says no, so an agent that
 * does not like the bar edits the receipt — and an unhashed receipt can be
 * loosened between issue and guard by anybody who can write one plain file. That
 * is the M1 hole from the Red Queen pass, in a new place, and it is closed the
 * same way: `id = sha256(canonical(body))`, recomputed on the way back in.
 *
 * Drift is then reportable rather than invisible. If the commons has grown an
 * obligation the issued receipt did not carry, the cycle is `not-comparable`,
 * because the repository now knows something the agent was never shown.
 *
 * GUARD WRITES NOTHING
 *
 * `guardCycle()` reads the cycle, reads the bar, compares, and returns. It lands
 * no fact and appends no event, and the result says `wrote: false` so a caller
 * cannot assume otherwise. A check that mutates memory is not a check — it is a
 * witness filing itself.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalJson, sha256Bytes, regularFile } = require('./ledger.js');
const { readCycle, LOCAL_PROMOTION } = require('./lessons.js');
const { SHARED_REALM, isCarrier } = require('../federation/realm.js');
const { DEFAULT_CARRIER } = require('../federation/carrier.js');

const BAR_SCHEMA = 'forgeflight.repair-bar.v1';

/**
 * The obligation vocabulary. CLOSED.
 *
 * A bar token nobody has written a check for is not a token to skip — see
 * `parseBar`. Adding a token means adding its check here in the same commit.
 */
const OBLIGATIONS = ['exact-parent-edits-only', 'native-tests-unchanged', 'promoted-not-released'];

/** `<n>-gates-passed`, with n bounded so a bar cannot ask for an absurd count. */
const GATES_RE = /^([0-9]{1,3})-gates-passed$/;

/**
 * The paths that count as "the repository's own tests".
 *
 * This is the weakest check in the file and it is worth being blunt about why:
 * a repository whose tests live in `checks/` or `probes/` will not match, and a
 * miss reports `met` when the truth is `unmet` — the unsafe direction. Two
 * things hold it up anyway. The INPUT is tamper-evident: `changedPaths` is read
 * from the hashed `repository.candidate` event, so a cycle cannot hide a path
 * without breaking its own ledger. And the VOCABULARY is recorded in the
 * receipt, so any reader can see which patterns decided the verdict and object
 * to them. What this cannot do is decide the question for a repository whose
 * test layout it has never been told about, which is why the verdict for an
 * empty path list is `indeterminate` rather than `met`.
 */
const TEST_PATTERNS = [
  /(^|\/)(tests?|__tests__|spec|specs)\//i,
  /\.(test|spec|tests|specs)\.[a-z0-9]+$/i,
  /(^|\/)test_[^/]+$/i,
];

const isTestPath = (p) => TEST_PATTERNS.some((re) => re.test(String(p)));

/** A witness that points at a ledger head, which is what makes it re-derivable. */
const LEDGER_REF = /^ledger:[a-f0-9]{64}/;

/**
 * WHO MAY SET A REPOSITORY'S BAR.
 *
 * `land()` validates that a node is REGISTERED; it does not check that the node
 * is talking about ITSELF, because for most facts that would be wrong — five
 * distinct nodes witnessing one claim is the whole promotion rule. A bar is not
 * most facts. It is the standard a repository is held to, so a bar authored by
 * somebody else is not a bar, it is an imposition, and the Red Queen found that
 * `fleets` could reduce `clearcut`'s four obligations to one and sail a cycle
 * that had edited its own tests straight through.
 *
 * Two conditions, both required:
 *
 *   the repository said it    every witness is the subject itself, or arrived
 *                             through a bridge with provenance attached
 *   it is re-derivable        every witness points at a ledger head, or is a
 *                             named human ruling — "trust me" is neither
 *
 * A bar that fails either is not deleted and not hidden: it is reported as
 * DISPUTED, with the nodes and references that disqualify it, so an operator can
 * see that somebody tried. A proxy ingest (a hub filing `onBehalfOf` a
 * repository) lands here too, and that is deliberate — a bar the repository did
 * not assert itself informs, and the note says how to make it bind.
 */
function barAuthority(fact, slug) {
  const witnesses = (fact && fact.witnesses) || [];
  if (!witnesses.length) return { trusted: false, reason: 'the bar carries no witness at all', nodes: [], references: [] };

  const foreign = witnesses.filter((w) => !w.origin && String(w.nodeId) !== String(slug));
  if (foreign.length) {
    return {
      trusted: false,
      reason: `witnessed by ${[...new Set(foreign.map((w) => w.nodeId))].join(', ')} — not by the repository it sets a bar for`,
      nodes: [...new Set(witnesses.map((w) => String(w.nodeId)))],
      references: witnesses.map((w) => String(w.reference || '')),
    };
  }

  const ungrounded = witnesses.filter((w) => w.kind !== 'human' && !LEDGER_REF.test(String(w.reference || '')));
  if (ungrounded.length) {
    return {
      trusted: false,
      reason: `${ungrounded.length} witness(es) point at something that is not a ledger head and is not a human ruling, so the bar cannot be re-derived`,
      nodes: [...new Set(witnesses.map((w) => String(w.nodeId)))],
      references: ungrounded.map((w) => String(w.reference || '')),
    };
  }

  return {
    trusted: true,
    reason: 'authored by the repository it is about, citing a ledger head',
    nodes: [...new Set(witnesses.map((w) => String(w.nodeId)))],
    references: witnesses.map((w) => String(w.reference || '')),
  };
}

const RELEASE_RE = /releas|publish|deploy|ship|tag/i;

const VERDICTS = ['met', 'unmet', 'indeterminate'];

const obligation = (token, kind, verdict, detail, extra = {}) => ({
  token,
  kind,
  verdict,
  detail,
  ...extra,
});

// ---------------------------------------------------------------------------
// PARSING
// ---------------------------------------------------------------------------

/**
 * Split a bar object into obligations.
 *
 * Returns `unverifiable: true` rather than a partial list whenever the bar
 * cannot be read whole: an unknown token, a self-contradiction, or nothing at
 * all. A bar read halfway is worse than a bar not read, because it produces a
 * confident `comparable` over checks that were never run.
 */
function parseBar(object) {
  const raw = String(object == null ? '' : object);
  const tokens = raw.split(';').map((t) => t.trim()).filter(Boolean);
  const obligations = [];
  const unrecognized = [];
  const problems = [];

  if (!tokens.length) {
    return { obligations, unrecognized, tokens, unverifiable: true, problems: ['the bar is empty: there is nothing to check a cycle against'] };
  }

  for (const token of tokens) {
    const gates = GATES_RE.exec(token);
    if (gates) {
      obligations.push({ token, kind: 'gates-passed', min: Number(gates[1]) });
    } else if (OBLIGATIONS.includes(token)) {
      obligations.push({ token, kind: token });
    } else {
      // NOT DROPPED. Reported, and it makes the whole bar unverifiable.
      unrecognized.push(token);
    }
  }

  if (unrecognized.length) {
    problems.push(
      `the bar names ${unrecognized.length} obligation(s) this reader has no check for: ${unrecognized.join(', ')}. ` +
      'It will not check the ones it recognises and report a pass over a bar it did not fully read.'
    );
  }

  // Two different gate minimums is a bar that contradicts itself. Taking the
  // max would be picking a winner silently; taking the min would be softening
  // it. Both are the operator's decision, not the reader's.
  const mins = [...new Set(obligations.filter((o) => o.kind === 'gates-passed').map((o) => o.min))];
  if (mins.length > 1) {
    problems.push(`the bar states conflicting gate minimums (${mins.join(' vs ')})`);
  }

  // A GATE MINIMUM OF ZERO IS NOT AN OBLIGATION.
  //
  // It is a bar every cycle satisfies forever -- the standing standard lowered
  // to nothing by whichever cycle happened to record no gates. The token parses
  // cleanly, so this is not `unrecognized`; it is vacuous, and a bar containing
  // it cannot serve as a standard to compare against. Same posture as the
  // conflicting-minimums case above: the reader reports and declines, and the
  // operator decides what the project's floor actually is.
  if (mins.includes(0)) {
    problems.push(
      'the bar asks for 0 gates to have passed, which no cycle can ever fail: ' +
      'an obligation with a minimum of zero is not an obligation'
    );
  }

  const kinds = obligations.map((o) => o.kind);
  const dupes = [...new Set(kinds.filter((k, i) => k !== 'gates-passed' && kinds.indexOf(k) !== i))];
  if (dupes.length) problems.push(`the bar repeats obligation(s): ${dupes.join(', ')}`);

  return { obligations, unrecognized, tokens, unverifiable: problems.length > 0, problems };
}

// ---------------------------------------------------------------------------
// THE CHECKS
// ---------------------------------------------------------------------------

const CHECKS = {
  /**
   * The candidate is the baseline plus the patch, and nothing else.
   *
   * TWO PARENTS, AND ONLY ONE OF THEM IS THE EXACT ONE. A cycle's candidate
   * event cites earlier EVENTS as its parents — in a genuine chain those are the
   * reproduction evaluation and the contract, not the baseline. The parent the
   * bar means is the SOURCE parent: `candidate.data.parentId`, the manifest the
   * patch was applied to. If that is the baseline manifest, the promotion is of
   * a tree anybody can reproduce from the recorded baseline plus the recorded
   * patch. If it is anything else, edits accumulated between the two and the
   * promotion is of something nobody can rebuild.
   *
   * The source parent is recorded twice — in the candidate event and inside the
   * content-addressed patch blob — and both are hashed, so they are compared
   * with each other as well as with the baseline. Ancestry is walked rather than
   * assumed: the direct-parent shape is a convention of the repair engine, the
   * descent is a fact.
   */
  'exact-parent-edits-only'(o, cycle) {
    const lin = cycle.lineage || null;
    if (!lin) {
      return obligation(o.token, o.kind, 'indeterminate', 'the cycle reader recorded no lineage, so the exact parent cannot be checked');
    }
    if (!lin.baselineManifestId) {
      return obligation(o.token, o.kind, 'indeterminate', 'the ledger records no baseline manifest, so there is no exact parent to compare against');
    }
    if (!lin.candidateParentId) {
      return obligation(o.token, o.kind, 'indeterminate', 'the candidate event records no source parent, so what the patch was applied to is unknown');
    }

    const base = String(lin.baselineManifestId).slice(0, 12);
    const problems = [];
    if (String(lin.candidateParentId) !== String(lin.baselineManifestId)) {
      problems.push(`the patch was applied to ${String(lin.candidateParentId).slice(0, 12)}, not to the baseline ${base}`);
    }
    if (lin.patchParentId == null) {
      problems.push('the patch blob records no parent, so the second in-chain copy of the source parent is missing');
    } else if (String(lin.patchParentId) !== String(lin.candidateParentId)) {
      problems.push(
        `the candidate event and the patch blob disagree about the source parent (${String(lin.candidateParentId).slice(0, 12)} vs ${String(lin.patchParentId).slice(0, 12)})`
      );
    }
    if (lin.descendsFromBaseline === false) {
      problems.push('the candidate does not descend from the baseline event at all');
    } else if (lin.descendsFromBaseline == null) {
      problems.push('the candidate records no event ancestry, so descent from the baseline cannot be walked');
    }

    if (!problems.length) {
      return obligation(o.token, o.kind, 'met', `the patch was applied to the exact baseline ${base}, both in-chain records agree, and the candidate descends from it`, {
        baseline: base,
      });
    }
    return obligation(o.token, o.kind, 'unmet', `${problems.join('; ')} — the promotion is of a tree nobody can reproduce from the baseline plus the patch`, {
      baseline: base,
      candidateParent: String(lin.candidateParentId).slice(0, 12),
      patchParent: lin.patchParentId == null ? null : String(lin.patchParentId).slice(0, 12),
    });
  },

  /**
   * The repair did not rewrite the tests that graded it.
   *
   * A gate count means nothing if the cycle edited the gates. See TEST_PATTERNS
   * for what this check can and cannot decide.
   */
  'native-tests-unchanged'(o, cycle) {
    const paths = Array.isArray(cycle.changedPaths) ? cycle.changedPaths : [];
    if (!paths.length) {
      return obligation(o.token, o.kind, 'indeterminate', 'the cycle changed no paths, so there is nothing to classify');
    }
    const hits = paths.filter(isTestPath);
    if (!hits.length) {
      return obligation(o.token, o.kind, 'met', `none of the ${paths.length} changed path(s) is a test path under the recorded vocabulary`, {
        vocabulary: TEST_PATTERNS.map(String),
      });
    }
    return obligation(
      o.token,
      o.kind,
      'unmet',
      `the cycle edited ${hits.length} test path(s): ${hits.slice(0, 4).join(', ')}${hits.length > 4 ? ` +${hits.length - 4} more` : ''}. ` +
        'A gate count from tests the cycle itself rewrote is not a gate count.',
      { paths: hits }
    );
  },

  'gates-passed'(o, cycle) {
    const n = cycle.gatesPassed;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return obligation(o.token, o.kind, 'indeterminate', 'the cycle records no gate count');
    }
    if (n >= o.min) {
      return obligation(o.token, o.kind, 'met', `${n} gate evaluation(s) passed against the candidate; the bar asks for ${o.min}`, { gates: n, min: o.min });
    }
    return obligation(o.token, o.kind, 'unmet', `${n} gate evaluation(s) passed against the candidate; the bar asks for ${o.min}`, { gates: n, min: o.min });
  },

  /**
   * A local promotion is not a release, and this guard will not witness one as
   * a repair. The status comes from the hashed `repository.promoted` event.
   */
  'promoted-not-released'(o, cycle) {
    const status = cycle.promotedStatus;
    if (!status) {
      return obligation(o.token, o.kind, 'indeterminate', 'the ledger records no promotion status');
    }
    if (status === LOCAL_PROMOTION) {
      return obligation(o.token, o.kind, 'met', `the promotion says what it is: ${status}`, { status });
    }
    const escalated = RELEASE_RE.test(status);
    return obligation(
      o.token,
      o.kind,
      'unmet',
      escalated
        ? `the promotion status is '${status}', which reads as a release. A release is not a repair, and it will not be filed beside one.`
        : `the promotion status is '${status}', not '${LOCAL_PROMOTION}'`,
      { status, escalated }
    );
  },
};

/**
 * Check one cycle against one bar.
 *
 * `comparable` requires every obligation `met`. `indeterminate` blocks it: the
 * honest report is "this guard could not decide", not "this cycle passes".
 */
function checkBar(bar, cycle) {
  if (!bar || typeof bar !== 'object') {
    return { rejected: true, reason: 'no-bar', detail: 'There is no bar to check against.' };
  }
  if (!cycle || typeof cycle !== 'object') {
    return { rejected: true, reason: 'no-cycle', detail: 'There is no cycle to check.' };
  }

  const parsed = bar.obligations && bar.problems ? bar : parseBar(bar.object);
  if (parsed.unverifiable) {
    return {
      comparable: false,
      reason: 'bar-unverifiable',
      problems: parsed.problems,
      unrecognized: parsed.unrecognized,
      obligations: [],
      tally: { met: 0, unmet: 0, indeterminate: 0 },
      detail: 'The bar could not be read whole, so nothing was checked. A partial read reporting a pass is the failure this refuses.',
    };
  }

  const obligations = parsed.obligations.map((o) => {
    const check = CHECKS[o.kind];
    if (!check) {
      // Unreachable while the vocabulary is closed, and kept anyway: the day
      // somebody adds a token to OBLIGATIONS without a check, that is an
      // indeterminate verdict rather than a silent pass.
      return obligation(o.token, o.kind, 'indeterminate', 'this reader has an obligation with no check written for it');
    }
    return check(o, cycle);
  });

  const tally = { met: 0, unmet: 0, indeterminate: 0 };
  for (const o of obligations) tally[VERDICTS.includes(o.verdict) ? o.verdict : 'indeterminate']++;

  const comparable = obligations.length > 0 && tally.met === obligations.length;
  const blockers = obligations.filter((o) => o.verdict !== 'met');

  return {
    comparable,
    reason: comparable ? 'bar-met' : blockers.length ? 'bar-unmet' : 'bar-empty',
    obligations,
    tally,
    unrecognized: parsed.unrecognized,
    problems: parsed.problems,
    detail: comparable
      ? `all ${obligations.length} obligation(s) met`
      : blockers.map((o) => `${o.token}: ${o.verdict} — ${o.detail}`).join('; '),
  };
}

// ---------------------------------------------------------------------------
// READING THE BAR OUT OF THE COMMONS
// ---------------------------------------------------------------------------

/**
 * What the commons holds about repair bars, split into what binds and what
 * merely informs.
 *
 * Read through `briefing()`, not `live()`, so the same portability rule that
 * gates every other read gates this one: a bar that has not earned the right to
 * travel is not handed to a reader who cannot check it, and the count of
 * withheld facts is reported rather than hidden.
 */
function readBar(federation, { slug, carrier = DEFAULT_CARRIER, viewer } = {}) {
  const me = String(slug == null ? '' : slug).trim();
  if (!me) return { rejected: true, reason: 'slug', detail: 'A repository slug is required: the bar binds the repository it is about.' };
  if (!isCarrier(carrier)) {
    return { rejected: true, reason: 'carrier', detail: `carrier must be one of the Federation's carriers; got '${carrier}'.` };
  }

  const brief = federation.briefing({ realm: SHARED_REALM, carrier, viewer: viewer || me });
  if (brief.rejected) return brief;

  const subject = `repo:${me}`;
  const bars = [];
  const scopeBySubject = new Map();
  for (const f of brief.facts) {
    if (f.equation.predicate === 'claim_scope' && !scopeBySubject.has(f.equation.subject)) {
      scopeBySubject.set(f.equation.subject, f.equation.object);
    }
    if (f.equation.predicate === 'risk_repair_bar') bars.push(f);
  }

  const shape = (f, binding) => {
    const slugOf = f.equation.subject.startsWith('repo:') ? f.equation.subject.slice('repo:'.length) : null;
    const authority = slugOf ? barAuthority(f, slugOf) : { trusted: false, reason: 'the bar\'s subject is not a repository', nodes: [], references: [] };
    return {
      binding,
      subject: f.equation.subject,
      object: f.equation.object,
      signature: f.signature,
      status: f.status,
      distinct: f.distinct,
      observed: f.observed,
      at: f.lastSeenAt || f.landedAt || null,
      reference: (f.witnesses && f.witnesses[0] && f.witnesses[0].reference) || null,
      witnessNodeIds: authority.nodes,
      authority,
      scope: scopeBySubject.get(f.equation.subject) || null,
      ...parseBar(f.equation.object),
    };
  };

  // WHICH BAR BINDS WHEN A REPOSITORY HAS RUN MORE THAN ONE CYCLE.
  //
  // `land()` does not supersede: it keys on the equation's signature, so a
  // second cycle whose gate count differs lands a SECOND `risk_repair_bar` fact
  // for the same subject rather than replacing the first. Taking whichever came
  // first would mean the bar never moves, and taking the strictest would ratchet
  // it upward forever and block ordinary work. So the bar that binds is the most
  // recently observed one, and the older ones are kept as `prior` and reported —
  // including when one of them was STRICTER, which is guidance worth having and
  // is not a reason to refuse anything.
  //
  // "Most recent" is `lastSeenAt`, which `landLesson` sets from the cycle's own
  // `completedAt`. That timestamp is inside the hash chain, so reordering the
  // bars means forging a ledger. Ties break on the signature, so the choice is
  // deterministic rather than dependent on Map iteration order.
  const newestFirst = (a, b) => {
    const ta = String(a.at || '');
    const tb = String(b.at || '');
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0;
  };

  const mine = bars.filter((f) => f.equation.subject === subject).map((f) => shape(f, true)).sort(newestFirst);
  const trusted = mine.filter((b) => b.authority.trusted);
  // Reported with the nodes that disqualify them. A bar somebody else wrote
  // about this repository is not deleted and not hidden — it is named.
  const disputed = mine.filter((b) => !b.authority.trusted);
  const binding = trusted.length ? trusted[0] : null;
  const prior = trusted.slice(1);

  // Everybody else's bar, newest per subject. Reported so the reader knows the
  // system has learned something; never able to produce a refusal here.
  const bySubject = new Map();
  for (const f of bars) {
    if (f.equation.subject === subject) continue;
    const shaped = shape(f, false);
    const held = bySubject.get(shaped.subject);
    if (!held || newestFirst(shaped, held) < 0) bySubject.set(shaped.subject, shaped);
  }
  const advisory = [...bySubject.values()].sort((a, b) => b.distinct - a.distinct || (a.subject < b.subject ? -1 : 1));

  // The strictest gate minimum this repository has ever recorded, if it is
  // stricter than the bar that currently binds. Reported, never enforced.
  const minOf = (b) => (b && b.obligations || []).filter((o) => o.kind === 'gates-passed').map((o) => o.min);
  const currentMin = binding ? Math.max(0, ...minOf(binding)) : 0;
  const higherPrior = prior.filter((p) => Math.max(0, ...minOf(p)) > currentMin);

  const notes = higherPrior.length
    ? [`this repository once recorded a stricter bar (${higherPrior.map((p) => p.object).join(' | ')}) than the one that binds now`]
    : [];
  if (disputed.length) {
    notes.push(
      `${disputed.length} bar(s) about repo:${me} were NOT authored by repo:${me} and bind nothing: ` +
      disputed.map((d) => `"${d.object}" (${d.authority.reason})`).join(' | ') +
      '. A repository sets its own bar; run `fed lessons` under its own node id to make one bind.'
    );
  }

  return {
    ok: true,
    slug: me,
    carrier,
    realm: SHARED_REALM,
    subject,
    binding,
    prior,
    disputed,
    advisory,
    withheld: brief.withheld,
    // Every fact this read was derived from, so a receipt can prove what it saw.
    provenance: {
      signatures: bars.map((f) => f.signature).sort(),
      facts: bars.length,
      head: federation.head || null,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// THE RECEIPT
// ---------------------------------------------------------------------------

/** The id is the digest of the body without the id. Same rule as a ledger event. */
function barId(body) {
  return sha256Bytes(Buffer.from(canonicalJson(body), 'utf8'));
}

/**
 * Issue a bar: read the commons, and freeze what was read into a receipt an
 * agent can be held to later.
 *
 * The receipt carries the pattern vocabulary the checks will use, because a
 * verdict that depends on a definition the reader cannot see is not a verdict
 * anybody can audit.
 */
function issueBar(federation, { slug, carrier = DEFAULT_CARRIER, at, viewer } = {}) {
  const read = readBar(federation, { slug, carrier, viewer });
  if (read.rejected) return read;

  const body = {
    schema: BAR_SCHEMA,
    slug: read.slug,
    carrier: read.carrier,
    realm: read.realm,
    issuedAt: at ? new Date(at).toISOString() : new Date().toISOString(),
    binding: read.binding,
    // Older bars for the same repository, frozen in. A receipt that only carried
    // the current bar could not later show that the repository once held itself
    // to more.
    prior: read.prior.map((a) => ({ subject: a.subject, object: a.object, signature: a.signature, at: a.at, binding: false })),
    disputed: read.disputed.map((d) => ({ subject: d.subject, object: d.object, signature: d.signature, reason: d.authority.reason, nodes: d.authority.nodes, binding: false })),
    notes: read.notes,
    advisory: read.advisory.map((a) => ({ subject: a.subject, object: a.object, signature: a.signature, scope: a.scope, unverifiable: a.unverifiable, binding: false })),
    withheld: read.withheld,
    vocabulary: { obligations: OBLIGATIONS.slice(), gates: GATES_RE.source, testPatterns: TEST_PATTERNS.map(String), localPromotion: LOCAL_PROMOTION },
    provenance: read.provenance,
  };

  return { ok: true, bar: { ...body, id: barId(body) } };
}

/** Write a receipt. Refuses to overwrite, because a bar that can be replaced in
 *  place is a bar that can be loosened in place. */
function writeBarReceipt(file, bar) {
  const target = String(file || '').trim();
  if (!target) return { rejected: true, reason: 'no-path', detail: 'A path is required to write a bar receipt.' };
  if (!bar || !bar.id) return { rejected: true, reason: 'no-bar', detail: 'There is no issued bar to write.' };
  let st = null;
  try {
    st = fs.lstatSync(target);
  } catch {
    st = null;
  }
  if (st) {
    return {
      rejected: true,
      reason: 'exists',
      detail: `${target} already exists. A bar receipt is issued once; overwriting it is how a bar gets loosened after the fact. Write to a new path.`,
    };
  }
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(bar, null, 2)}\n`, 'utf8');
  return { ok: true, path: path.resolve(target), id: bar.id };
}

/** Read a receipt back and recompute its id. An edited receipt is refused, by name. */
function readBarReceipt(file) {
  const target = String(file || '').trim();
  if (!target) return { rejected: true, reason: 'no-path', detail: 'A path to a bar receipt is required.' };
  const found = regularFile(target, 'the bar receipt');
  if (found.rejected) return found;
  let parsed;
  try {
    parsed = JSON.parse(found.bytes.toString('utf8'));
  } catch {
    return { rejected: true, reason: 'receipt-unparseable', detail: `${target} is not JSON.` };
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.id) {
    return { rejected: true, reason: 'not-a-bar', detail: `${target} carries no bar id.` };
  }
  if (parsed.schema !== BAR_SCHEMA) {
    return { rejected: true, reason: 'schema', detail: `${target} is ${parsed.schema}; this reader knows ${BAR_SCHEMA}.` };
  }
  const body = { ...parsed };
  delete body.id;
  let recomputed;
  try {
    recomputed = barId(body);
  } catch (e) {
    return { rejected: true, reason: 'not-lossless', detail: `The bar receipt cannot be canonicalised: ${e.message}` };
  }
  if (recomputed !== parsed.id) {
    return {
      rejected: true,
      reason: 'id-mismatch',
      detail:
        'The bar receipt does not hash to its own id. It was edited after issue — which is how a bar gets loosened ' +
        'between being shown to an agent and being used to hold one. Nothing was checked.',
    };
  }
  return { ok: true, bar: parsed };
}

// ---------------------------------------------------------------------------
// DRIFT
// ---------------------------------------------------------------------------

/**
 * Has the commons moved since the receipt was issued?
 *
 * A bar the repository has GAINED — a new obligation, or a gate minimum raised —
 * makes the cycle not-comparable: the agent was never shown it, and holding a
 * cycle to a bar nobody issued is the same dishonesty as holding it to no bar at
 * all. A bar that got LOOSER is reported and does not block, because the issued
 * receipt is the one the agent actually saw, and that is the honest thing to be
 * held to. The comparison is by obligation KIND, not by token text: `3-gates-
 * passed` -> `2-gates-passed` is a different string and an easier bar, and
 * calling that a tightening would block work for the commons getting kinder.
 */
function drift(issued, current) {
  const none = { moved: false, harder: false, added: [], removed: [], raised: [], lowered: [], notes: [] };
  if (!issued || !current) return none;

  const was = issued.binding;
  const now = current.binding;
  const notes = [];

  // A repository that had NO bar and now has one has gained every obligation in
  // it. The agent was shown nothing, so anything it is now held to is new.
  if (!was && now) {
    return {
      moved: true,
      harder: true,
      added: (now.tokens || []).slice(),
      removed: [],
      raised: [],
      lowered: [],
      notes: ['the commons now holds a bar for this repository and did not when the receipt was issued'],
    };
  }
  if (was && !now) {
    return { moved: true, harder: false, added: [], removed: (was.tokens || []).slice(), raised: [], lowered: [], notes: ['the commons no longer holds a bar for this repository'] };
  }
  if (!was && !now) return none;

  // KIND-AWARE, because "the token changed" is not "the bar got harder".
  // `3-gates-passed` becoming `2-gates-passed` is a DIFFERENT token and a
  // LOOSER bar; treating every textual difference as a tightening would block a
  // cycle for the commons getting easier, which is not a reason to refuse
  // anything and would teach people to ignore the drift report.
  const byKind = (tokens) => {
    const m = new Map();
    for (const t of tokens || []) {
      const g = GATES_RE.exec(t);
      const kind = g ? 'gates-passed' : t;
      m.set(kind, g ? { token: t, min: Number(g[1]) } : { token: t });
    }
    return m;
  };
  const a = byKind(was.tokens);
  const b = byKind(now.tokens);

  const added = [];
  const removed = [];
  const raised = [];
  const lowered = [];

  for (const [kind, cur] of b) {
    const prev = a.get(kind);
    if (!prev) {
      added.push(cur.token);
      continue;
    }
    if (kind === 'gates-passed' && cur.min !== prev.min) {
      if (cur.min > prev.min) raised.push(`${prev.token} -> ${cur.token}`);
      else lowered.push(`${prev.token} -> ${cur.token}`);
    }
  }
  for (const [kind, prev] of a) {
    if (!b.has(kind)) removed.push(prev.token);
  }

  const wasSigs = (issued.provenance && issued.provenance.signatures) || [];
  const nowSigs = (current.provenance && current.provenance.signatures) || [];
  const sigKey = (x) => x.slice().sort().join(',');
  if (sigKey(wasSigs) !== sigKey(nowSigs)) notes.push('the set of bar facts in the commons has changed');
  if (issued.provenance && current.provenance && issued.provenance.head !== current.provenance.head) {
    notes.push(`the store head moved (${String(issued.provenance.head).slice(0, 12)} -> ${String(current.provenance.head).slice(0, 12)})`);
  }

  const moved = added.length > 0 || removed.length > 0 || raised.length > 0 || lowered.length > 0 || notes.length > 0;
  return { moved, harder: added.length > 0 || raised.length > 0, added, removed, raised, lowered, notes };
}

// ---------------------------------------------------------------------------
// GUARD
// ---------------------------------------------------------------------------

/**
 * Hold one cycle against one repository's bar.
 *
 * @param {object} federation  an open Federation (read only — nothing is appended)
 * @param {object} opts
 * @param {string} opts.cycleDir   the completed cycle to check
 * @param {string} opts.slug       the repository being repaired
 * @param {string} [opts.barPath]  a receipt issued earlier; without one the bar is read now
 * @param {string} [opts.carrier]  defaults to the repair carrier
 * @returns {{comparable:boolean, wrote:false, ...} | {rejected:true, reason:string, detail:string}}
 */
function guardCycle(federation, { cycleDir, slug, barPath = null, carrier = DEFAULT_CARRIER, viewer } = {}) {
  const headBefore = federation.head || null;

  const read = readCycle(cycleDir);
  if (read.rejected) return read;
  const cycle = read.cycle;

  const me = String(slug == null ? '' : slug).trim();
  if (!me) return { rejected: true, reason: 'slug', detail: 'Name the repository with slug: a bar binds the repository it is about.' };

  // THE CYCLE MUST BE ABOUT THE REPOSITORY BEING GUARDED.
  //
  // This is the M2 hole from the Red Queen pass, in a new place. There the
  // registry checked that a node EXISTS but not that it was talking about
  // ITSELF, and `twin-labs` filed a bar for `repo:fleets`. Here the equivalent
  // mistake is guarding repo B's bar against repo A's cycle, which produces a
  // confident verdict comparing two unrelated repositories. The project comes
  // from the lesson ARTIFACT, which is content-addressed and inside the chain,
  // so it cannot be restated by an unhashed file.
  if (cycle.project && String(cycle.project) !== me) {
    return {
      rejected: true,
      reason: 'cycle-is-not-subject',
      detail:
        `This cycle's lesson artifact names project '${cycle.project}', and the bar being guarded belongs to 'repo:${me}'. ` +
        'A cycle is measured against the bar of the repository it repaired. Nothing was checked.',
      cycleProject: String(cycle.project),
      slug: me,
    };
  }

  const current = readBar(federation, { slug: me, carrier, viewer });
  if (current.rejected) return current;

  // Which bar holds this cycle: the one that was ISSUED, if there is one.
  let issued = null;
  let issuedNow = true;
  if (barPath) {
    const receipt = readBarReceipt(barPath);
    if (receipt.rejected) return receipt;
    if (receipt.bar.slug !== me) {
      return {
        rejected: true,
        reason: 'receipt-is-not-subject',
        detail: `That receipt was issued for 'repo:${receipt.bar.slug}' and cannot hold a cycle guarded as 'repo:${me}'.`,
      };
    }
    if (receipt.bar.carrier !== carrier) {
      return {
        rejected: true,
        reason: 'receipt-is-not-carrier',
        detail: `That receipt was issued on the '${receipt.bar.carrier}' carrier; this guard is reading '${carrier}'. The two populations do not pool.`,
      };
    }
    issued = receipt.bar;
    issuedNow = false;
  } else {
    const fresh = issueBar(federation, { slug: me, carrier, viewer });
    if (fresh.rejected) return fresh;
    issued = fresh.bar;
  }

  // DRIFT IS COMPUTED BEFORE THE "NO BAR" RETURN, not after it.
  //
  // A receipt issued when the repository had no bar records `binding: null`. If
  // the early return ran first, that stale receipt would sail every later cycle
  // past the bar the repository went on to earn — an agent could freeze its own
  // exemption by asking for the bar early. `drift` already calls a bar that
  // appeared after issue a tightening; this is where that verdict gets used.
  const moved = drift(issued, current);

  if (!issued.binding) {
    if (moved.harder) {
      return {
        comparable: false,
        blocking: true,
        wrote: false,
        reason: 'bar-drifted-harder',
        slug: me,
        carrier,
        subject: `repo:${me}`,
        bar: { id: issued.id, issuedAt: issued.issuedAt, issuedNow, object: null, signature: null, scope: null, reference: null },
        obligations: [],
        tally: { met: 0, unmet: 0, indeterminate: 0 },
        drift: moved,
        disputed: issued.disputed || [],
        advisory: issued.advisory,
        prior: issued.prior || [],
        notes: issued.notes || [],
        cycle: { runId: cycle.runId, head: cycle.headShort, project: cycle.project },
        detail:
          `This receipt was issued when repo:${me} had no bar, and the commons now holds one: ${current.binding.object}. ` +
          'A receipt issued early is not a standing exemption. Re-issue it and the cycle will be measured against what the repository has earned.',
        headUnchanged: (federation.head || null) === headBefore,
      };
    }
    // NOT A REJECTION, AND NOT A BLOCK. A repository that has never had a cycle
    // ingested has nothing to be compared against, which is the normal state of
    // a new repository rather than a verdict on this cycle. `comparable: false`
    // still says the truth — nothing was cleared — and `blocking: false` says
    // the guard reached no verdict against the work.
    return {
      comparable: false,
      blocking: false,
      wrote: false,
      reason: 'no-bar-recorded',
      detail:
        `The commons holds no risk_repair_bar for 'repo:${me}', so there is nothing to compare this cycle against. ` +
        'That is not a failure — it means no completed repair cycle has been ingested for this repository yet. ' +
        `Run \`fed lessons\` on one first.${issued.advisory.length ? ` ${issued.advisory.length} other repository(ies) have a bar; none of them binds this one.` : ''}`,
      advisory: issued.advisory,
      disputed: issued.disputed || [],
      prior: issued.prior || [],
      notes: issued.notes || [],
      carrier,
      cycle: { runId: cycle.runId, head: cycle.headShort, project: cycle.project },
      headUnchanged: (federation.head || null) === headBefore,
    };
  }

  const check = checkBar(issued.binding, cycle);
  if (check.rejected) return check;

  // The commons gained an obligation, or raised a minimum, that the agent was
  // never shown. Either way the cycle cannot be filed against the current bar.
  const comparable = check.comparable && !moved.harder;

  // Informational, and worth having: if this is the cycle that SET the bar, the
  // guard is comparing the bar against itself, which proves the checks work but
  // teaches nothing new. Saying so stops a self-check being read as corroboration.
  const recordedAs = findRecordedHead(federation, me, carrier);
  const selfCheck = Boolean(recordedAs && cycle.head && recordedAs.startsWith(cycle.head.slice(0, 12)));

  return {
    comparable,
    // `blocking` is "the guard reached a verdict against this cycle". It is true
    // for an unmet obligation, for a bar it could not read whole, and for a
    // commons that tightened after the receipt was issued. It is false when the
    // bar was met and when there was no bar at all -- and the two are told apart
    // by `reason`, never collapsed into one exit code.
    blocking: !comparable,
    wrote: false,
    reason: !comparable
      ? moved.harder
        ? 'bar-drifted-harder'
        : check.reason
      : selfCheck
        ? 'bar-met-self-check'
        : 'bar-met',
    slug: me,
    carrier,
    subject: `repo:${me}`,
    bar: {
      id: issued.id,
      issuedAt: issued.issuedAt,
      issuedNow,
      object: issued.binding.object,
      signature: issued.binding.signature,
      scope: issued.binding.scope,
      reference: issued.binding.reference,
    },
    obligations: check.obligations,
    tally: check.tally,
    unrecognized: check.unrecognized,
    problems: check.problems,
    drift: moved,
    selfCheck,
    recordedAs,
    // Advisory bars are reported with their scope attached, and marked as what
    // they are. Nothing above reads `advisory` to decide `comparable`.
    advisory: issued.advisory,
    disputed: issued.disputed || [],
    prior: issued.prior || [],
    notes: issued.notes || [],
    detail: comparable
      ? `comparable to ${issued.binding.object}${selfCheck ? ' — note this is the cycle that set the bar, so this is a self-check' : ''}`
      : moved.harder
        ? `the commons has tightened since this receipt was issued${moved.added.length ? ` — gained ${moved.added.join(', ')}` : ''}${moved.raised.length ? ` — raised ${moved.raised.join(', ')}` : ''}. The cycle was checked against the bar the agent was actually shown, and it cannot be filed beside a bar it was never shown.`
        : check.detail,
    cycle: {
      runId: cycle.runId,
      head: cycle.head,
      headShort: cycle.headShort,
      events: cycle.eventCount,
      project: cycle.project,
      gatesPassed: cycle.gatesPassed,
      changedPaths: cycle.changedPaths.length,
      promotedStatus: cycle.promotedStatus,
    },
    headUnchanged: (federation.head || null) === headBefore,
  };
}

/** The head the commons recorded for this repository's verified repair, if any. */
function findRecordedHead(federation, slug, carrier) {
  const subject = `repo:${slug}`;
  const facts = federation.live({ shelf: 'operational', realm: SHARED_REALM, carrier });
  const f = facts.find((x) => x.equation.subject === subject && x.equation.predicate === 'repair_verified');
  return f ? String(f.equation.object) : null;
}

module.exports = {
  BAR_SCHEMA,
  OBLIGATIONS,
  TEST_PATTERNS,
  VERDICTS,
  LOCAL_PROMOTION,
  GATES_RE,
  isTestPath,
  parseBar,
  checkBar,
  readBar,
  issueBar,
  writeBarReceipt,
  readBarReceipt,
  guardCycle,
  drift,
  barAuthority,
  barId,
  LEDGER_REF,
};
