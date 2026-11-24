/**
 * hub.js — the symbiotic link between a passport and the Federation.
 *
 * THE TOPOLOGY
 *
 *   The Federation does not connect to repositories. It connects to
 *   passports, one per repository, and each passport lives inside its own
 *   repository. The Federation is the HUB.
 *
 *        ┌──────────────────────────────┐
 *        │   FORGE FEDERATION  (hub)    │
 *        │   federation.jsonl  commons  │
 *        └──────────────────────────────┘
 *            ▲    ▲    ▲         │    │    │
 *          up│  up│  up│      down│ down│ down│
 *            │    │    │         ▼    ▼    ▼
 *        ┌───┴─┐┌─┴──┐┌┴───┐  ┌──┴──┐┌─┴───┐
 *        │ TWLD││strip││Fleet│  │ TWLD││strip│
 *        │ pass││ pass││ pass│  │  .md││  .md│
 *        └─────┘└─────┘└─────┘  └─────┘└─────┘
 *
 * WHY UP IS NOT AUTOMATIC FOR EVERYTHING
 *
 * A repository's own memory is LOCAL TRUTH: true here, witnessed by work done
 * here. The commons is SHARED TRUTH: asserted everywhere. Promoting local
 * truth to shared truth is the one move that can corrupt the whole system, so
 * it follows the same rule as the Federation's own transport (D24):
 *
 *   self-verifying (structural / contract)  -> promotes itself. Anyone holding
 *        the artifact can re-derive it, so trusting the reporter costs nothing.
 *   human-ruled                             -> promotes itself. A named person
 *        ruled; the name is in the record.
 *   outcome                                 -> STOPS at the hub as a proposal.
 *        "I acted and it worked" is self-reported. It waits for a human, or
 *        for OUTCOME_REPLICATION other repositories to measure the same thing.
 *
 * That last rule is the reason the hub can accept contributions from
 * repositories it does not trust. A hostile or merely wrong repository cannot
 * put anything into the commons that somebody else cannot check.
 *
 * WHY DOWN IS THE POINT
 *
 * A repository cannot see another repository. Only the hub can. So the only
 * way a pattern learned in one place reaches another is DOWN: the hub
 * computes what applies to a realm and writes it into that realm's
 * PASSPORT.md, where the next agent to open the repository reads it as
 * ordinary context. That is what "collectively improve the whole system"
 * means mechanically — not a dashboard, a file in the repo.
 */

'use strict';

const { SHARED_REALM, REPO_PREFIX } = require('./realm.js');
const { OUTCOME_REPLICATION } = require('./store.js');
const { RISK_CLASSES, riskPredicate } = require('../forge/risks.js');

/** Look a risk class up by the id `ingest.js` files it under. */
const riskById = (id) => RISK_CLASSES.find((c) => c.id === id) || null;

/**
 * UP. Promote what this passport has earned the right to contribute.
 *
 * Returns what promoted, what is waiting, and what was refused — never
 * silently drops anything, because a repository that cannot tell whether its
 * memory reached the hub will stop trusting the hub.
 */
function up(passport, federation, { at } = {}) {
  const promoted = [];
  const waiting = [];
  const refused = [];

  for (const mem of passport.promotable()) {
    const kinds = new Set(mem.witnesses.map((w) => w.kind));
    const selfVerifying = kinds.has('structural') || kinds.has('contract');
    const humanRuled = kinds.has('human');
    const replicated = mem.distinct >= OUTCOME_REPLICATION;

    if (!selfVerifying && !humanRuled && !replicated) {
      waiting.push({ id: mem.id, proposition: mem.proposition, distinct: mem.distinct, needs: OUTCOME_REPLICATION });
      continue;
    }

    // Each witness lands separately: the Federation counts DISTINCT nodes, and
    // collapsing them into one would be the same vote-minting the registry exists
    // to prevent.
    for (const w of mem.witnesses) {
      const res = federation.land({
        shelf: 'world',
        realm: SHARED_REALM,
        equation: mem.equation,
        witness: w.kind,
        nodeId: passport.slug,
        reference: w.reference,
        actor: w.kind === 'human' ? w.reference : undefined,
        at: at || w.at,
      });
      if (res.rejected) refused.push({ id: mem.id, reason: res.reason, detail: res.detail });
      else if (res.action === 'landed') promoted.push({ id: mem.id, proposition: mem.proposition, signature: res.fact.signature });
    }
  }

  return { promoted, waiting, refused };
}

