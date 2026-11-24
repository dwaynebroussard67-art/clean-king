/**
 * passport.js — the in-repo passport.
 *
 * THE DISTINCTION THAT MATTERS
 *
 * The Federation does not connect to repositories. It connects to PASSPORTS,
 * and a passport lives INSIDE its repository. That indirection is the whole
 * design, and it buys four things a direct link cannot:
 *
 *   1. THE REPO IS A MOVING THING; THE PASSPORT IS A CONTRACT. A repository
 *      can be renamed, rewritten in another language, split, or reorged. The
 *      passport is the stable interface it implements. The Federation keys on
 *      the contract, so the ground can move underneath without the link
 *      breaking.
 *
 *   2. THE MEMORY TRAVELS WITH THE WORK. A passport in the repo means cloning
 *      the repo clones its memory. An agent that opens the repository finds
 *      `forge-passport/PASSPORT.md` and knows, in full context and with no
 *      prior conversation, what this codebase is and what to do in it. A
 *      memory that lives in a separate store is a memory the work cannot
 *      carry.
 *
 *   3. NO REPOSITORY CAN SEE ANOTHER REPOSITORY. Cross-repository learning is
 *      only possible through a hub. N repos speaking to each other is N^2
 *      connections that cannot happen; N passports speaking to one hub is N
 *      connections that can. The hub is not tidiness — it is the only thing
 *      that makes "improve the whole system using what any one repo learned"
 *      physically possible.
 *
 *   4. FAILURE IS ISOLATED. A missing or corrupt passport costs one
 *      repository its memory and nothing else. A Federation that is absent
 *      costs every repository its SHARED memory and leaves local work intact.
 *      Symbiotic, never co-dependent.
 *
 * WHAT IS IN HERE, AND WHAT IS NOT
 *
 *   profile.json    what this repository IS. State, not evidence. Not
 *                   witnessed — a stack is not a claim, it is a fact about a
 *                   directory. D15's separation again: things that describe
 *                   the work are not things the work remembered.
 *   memories.jsonl  what has been LEARNED here. Chained, witnessed,
 *                   equation-keyed. A claim needs five distinct witnesses;
 *                   one contradiction closes it.
 *   evidence.jsonl  the categorized EVIDENCE index. Chained. Every row points
 *                   at something re-derivable, so a claim can be traced to
 *                   what made it true.
 *   PASSPORT.md     generated. The agent-facing document: full context in one
 *                   read, so a fresh agent knows exactly what to do.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { sha256, SHARED_REALM } = require('../federation/realm.js');
const { canonicalEquation, equationSignature, renderEquation } = require('./equation.js');
const { classFromPredicate } = require('../forge/risks.js');

const SCHEMA = 'forgeflight.passport.v2';
const GENESIS = '0'.repeat(64);
const DIRNAME = 'forge-passport';

const nowIso = (d) => (d ? new Date(d) : new Date()).toISOString();
const newId = (p) => `${p}_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-4)}`;
const chainHash = (prev, rec) => sha256(`${prev}|${JSON.stringify(rec)}`);

/**
 * The evidence taxonomy. CLOSED, because an uncategorised fact is a fact
 * nobody can find again, and an open vocabulary is how an evidence index
 * rots into a junk drawer.
 */
const EVIDENCE_CATEGORIES = [
  'structure',   // what the repository is made of: files, languages, entry points
  'contract',    // published promises: manifests, schemas, types, APIs, routes
  'test',        // how the repository proves things: command, runner, results
  'history',     // what has happened: commits, cadence, contributors, branches
  'dependency',  // what it stands on: packages, versions, drift
  'risk',        // what could hurt it: secrets, dynamic exec, hardcoded identity, erasure
];

const WITNESS_KINDS = ['outcome', 'structural', 'contract', 'human'];
const PROMOTION_THRESHOLD = 5;