/**
 * UP-EVIDENCE. Promote a repository's evidence index into the commons.
 *
 * THIS IS THE MOVE THAT MAKES THE HUB WORTH HAVING.
 *
 * Evidence is `structural` by construction — every row points at something
 * anybody holding the repository can re-derive: a manifest hash, a line
 * number, a commit id. So it clears the portability bar on its own and needs
 * no human in the loop. That means a repository contributes to the commons
 * simply by being looked at.
 *
 * The facts land on the OPERATIONAL shelf, scoped to the repository as their
 * target, because a repository is exactly the thing that mutates. Next
 * ingest, when the evidence changes, the old fact is not contradicted — it is
 * SUPERSEDED, which is the correct clock for a fact about a moving target.
 *
 * The subject carries the repository (`repo:<slug>`) and the realm is the
 * commons, so the hub can answer the question no single repository can ask:
 * which of us differ, and on what. That is `divergences()`, and it is the
 * first thing the hub knows that no member could know alone.
 */
function upEvidence(passport, federation, { at } = {}) {
  const promoted = [];
  const refused = [];

  for (const row of passport.liveEvidence()) {
    // A RISK ROW PUTS ITS CLASS IN THE PREDICATE.
    //
    // Every other category describes one thing about this repository, so the
    // category IS the question: `test(repo:x) = npm test`. A risk scan answers
    // six different questions and files one row per class, with the class as the
    // row's subject. Landing all of them under the bare predicate `risk` meant
    // the commons knew that a repository had risks and not which — and since the
    // objects differed by count and prose, the same class in two repositories
    // never collapsed into one `elsewhere` entry with `seenIn: [both]`. The
    // grouping that makes the hub worth having did not happen.
    //
    // So: the class travels as the predicate, and the object is the class's own
    // `why` — verbatim from the closed vocabulary, identical everywhere, so two
    // repositories with the same class produce the same equation and the hub can
    // see that they agree. The site count and the example stay in the passport
    // that found them, because those are specifics. Same split as the lesson
    // seam: the METHOD travels, the DEFECT does not.
    const riskClass = row.category === 'risk' ? riskById(row.subject) : null;
    const object = String(
      riskClass
        ? riskClass.why
        : typeof row.detail === 'string'
          ? row.detail
          : (row.detail.summary || JSON.stringify(row.detail))
    )
      .replace(/\s+/g, ' ')
      .slice(0, 120);
    if (!object) continue;

    const res = federation.land({
      shelf: 'operational',
      realm: SHARED_REALM,
      equation: {
        subject: `repo:${passport.slug}`,
        predicate: riskClass ? riskPredicate(riskClass.id) : row.category,
        object,
      },
      witness: row.witness.kind,
      nodeId: passport.slug,
      reference: row.witness.ref,
      target: `repo:${passport.slug}`,
      at: at || row.at,
    });

    const predicate = riskClass ? riskPredicate(riskClass.id) : row.category;
    if (res.rejected) refused.push({ subject: row.subject, category: row.category, predicate, reason: res.reason });
    else promoted.push({ category: row.category, predicate, object, action: res.action });
  }

  return { promoted, refused };
}

/**
 * DOWN. What the hub holds that applies to this realm, written into the
 * repository as ordinary context.
 *
 * A viewer is named so the read is honest about who is asking: a fact that
 * has not earned the right to travel is withheld from a realm that did not
 * witness it, and the count of withheld facts is reported rather than hidden.
 */
function down(federation, passport, { realm, viewer } = {}) {
  const target = realm || passport.realm || SHARED_REALM;
  const briefing = federation.briefing({ realm: target, viewer: viewer || passport.slug });
  const me = `repo:${passport.slug}`;

  // A hub that hands every member everything is not a hub, it is a firehose.
  // "Read this and know what to do" requires SELECTION. Three slices:
  //
  //   own        what the hub holds about THIS repository
  //   elsewhere  what other repositories have that this one does not — the
  //              collective's actual value: a class of defect found in one
  //              place, named here before it happens here
  //   crossRepo  where members disagree, which no member could compute alone
  const all = briefing.facts;
  briefing.own = all.filter((f) => f.equation.subject === me);

  const mine = new Set(briefing.own.map((f) => `${f.equation.predicate}=${f.equation.object}`));
  const elsewhere = new Map();
  for (const f of all) {
    if (f.equation.subject === me) continue;
    const key = `${f.equation.predicate}=${f.equation.object}`;
    if (mine.has(key)) continue;
    const e = elsewhere.get(key) || { predicate: f.equation.predicate, object: f.equation.object, seenIn: new Set() };
    e.seenIn.add(f.equation.subject);
    elsewhere.set(key, e);
  }

  // Only the actionable slices are worth a reader's attention: a risk class
  // present somewhere else, and a verification story that differs.
  // A clean scan is not a warning, and "no manifest" teaches nothing. Only
  // surface what is PRESENT somewhere and ABSENT here — that is the only
  // asymmetry worth a reader's attention.
  const NOISE = /no risk patterns matched|none found/i;
  const isUseful = (e) =>
    !NOISE.test(e.object) && (e.predicate.startsWith('risk') || e.predicate === 'test' || e.predicate === 'contract');
  briefing.elsewhere = [...elsewhere.values()]
    .filter(isUseful)
    .map((e) => ({ predicate: e.predicate, object: e.object, seenIn: [...e.seenIn] }))
    .sort((a, b) => b.seenIn.length - a.seenIn.length)
    .slice(0, 12);

  // THE BOUNDARY TRAVELS WITH THE CLAIM.
  //
  // `elsewhere` is the section an agent actually reads, so a method surfaced
  // there without its scope line would arrive looking like a rule — which is
  // precisely what a repair lesson refuses to be. A repair cycle lands its own
  // `claim_scope` fact beside its `risk_*` facts (see src/forge/lessons.js);
  // this picks it up by subject and attaches it, so the two cannot be separated
  // by the read that matters most.
  const scopeBySubject = new Map();
  for (const f of all) {
    if (f.equation.predicate !== 'claim_scope') continue;
    if (!scopeBySubject.has(f.equation.subject)) scopeBySubject.set(f.equation.subject, f.equation.object);
  }
  briefing.elsewhere = briefing.elsewhere.map((e) => {
    const scopes = [...new Set(e.seenIn.map((subj) => scopeBySubject.get(subj)).filter(Boolean))];
    return scopes.length ? { ...e, scope: scopes } : e;
  });

  // The store's own divergences() groups by subject+predicate, which is right
  // for contradiction INSIDE a realm. Across realms the subject already
  // identifies the repo, so the useful grouping is by PREDICATE alone: on the
  // question of `test`, how many members answer what. That is the read no
  // single member could produce, because it requires seeing the others.
  const groups = new Map();
  for (const f of all) {
    const g = groups.get(f.equation.predicate) || new Map();
    g.set(f.equation.object, (g.get(f.equation.object) || 0) + 1);
    groups.set(f.equation.predicate, g);
  }
  briefing.crossRepo = [...groups.entries()]
    .filter(([, vals]) => vals.size > 1)
    .map(([predicate, vals]) => ({
      predicate,
      answers: [...vals.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => (b.answers[0] ? b.answers[0].count : 0) - (a.answers[0] ? a.answers[0].count : 0));

  const docPath = passport.writeDoc({ briefing });
  return { ...briefing, docPath };
}

/**
 * Link a repository's passport to the hub: record where the passport lives so
 * the hub can find it again, and make sure the realm resolves.
 */
function link(registry, passport, { localPath, at } = {}) {
  const node = registry.get(passport.remote || passport.slug);
  if (!node) {
    return { rejected: true, reason: 'unregistered-repo', detail: `Register '${passport.remote || passport.slug}' before linking its passport.` };
  }
  const res = registry.locate(node.slug, localPath || passport.repoDir, at);
  passport.realm = node.realm;
  passport.slug = node.slug;
  if (passport.profile) passport.writeProfile({ ...passport.profile, realm: node.realm, slug: node.slug, remote: node.remote });
  return { ok: true, node: res.node, realm: node.realm };
}

module.exports = { up, down, link, upEvidence, SHARED_REALM, REPO_PREFIX };