class RepoPassport {
  constructor(repoDir, { realm, slug, remote } = {}) {
    this.repoDir = path.resolve(repoDir);
    this.dir = path.join(this.repoDir, DIRNAME);
    this.realm = realm || null;
    this.slug = slug || path.basename(this.repoDir).toLowerCase();
    this.remote = remote || null;

    this.memories = new Map();
    this.evidence = [];
    this.head = GENESIS;
    this.evHead = GENESIS;
    this.corrupt = 0;
    this.profile = null;
  }

  get memoriesPath() { return path.join(this.dir, 'memories.jsonl'); }
  get evidencePath() { return path.join(this.dir, 'evidence.jsonl'); }
  get profilePath() { return path.join(this.dir, 'profile.json'); }
  get docPath() { return path.join(this.dir, 'PASSPORT.md'); }

  exists() { return fs.existsSync(this.dir); }

  /** Create the passport directory. Never overwrites a populated one. */
  init(profile = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.profilePath)) {
      this.profile = {
        schema: SCHEMA,
        realm: this.realm || `repo:${this.slug}`,
        slug: this.slug,
        remote: this.remote,
        name: profile.name || this.slug,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...profile,
      };
      this.writeProfile(this.profile);
    } else {
      this.profile = JSON.parse(fs.readFileSync(this.profilePath, 'utf8'));
    }
    return this;
  }

  load() {
    if (fs.existsSync(this.profilePath)) {
      try { this.profile = JSON.parse(fs.readFileSync(this.profilePath, 'utf8')); } catch { this.corrupt++; }
    }
    for (const [file, sink] of [[this.memoriesPath, 'memory'], [this.evidencePath, 'evidence']]) {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
          const rec = JSON.parse(s);
          this.apply(rec, sink);
        } catch { this.corrupt++; }
      }
    }
    return this;
  }

  apply(rec, sink) {
    const d = rec.data;
    if (sink === 'memory') {
      this.memories.set(d.id, d);
      this.head = rec.hash || this.head;
    } else {
      this.evidence.push(d);
      this.evHead = rec.hash || this.evHead;
    }
  }

  append(sink, data) {
    const target = sink === 'memory' ? this.memoriesPath : this.evidencePath;
    const prev = sink === 'memory' ? this.head : this.evHead;
    const rec = { op: sink, data };
    const hash = chainHash(prev, rec);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify({ ...rec, prev, hash })}\n`, 'utf8');
    this.apply({ ...rec, hash }, sink);
    return data;
  }

  /**
   * link.json — the neural link descriptor.
   *
   * The passport holds two things: enough to orient on its own, and the
   * address of the hub for everything else. This file is the second one. It
   * is deliberately small — an agent that has read it knows what it may ask
   * for and how.
   */
  writeLink({ hub, serves = ['context', 'ask', 'tool', 'skill', 'remember', 'evidence'] } = {}) {
    const link = {
      schema: 'forgeflight.link.v1',
      realm: this.realm,
      slug: this.slug,
      hub: hub || 'FORGE_FEDERATION_DIR',
      serves,
      request: {
        shape: '{ from, kind, name?, arg?, reason? }',
        note: 'Request, never command. The hub authorizes; this repository asks.',
      },
      offline: 'PASSPORT.md and this directory are readable with no hub. The hub only adds.',
    };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, 'link.json'), `${JSON.stringify(link, null, 2)}\n`, 'utf8');
    return link;
  }

  readLink() {
    const p = path.join(this.dir, 'link.json');
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }

  writeProfile(p) {
    p.updatedAt = nowIso();
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.profilePath, `${JSON.stringify(p, null, 2)}\n`, 'utf8');
    this.profile = p;
    return p;
  }

  // -------------------------------------------------------------- evidence

  /**
   * File an evidence row. Every row must point at something RE-DERIVABLE —
   * an evidence index whose rows cannot be re-checked is a list of opinions.
   *
   * @param {string} category  one of EVIDENCE_CATEGORIES
   * @param {string} subject   what it is about
   * @param {any}    detail    the finding
   * @param {object} witness   { kind, ref } — ref must be checkable
   */
  recordEvidence({ category, subject, detail, witness, at }) {
    if (!EVIDENCE_CATEGORIES.includes(category)) {
      return { rejected: true, reason: 'category', detail: `category must be one of ${EVIDENCE_CATEGORIES.join(', ')}` };
    }
    if (!witness || !WITNESS_KINDS.includes(witness.kind) || !String(witness.ref || '').trim()) {
      return { rejected: true, reason: 'witness', detail: 'Evidence needs a witness kind and a reference somebody can re-check.' };
    }
    const row = {
      id: newId('ev'),
      schema: SCHEMA,
      category,
      subject: String(subject).slice(0, 300),
      detail,
      witness: { kind: witness.kind, ref: String(witness.ref).slice(0, 400) },
      at: nowIso(at),
    };
    this.append('evidence', row);
    return { ok: true, evidence: row };
  }

  byCategory(category) {
    return this.evidence.filter((e) => !category || e.category === category);
  }

  /** The newest row per subject, per category — the live index. */
  liveEvidence(category) {
    const m = new Map();
    for (const e of this.byCategory(category)) m.set(e.subject, e);
    return [...m.values()];
  }

  // --------------------------------------------------------------- memory

  /**
   * Remember something. A memory is a CLAIM with a witness, not a note:
   * it has to earn `supported` the same way a Federation fact does.
   */
  remember({ proposition, equation, witness, reference, at }) {
    const wsig = sha256(`${witness}|${String(reference || '').trim()}`);
    const eq = equation ? canonicalEquation(equation) : null;
    const sig = eq ? equationSignature(eq, this.realm || SHARED_REALM) : sha256(String(proposition || '').toLowerCase().trim());

    const existing = [...this.memories.values()].find((m) => m.signature === sig);
    if (existing) {
      if (existing.status === 'closed') return { rejected: true, reason: 'closed', detail: 'That was closed by a contradiction and does not reopen.' };
      if (existing.witnesses.some((w) => w.sig === wsig)) return { ok: true, memory: existing, action: 'already-witnessed' };
      const witnesses = [...existing.witnesses, { sig: wsig, kind: witness, reference, at: nowIso(at) }];
      const memory = { ...existing, witnesses, distinct: witnesses.length, status: witnesses.length >= PROMOTION_THRESHOLD ? 'supported' : existing.status };
      this.append('memory', memory);
      return { ok: true, memory, action: 'witnessed' };
    }

    const memory = {
      id: newId('mem'),
      schema: SCHEMA,
      signature: sig,
      realm: this.realm,
      proposition: proposition || (eq ? renderEquation(eq) : null),
      equation: eq || null,
      form: eq ? 'equation' : 'prose',
      status: 'proposed',
      witnesses: [{ sig: wsig, kind: witness, reference, at: nowIso(at) }],
      distinct: 1,
      at: nowIso(at),
    };
    this.append('memory', memory);
    return { ok: true, memory, action: 'remembered' };
  }

  contradict({ proposition, equation, witness, reference, at }) {
    const eq = equation ? canonicalEquation(equation) : null;
    const target = eq ? eq.predicate : null;
    const prior = [...this.memories.values()].find(
      (m) => m.status !== 'closed' && (eq ? m.equation && m.equation.subject === eq.subject && m.equation.predicate === eq.predicate : false)
    );
    const landed = this.remember({ proposition, equation, witness, reference, at });
    if (landed.rejected) return landed;
    if (!prior || prior.signature === landed.memory.signature) return { ...landed, contradicted: null };

    const closed = { ...prior, status: 'closed', closedAt: nowIso(at), closedBy: landed.memory.id };
    this.append('memory', closed);
    void target;
    return { ...landed, contradicted: closed };
  }

  live() { return [...this.memories.values()].filter((m) => m.status !== 'closed'); }
  supported() { return this.live().filter((m) => m.status === 'supported'); }
  /** What this passport is ready to promote to the hub. */
  promotable() { return this.supported().filter((m) => m.form === 'equation'); }

  // ------------------------------------------------------------------ doc

  /**
   * PASSPORT.md — the agent-facing document.
   *
   * Everything an agent needs to start work, in one read, in the repository.
   * Not a summary: the profile says what this codebase IS, the evidence index
   * says what has been CHECKED about it, and the briefing from the hub says
   * what the rest of the system has learned that applies here.
   */
  render({ briefing } = {}) {
    const p = this.profile || {};
    const L = [];
    L.push(`# Passport — ${p.name || this.slug}`);
    L.push('');
    L.push(`**Realm:** \`${p.realm || this.realm || '(unlinked)'}\`  ·  **Slug:** \`${p.slug || this.slug}\``);
    if (p.remote) L.push(`**Remote:** ${p.remote}`);
    L.push(`**Updated:** ${p.updatedAt || nowIso()}`);
    L.push('');

    L.push('## What this repository is');
    L.push('');
    L.push('```json');
    L.push(JSON.stringify(
      { languages: p.languages, frameworks: p.frameworks, testCommand: p.testCommand, entryPoints: p.entryPoints, packageManager: p.packageManager, loc: p.loc },
      null, 2
    ));
    L.push('```');
    L.push('');

    if (p.conventions && Object.keys(p.conventions).length) {
      L.push('## Conventions');
      L.push('');
      for (const [k, v] of Object.entries(p.conventions)) L.push(`- **${k}:** ${v}`);
      L.push('');
    }

    L.push('## Evidence index');
    L.push('');
    for (const c of EVIDENCE_CATEGORIES) {
      const rows = this.liveEvidence(c);
      if (!rows.length) continue;
      L.push(`### ${c} (${rows.length})`);
      L.push('');
      for (const r of rows) {
        const d = typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail);
        L.push(`- **${r.subject}** — ${d}`);
        L.push(`  - witness: \`${r.witness.kind}\` \`${r.witness.ref}\``);
      }
      L.push('');
    }
    if (!this.evidence.length) L.push('_No evidence filed yet._');
    L.push('');

    L.push('## Memory');
    L.push('');
    const live = this.live();
    if (!live.length) L.push('_Nothing remembered yet._');
    for (const m of live) {
      L.push(`- **${m.proposition}** — ${m.status}, ${m.distinct} witness${m.distinct === 1 ? '' : 'es'}`);
    }
    L.push('');

    // The neural link section goes FIRST among the hub-facing parts, because
    // it is the one that tells an agent what to do next.
    const link = this.readLink();
    if (link) {
      L.push('## Neural link');
      L.push('');
      L.push(`This passport is a **link**, not a store. It holds your bearings and the`);
      L.push(`address of the hub. The Federation holds the commons, the tools, and the`);
      L.push(`skills — ask it.`);
      L.push('');
      L.push('```json');
      L.push(JSON.stringify(link.request, null, 2));
      L.push('```');
      L.push('');
      L.push(`**Realm:** \`${link.realm}\` · **Hub:** \`${link.hub}\` · **Serves:** ${link.serves.join(', ')}`);
      L.push('');
      L.push('You **request**; the hub authorizes. Three answers come back:');
      L.push('');
      L.push('- `granted` — here it is');
      L.push('- `deferred` — queued for a named human. Asking twice does not help.');
      L.push('- `refused` — not a thing the hub does, with the reason named');
      L.push('');
      L.push('_Context, `ask`, `read`/`transform` tools and structural `evidence` are_');
      L.push('_granted on request. `git.commit`, `git.push` and self-reported `outcome`_');
      L.push('_memories are always deferred — the human is step four._');
      L.push('');
    }

    if (briefing) {
      L.push('## From the hub');
      L.push('');
      L.push('_The Federation is the hub every passport is linked to. This section is_');
      L.push('_what the rest of the system knows that is worth your attention here._');
      L.push('');

      L.push('### About this repository');
      L.push('');
      if (!briefing.own || !briefing.own.length) L.push('_The hub holds nothing on this repository yet._');
      for (const f of briefing.own || []) {
        L.push(`- **${f.equation.predicate}** — ${f.equation.object}  _(${f.status}, ${f.distinct} witness${f.distinct === 1 ? '' : 'es'})_`);
      }
      L.push('');

      if (briefing.elsewhere && briefing.elsewhere.length) {
        L.push('### Found elsewhere in the system — not yet here');
        L.push('');
        L.push('_Every one of these was found in another repository. No repository can see_');
        L.push('_another, so this list only exists because the hub does._');
        L.push('');
        for (const e of briefing.elsewhere) {
          L.push(`- **${e.predicate}** → ${e.object}`);
          L.push(`  - seen in ${e.seenIn.length} other(s): ${e.seenIn.slice(0, 4).join(', ')}${e.seenIn.length > 4 ? `, +${e.seenIn.length - 4} more` : ''}`);
          // A method with no boundary on it reads as a rule. The scope line is
          // attached by the hub from the same subject's `claim_scope` fact.
          if (Array.isArray(e.scope) && e.scope.length) {
            L.push(`  - scope: ${e.scope.join('; ')} — what this does NOT claim`);
          }
        }
        L.push('');

        // A CAPABILITY AN AGENT HAS TO REMEMBER IS A CAPABILITY IT WILL SKIP.
        //
        // `fed probe` has existed since the Down seam, and nothing in this
        // passport ever mentioned it. The agent reading this file is told that a
        // class was found in another repository and is given no way to check
        // whether it is here -- so the honest behaviour, which is to go and
        // check, depends on the agent thinking of a command nobody told it
        // about. That is the difference between a capability and a habit.
        //
        // Every risk predicate above resolves to a probe class, so one command
        // covers all of them. It is stated once rather than repeated under each
        // lead, because six identical command lines is noise an agent skims.
        const checkable = [...new Set(
          (briefing.elsewhere || []).map((e) => classFromPredicate(e.predicate)).filter(Boolean)
        )];
        if (checkable.length) {
          L.push('_These are leads from other repositories, not findings in this one. Check_');
          L.push('_this repository for every one of them before assuming any is absent:_');
          L.push('');
          L.push('```');
          L.push(`npx fed probe --slug ${this.slug} --dir .`);
          L.push('```');
          L.push('');
          L.push(`_It reports ${checkable.length === 1 ? 'this class' : `these ${checkable.length} classes`}: ${checkable.join(', ')}._`);
          L.push('_A class that comes back clean is evidence of absence only as far as the_');
          L.push('_pattern goes — see `docs/PROBE.md` for the measured false-positive rate._');
          L.push('');
        }
      }

      if (briefing.withheld) L.push(`_${briefing.withheld} fact(s) withheld as not yet portable to this realm._`);
      L.push('');
    }

    if (briefing && briefing.crossRepo && briefing.crossRepo.length) {
      L.push('## Where we differ — the cross-repository read');
      L.push('');
      L.push('_Computed by the hub. No repository can produce this about itself,_');
      L.push('_because no repository can see the others._');
      L.push('');
      for (const d of briefing.crossRepo) {
        L.push(`**On \`${d.predicate}\`** — ${d.answers.length} different answers across the system:`);
        L.push('');
        for (const a of d.answers) L.push(`- ${a.count} repo(s) → ${a.value}`);
        L.push('');
      }
    }

    L.push('---');
    L.push('');
    L.push('Generated by Forge Federation. `memories.jsonl` and `evidence.jsonl` are');
    L.push('hash-chained and append-only; this document is derived from them and may be');
    L.push('regenerated at any time. The chain is the truth; this file is the reading of it.');
    L.push('');
    return L.join('\n');
  }

  writeDoc(opts) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.docPath, this.render(opts), 'utf8');
    return this.docPath;
  }
}

module.exports = { RepoPassport, EVIDENCE_CATEGORIES, SCHEMA, DIRNAME, GENESIS, chainHash };
