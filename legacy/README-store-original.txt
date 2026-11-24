/**
 * store.js — the Federation. The carrier, not the cockpit.
 *
 * THE TWO SHELVES, AND WHY THEY CANNOT SHARE A CLOCK
 *
 * The Federation holds two kinds of thing, and giving them one lifecycle
 * breaks both:
 *
 *   WORLD claims — `capital(france) = paris`. True independently of who is
 *     asking. Five distinct witnesses promote it; one contradiction closes
 *     it. It does not expire, because the world did not change just because
 *     a year passed.
 *
 *   OPERATIONAL facts — `composer(claude.ai) = [data-testid=prompt-input]`,
 *     `rate_limit(host) = 0`, `median_latency(gemini) = 4200`. These are
 *     scoped to a TARGET THAT MUTATES. When a site ships a redesign the old
 *     fact is not wrong — it EXPIRED. That is normal and expected, and
 *     firing "one contradiction closes it forever" on every redesign would
 *     empty the shelf every quarter.
 *
 * Same entry rule for both. Same triangle. Different clocks.
 *
 * THE ENTRY RULE — ESTABLISHED, NOT AGREED
 *
 * The oracle's power was never that it is right. It is that it does not
 * listen. If facts enter because enough readers said so, the oracle starts
 * listening, and a thousand persuadable readers is exactly what an
 * unlistening oracle exists to be immune to. So agreement is not an input.
 * Four ways in, and only four:
 *
 *   outcome     an action succeeded — a form submitted, a reply grew, a
 *               write landed. An outcome, never an opinion.
 *   structural  re-derivable from the artifact by anyone, on demand.
 *   contract    a published contract — a schema, a rate limit, an allowed
 *               value set.
 *   human       a ruling, with the human named.
 *
 * REPLICATION IS NOT AGREEMENT
 *
 * `outcome` is the one witness kind a node can fabricate: "I acted and it
 * worked" is not re-derivable by anybody else. So a single node's outcome
 * fact stays LOCAL. It travels to the Federation only when independently
 * replicated by distinct nodes, or when paired with a structural witness
 * anyone can check. Five nodes independently MEASURING the same outcome is
 * not five parties agreeing on an opinion — it is five measurements. That
 * distinction is the whole reason this survives at fleet scale.
 *
 * NOTHING IS EVER DELETED
 *
 * Stale is not the same as wrong, and neither is handled by erasure. A stale
 * fact is superseded — the old record stays, marked, with a pointer to what
 * replaced it. The history is the entire reason the store is trustworthy;
 * destroying it on update defeats the purpose.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { equationSignature, canonicalEquation, renderEquation } = require('../passport/equation.js');

// A per-record label, never checked on read: lines stamped with the OmniBox-era
// id ('omnibox.collective.v1') replay exactly as before.
const SCHEMA = 'forgeflight.federation.v1';
const GENESIS = '0'.repeat(64);

/** The two shelves. A fact belongs to exactly one. */
const SHELVES = ['world', 'operational'];

/** The only four ways in. Agreement is deliberately absent and must stay so. */
const WITNESS_KINDS = ['outcome', 'structural', 'contract', 'human'];

/** Witness kinds a third party can re-derive without trusting the reporter. */
const SELF_VERIFYING = new Set(['structural', 'contract']);

/** How many DISTINCT nodes must independently measure an outcome before it
 *  may leave a cockpit and enter the Federation. Replication, not agreement. */
const OUTCOME_REPLICATION = 3;

/** Distinct witnesses that promote a world claim to `established`. */
const PROMOTION_THRESHOLD = 5;

const nowIso = (d) => (d ? new Date(d) : new Date()).toISOString();
const newId = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

function chainHash(prev, rec) {
  return sha256(`${prev}|${JSON.stringify(rec)}`);
}

/**
 * The store's folder and file were `collective/collective.jsonl` before the
 * Forge Federation rename. On first load, an old log with no new log beside it
 * is renamed into place — the chain is byte-identical, so nothing about it
 * changes. Never overwrites, never throws: if both exist the new one wins and
 * the old one is left where it was. See D26.
 */
function adoptLegacyLog(dir, logPath) {
  try {
    if (fs.existsSync(logPath)) return false;
    const candidates = [
      path.join(dir, 'collective.jsonl'),
      path.join(path.dirname(dir), 'collective', 'collective.jsonl'),
    ];
    for (const old of candidates) {
      if (fs.existsSync(old)) {
        fs.renameSync(old, logPath);
        return true;
      }
    }
  } catch {
    /* a failed adoption leaves both files as they were */
  }
  return false;
}

/** What makes a confirmation DISTINCT. Five reports from one node are one
 *  witness — the defence against a node promoting a fact by repeating it. */
function witnessSignature(kind, nodeId, reference) {
  return sha256(`${kind}|${nodeId}|${String(reference || '').trim()}`);
}

class FederationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'FederationError';
    this.field = field || null;
  }
}

/**
 * The Federation store.
 *
 * Append-only, hash-chained, equation-keyed. It exposes NO update and NO
 * delete — the absence is the design, not an omission.
 */
class Federation {
  constructor(dir) {
    this.dir = dir;
    this.logPath = path.join(dir, 'federation.jsonl');
    this.facts = new Map(); // signature -> fact
    this.events = [];
    this.head = GENESIS;
    this.corrupt = 0;
    this.chain = { head: GENESIS, chained: 0, breaks: [] };
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    adoptLegacyLog(this.dir, this.logPath);
    if (!fs.existsSync(this.logPath)) return this;
    for (const line of fs.readFileSync(this.logPath, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        this.apply(JSON.parse(s));
      } catch {
        this.corrupt++;
      }
    }
    this.chain = this.verify();
    this.head = this.chain.head;
    return this;
  }

  apply(rec) {
    if (rec.op === 'fact') this.facts.set(rec.data.signature, rec.data);
    else if (rec.op === 'event') this.events.push(rec.data);
    else this.corrupt++;
  }

  /** The only write path. Every line chains to the last. */
  append(op, data) {
    const rec = { op, data };
    const prev = this.head;
    const hash = chainHash(prev, rec);
    const line = { ...rec, prev, hash };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.logPath, `${JSON.stringify(line)}\n`, 'utf8');
    this.head = hash;
    this.apply(rec);
    return data;
  }

  /** Recompute the chain over the file as it stands. Never throws — a broken
   *  chain is REPORTED, never a crash, so tampering is visible rather than
   *  fatal. */
  verify() {
    const out = { head: GENESIS, chained: 0, breaks: [] };
    if (!fs.existsSync(this.logPath)) return out;
    let expected = GENESIS;
    let idx = 0;
    const lines = fs.readFileSync(this.logPath, 'utf8').split('\n');
    for (const raw of lines) {
      const s = raw.trim();
      if (!s) continue;
      idx++;
      let line;
      try {
        line = JSON.parse(s);
      } catch {
        // A torn final line (power loss mid-write) is the last line only.
        if (idx === lines.filter((l) => l.trim()).length) out.torn = true;
        else out.breaks.push({ line: idx, kind: 'unparseable' });
        continue;
      }
      const body = { op: line.op, data: line.data };
      const want = chainHash(line.prev, body);
      if (line.prev !== expected) out.breaks.push({ line: idx, kind: 'prev-mismatch' });
      if (line.hash !== want) out.breaks.push({ line: idx, kind: 'hash-mismatch' });
      expected = line.hash;
      out.chained++;
    }
    out.head = expected;
    return out;
  }

  // ---------------------------------------------------------------- intake

  /**
   * Land a fact on the carrier.
   *
   * @param {object} spec
   * @param {'world'|'operational'} spec.shelf
   * @param {object} spec.equation  subject/predicate/object[/units/time]
   * @param {'outcome'|'structural'|'contract'|'human'} spec.witness
   * @param {string} spec.nodeId    which harness observed it
   * @param {string} spec.reference evidence pointer
   * @param {string} [spec.target]  operational facts only: what it is scoped to
   * @param {string} [spec.actor]   human rulings only: who ruled
   */
  land(spec) {
    const v = this.validate(spec);
    if (v.rejected) return v;

    const sig = equationSignature(v.equation, v.shelf);
    const wsig = witnessSignature(v.witness, v.nodeId, v.reference);
    const existing = this.facts.get(sig);
    const at = nowIso(spec.at);

    if (!existing) {
      const fact = {
        id: newId('f'),
        schema: SCHEMA,
        signature: sig,
        shelf: v.shelf,
        equation: v.equation,
        rendered: renderEquation(v.equation),
        target: v.target,
        status: 'provisional',
        witnesses: [{ sig: wsig, kind: v.witness, nodeId: v.nodeId, reference: v.reference, at }],
        distinct: 1,
        landedAt: at,
        lastSeenAt: at,
        supersededBy: null,
        closedAt: null,
        closedBy: null,
      };
      this.append('fact', fact);
      return { ok: true, fact, action: 'landed' };
    }

    if (existing.closedAt) {
      return { rejected: true, reason: 'closed', detail: 'That claim was closed by a contradiction and does not reopen on a repeat.' };
    }

    // A repeat from the same witness is one witness. This is the defence
    // against a node promoting a fact by saying it five times.
    if (existing.witnesses.some((w) => w.sig === wsig)) {
      const bumped = { ...existing, lastSeenAt: at };
      this.append('fact', bumped);
      return { ok: true, fact: bumped, action: 'already-witnessed' };
    }

    const witnesses = [...existing.witnesses, { sig: wsig, kind: v.witness, nodeId: v.nodeId, reference: v.reference, at }];
    const distinct = witnesses.length;
    const next = {
      ...existing,
      witnesses,
      distinct,
      lastSeenAt: at,
      status: existing.shelf === 'world' && distinct >= PROMOTION_THRESHOLD ? 'established' : existing.status,
    };
    this.append('fact', next);
    if (next.status === 'established' && existing.status !== 'established') {
      this.append('event', { id: newId('ev'), kind: 'established', signature: sig, distinct, at });
    }
    return { ok: true, fact: next, action: 'witnessed' };
  }

  validate(spec) {
    if (!spec || typeof spec !== 'object') return { rejected: true, reason: 'shape' };
    if (!SHELVES.includes(spec.shelf)) {
      return { rejected: true, reason: 'shelf', detail: `shelf must be one of ${SHELVES.join(', ')}` };
    }
    if (!WITNESS_KINDS.includes(spec.witness)) {
      return {
        rejected: true,
        reason: 'witness',
        detail:
          `witness must be one of ${WITNESS_KINDS.join(', ')}. ` +
          'Agreement between nodes is not a witness kind and never will be.',
      };
    }
    const equation = canonicalEquation(spec.equation);
    if (!equation) {
      return {
        rejected: true,
        reason: 'not-an-equation',
        detail: 'The Federation stores equations. Prose that does not reduce cleanly stays in the cockpit.',
      };
    }
    const nodeId = String(spec.nodeId || '').trim();
    if (!nodeId) return { rejected: true, reason: 'nodeId', detail: 'Every witness names the node that observed it.' };
    const reference = String(spec.reference || '').trim();
    if (!reference) return { rejected: true, reason: 'reference', detail: 'A witness with no evidence pointer has no value.' };
    if (spec.witness === 'human' && !String(spec.actor || '').trim()) {
      return { rejected: true, reason: 'actor', detail: 'A human ruling names the human.' };
    }
    if (spec.shelf === 'operational' && !String(spec.target || '').trim()) {
      return {
        rejected: true,
        reason: 'target',
        detail: 'An operational fact is scoped to a target that mutates. Name the target.',
      };
    }
    return { shelf: spec.shelf, equation, witness: spec.witness, nodeId, reference, target: spec.target || null };
  }

  /**
   * A contradiction. Same subject and predicate, different object.
   *
   * On the WORLD shelf this CLOSES the claim — one contradiction, permanently,
   * and it does not decrement a tally.
   *
   * On the OPERATIONAL shelf it SUPERSEDES: the target mutated, which is
   * normal. The old fact stays, marked, pointing at what replaced it.
   * Nothing is ever deleted on either shelf.
   */
  contradict(spec) {
    const v = this.validate(spec);
    if (v.rejected) return v;
    const priorSig = this.findByPredicate(v.equation.subject, v.equation.predicate, v.shelf);
    const at = nowIso(spec.at);

    const landed = this.land(spec);
    if (landed.rejected) return landed;

    if (!priorSig || priorSig.signature === landed.fact.signature) {
      return { ...landed, contradicted: null };
    }

    if (v.shelf === 'world') {
      const closed = { ...priorSig, status: 'closed', closedAt: at, closedBy: landed.fact.id };
      this.append('fact', closed);
      this.append('event', {
        id: newId('ev'),
        kind: 'contradiction',
        signature: priorSig.signature,
        by: landed.fact.id,
        note: `${priorSig.rendered} contradicted by ${landed.fact.rendered}`,
        at,
      });
      return { ...landed, contradicted: closed };
    }

    const superseded = { ...priorSig, status: 'superseded', supersededBy: landed.fact.id, closedAt: at };
    this.append('fact', superseded);
    this.append('event', {
      id: newId('ev'),
      kind: 'superseded',
      signature: priorSig.signature,
      by: landed.fact.id,
      note: `${priorSig.rendered} superseded by ${landed.fact.rendered} — the target moved`,
      at,
    });
    return { ...landed, contradicted: superseded };
  }

  // ------------------------------------------------------------------ reads

  /** The live fact for subject+predicate on a shelf, if any. This is what
   *  makes contradiction COMPUTABLE: same left side, different right side. */
  findByPredicate(subject, predicate, shelf) {
    const s = String(subject || '').toLowerCase();
    const p = String(predicate || '').toLowerCase();
    for (const f of this.facts.values()) {
      if (f.closedAt) continue;
      if (f.shelf !== shelf) continue;
      if (f.equation.subject === s && f.equation.predicate === p) return f;
    }
    return null;
  }

  get(signature) {
    return this.facts.get(signature) || null;
  }

  live({ shelf } = {}) {
    return [...this.facts.values()].filter((f) => !f.closedAt && (!shelf || f.shelf === shelf));
  }

  /** Every fact, including closed and superseded. The carrier audit needs them. */
  all() {
    return [...this.facts.values()];
  }

  /** Facts whose target has not been re-observed inside `days`. The curator's
   *  staleness queue — it never deletes these, it asks for a recheck. */
  stale({ days = 30, now } = {}) {
    const cutoff = new Date(now || Date.now()).getTime() - days * 86400000;
    return this.live({ shelf: 'operational' }).filter((f) => new Date(f.lastSeenAt).getTime() < cutoff);
  }

  stats() {
    const live = this.live();
    const by = {};
    for (const f of live) {
      by[f.shelf] = by[f.shelf] || { total: 0, established: 0, provisional: 0 };
      by[f.shelf].total++;
      by[f.shelf][f.status === 'established' ? 'established' : 'provisional']++;
    }
    return {
      schema: SCHEMA,
      facts: this.facts.size,
      live: live.length,
      byShelf: by,
      events: this.events.length,
      chain: this.chain,
      corrupt: this.corrupt,
      logPath: this.logPath,
    };
  }

  static defaultDir(app) {
    return path.join(app.getPath('userData'), 'federation');
  }
}

module.exports = {
  Federation,
  FederationError,
  SCHEMA,
  SHELVES,
  WITNESS_KINDS,
  SELF_VERIFYING,
  OUTCOME_REPLICATION,
  PROMOTION_THRESHOLD,
  witnessSignature,
  chainHash,
  GENESIS,
};



/**
 * store.js — the Federation. The carrier, not the cockpit.
 *
 * THE TWO SHELVES, AND WHY THEY CANNOT SHARE A CLOCK
 *
 * The Federation holds two kinds of thing, and giving them one lifecycle
 * breaks both:
 *
 *   WORLD claims — `capital(france) = paris`. True independently of who is
 *     asking. Five distinct witnesses promote it; one contradiction closes
 *     it. It does not expire, because the world did not change just because
 *     a year passed.
 *
 *   OPERATIONAL facts — `composer(claude.ai) = [data-testid=prompt-input]`,
 *     `rate_limit(host) = 0`, `median_latency(gemini) = 4200`. These are
 *     scoped to a TARGET THAT MUTATES. When a site ships a redesign the old
 *     fact is not wrong — it EXPIRED. That is normal and expected, and
 *     firing "one contradiction closes it forever" on every redesign would
 *     empty the shelf every quarter.
 *
 * Same entry rule for both. Same triangle. Different clocks.
 *
 * THE ENTRY RULE — ESTABLISHED, NOT AGREED
 *
 * The oracle's power was never that it is right. It is that it does not
 * listen. If facts enter because enough readers said so, the oracle starts
 * listening, and a thousand persuadable readers is exactly what an
 * unlistening oracle exists to be immune to. So agreement is not an input.
 * Four ways in, and only four:
 *
 *   outcome     an action succeeded — a form submitted, a reply grew, a
 *               write landed. An outcome, never an opinion.
 *   structural  re-derivable from the artifact by anyone, on demand.
 *   contract    a published contract — a schema, a rate limit, an allowed
 *               value set.
 *   human       a ruling, with the human named.
 *
 * REPLICATION IS NOT AGREEMENT
 *
 * `outcome` is the one witness kind a node can fabricate: "I acted and it
 * worked" is not re-derivable by anybody else. So a single node's outcome
 * fact stays LOCAL. It travels to the Federation only when independently
 * replicated by distinct nodes, or when paired with a structural witness
 * anyone can check. Five nodes independently MEASURING the same outcome is
 * not five parties agreeing on an opinion — it is five measurements. That
 * distinction is the whole reason this survives at fleet scale.
 *
 * NOTHING IS EVER DELETED
 *
 * Stale is not the same as wrong, and neither is handled by erasure. A stale
 * fact is superseded — the old record stays, marked, with a pointer to what
 * replaced it. The history is the entire reason the store is trustworthy;
 * destroying it on update defeats the purpose.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { equationSignature, canonicalEquation, renderEquation } = require('../passport/equation.js');

// A per-record label, never checked on read: lines stamped with the OmniBox-era
// id ('omnibox.collective.v1') replay exactly as before.
const SCHEMA = 'forgeflight.federation.v1';
const GENESIS = '0'.repeat(64);

/** The two shelves. A fact belongs to exactly one. */
const SHELVES = ['world', 'operational'];

/** The only four ways in. Agreement is deliberately absent and must stay so. */
const WITNESS_KINDS = ['outcome', 'structural', 'contract', 'human'];

/** Witness kinds a third party can re-derive without trusting the reporter. */
const SELF_VERIFYING = new Set(['structural', 'contract']);

/** How many DISTINCT nodes must independently measure an outcome before it
 *  may leave a cockpit and enter the Federation. Replication, not agreement. */
const OUTCOME_REPLICATION = 3;

/** Distinct witnesses that promote a world claim to `established`. */
const PROMOTION_THRESHOLD = 5;

const nowIso = (d) => (d ? new Date(d) : new Date()).toISOString();
const newId = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

function chainHash(prev, rec) {
  return sha256(`${prev}|${JSON.stringify(rec)}`);
}

/**
 * The store's folder and file were `collective/collective.jsonl` before the
 * Forge Federation rename. On first load, an old log with no new log beside it
 * is renamed into place — the chain is byte-identical, so nothing about it
 * changes. Never overwrites, never throws: if both exist the new one wins and
 * the old one is left where it was. See D26.
 */
function adoptLegacyLog(dir, logPath) {
  try {
    if (fs.existsSync(logPath)) return false;
    const candidates = [
      path.join(dir, 'collective.jsonl'),
      path.join(path.dirname(dir), 'collective', 'collective.jsonl'),
    ];
    for (const old of candidates) {
      if (fs.existsSync(old)) {
        fs.renameSync(old, logPath);
        return true;
      }
    }
  } catch {
    /* a failed adoption leaves both files as they were */
  }
  return false;
}

/** What makes a confirmation DISTINCT. Five reports from one node are one
 *  witness — the defence against a node promoting a fact by repeating it. */
function witnessSignature(kind, nodeId, reference) {
  return sha256(`${kind}|${nodeId}|${String(reference || '').trim()}`);
}

class FederationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'FederationError';
    this.field = field || null;
  }
}

/**
 * The Federation store.
 *
 * Append-only, hash-chained, equation-keyed. It exposes NO update and NO
 * delete — the absence is the design, not an omission.
 */
class Federation {
  constructor(dir) {
    this.dir = dir;
    this.logPath = path.join(dir, 'federation.jsonl');
    this.facts = new Map(); // signature -> fact
    this.events = [];
    this.head = GENESIS;
    this.corrupt = 0;
    this.chain = { head: GENESIS, chained: 0, breaks: [] };
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    adoptLegacyLog(this.dir, this.logPath);
    if (!fs.existsSync(this.logPath)) return this;
    for (const line of fs.readFileSync(this.logPath, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        this.apply(JSON.parse(s));
      } catch {
        this.corrupt++;
      }
    }
    this.chain = this.verify();
    this.head = this.chain.head;
    return this;
  }

  apply(rec) {
    if (rec.op === 'fact') this.facts.set(rec.data.signature, rec.data);
    else if (rec.op === 'event') this.events.push(rec.data);
    else this.corrupt++;
  }

  /** The only write path. Every line chains to the last. */
  append(op, data) {
    const rec = { op, data };
    const prev = this.head;
    const hash = chainHash(prev, rec);
    const line = { ...rec, prev, hash };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.logPath, `${JSON.stringify(line)}\n`, 'utf8');
    this.head = hash;
    this.apply(rec);
    return data;
  }

  /** Recompute the chain over the file as it stands. Never throws — a broken
   *  chain is REPORTED, never a crash, so tampering is visible rather than
   *  fatal. */
  verify() {
    const out = { head: GENESIS, chained: 0, breaks: [] };
    if (!fs.existsSync(this.logPath)) return out;
    let expected = GENESIS;
    let idx = 0;
    const lines = fs.readFileSync(this.logPath, 'utf8').split('\n');
    for (const raw of lines) {
      const s = raw.trim();
      if (!s) continue;
      idx++;
      let line;
      try {
        line = JSON.parse(s);
      } catch {
        // A torn final line (power loss mid-write) is the last line only.
        if (idx === lines.filter((l) => l.trim()).length) out.torn = true;
        else out.breaks.push({ line: idx, kind: 'unparseable' });
        continue;
      }
      const body = { op: line.op, data: line.data };
      const want = chainHash(line.prev, body);
      if (line.prev !== expected) out.breaks.push({ line: idx, kind: 'prev-mismatch' });
      if (line.hash !== want) out.breaks.push({ line: idx, kind: 'hash-mismatch' });
      expected = line.hash;
      out.chained++;
    }
    out.head = expected;
    return out;
  }

  // ---------------------------------------------------------------- intake

  /**
   * Land a fact on the carrier.
   *
   * @param {object} spec
   * @param {'world'|'operational'} spec.shelf
   * @param {object} spec.equation  subject/predicate/object[/units/time]
   * @param {'outcome'|'structural'|'contract'|'human'} spec.witness
   * @param {string} spec.nodeId    which harness observed it
   * @param {string} spec.reference evidence pointer
   * @param {string} [spec.target]  operational facts only: what it is scoped to
   * @param {string} [spec.actor]   human rulings only: who ruled
   */
  land(spec) {
    const v = this.validate(spec);
    if (v.rejected) return v;

    const sig = equationSignature(v.equation, v.shelf);
    const wsig = witnessSignature(v.witness, v.nodeId, v.reference);
    const existing = this.facts.get(sig);
    const at = nowIso(spec.at);

    if (!existing) {
      const fact = {
        id: newId('f'),
        schema: SCHEMA,
        signature: sig,
        shelf: v.shelf,
        equation: v.equation,
        rendered: renderEquation(v.equation),
        target: v.target,
        status: 'provisional',
        witnesses: [{ sig: wsig, kind: v.witness, nodeId: v.nodeId, reference: v.reference, at }],
        distinct: 1,
        landedAt: at,
        lastSeenAt: at,
        supersededBy: null,
        closedAt: null,
        closedBy: null,
      };
      this.append('fact', fact);
      return { ok: true, fact, action: 'landed' };
    }

    if (existing.closedAt) {
      return { rejected: true, reason: 'closed', detail: 'That claim was closed by a contradiction and does not reopen on a repeat.' };
    }

    // A repeat from the same witness is one witness. This is the defence
    // against a node promoting a fact by saying it five times.
    if (existing.witnesses.some((w) => w.sig === wsig)) {
      const bumped = { ...existing, lastSeenAt: at };
      this.append('fact', bumped);
      return { ok: true, fact: bumped, action: 'already-witnessed' };
    }

    const witnesses = [...existing.witnesses, { sig: wsig, kind: v.witness, nodeId: v.nodeId, reference: v.reference, at }];
    const distinct = witnesses.length;
    const next = {
      ...existing,
      witnesses,
      distinct,
      lastSeenAt: at,
      status: existing.shelf === 'world' && distinct >= PROMOTION_THRESHOLD ? 'established' : existing.status,
    };
    this.append('fact', next);
    if (next.status === 'established' && existing.status !== 'established') {
      this.append('event', { id: newId('ev'), kind: 'established', signature: sig, distinct, at });
    }
    return { ok: true, fact: next, action: 'witnessed' };
  }

  validate(spec) {
    if (!spec || typeof spec !== 'object') return { rejected: true, reason: 'shape' };
    if (!SHELVES.includes(spec.shelf)) {
      return { rejected: true, reason: 'shelf', detail: `shelf must be one of ${SHELVES.join(', ')}` };
    }
    if (!WITNESS_KINDS.includes(spec.witness)) {
      return {
        rejected: true,
        reason: 'witness',
        detail:
          `witness must be one of ${WITNESS_KINDS.join(', ')}. ` +
          'Agreement between nodes is not a witness kind and never will be.',
      };
    }
    const equation = canonicalEquation(spec.equation);
    if (!equation) {
      return {
        rejected: true,
        reason: 'not-an-equation',
        detail: 'The Federation stores equations. Prose that does not reduce cleanly stays in the cockpit.',
      };
    }
    const nodeId = String(spec.nodeId || '').trim();
    if (!nodeId) return { rejected: true, reason: 'nodeId', detail: 'Every witness names the node that observed it.' };
    const reference = String(spec.reference || '').trim();
    if (!reference) return { rejected: true, reason: 'reference', detail: 'A witness with no evidence pointer has no value.' };
    if (spec.witness === 'human' && !String(spec.actor || '').trim()) {
      return { rejected: true, reason: 'actor', detail: 'A human ruling names the human.' };
    }
    if (spec.shelf === 'operational' && !String(spec.target || '').trim()) {
      return {
        rejected: true,
        reason: 'target',
        detail: 'An operational fact is scoped to a target that mutates. Name the target.',
      };
    }
    return { shelf: spec.shelf, equation, witness: spec.witness, nodeId, reference, target: spec.target || null };
  }

  /**
   * A contradiction. Same subject and predicate, different object.
   *
   * On the WORLD shelf this CLOSES the claim — one contradiction, permanently,
   * and it does not decrement a tally.
   *
   * On the OPERATIONAL shelf it SUPERSEDES: the target mutated, which is
   * normal. The old fact stays, marked, pointing at what replaced it.
   * Nothing is ever deleted on either shelf.
   */
  contradict(spec) {
    const v = this.validate(spec);
    if (v.rejected) return v;
    const priorSig = this.findByPredicate(v.equation.subject, v.equation.predicate, v.shelf);
    const at = nowIso(spec.at);

    const landed = this.land(spec);
    if (landed.rejected) return landed;

    if (!priorSig || priorSig.signature === landed.fact.signature) {
      return { ...landed, contradicted: null };
    }

    if (v.shelf === 'world') {
      const closed = { ...priorSig, status: 'closed', closedAt: at, closedBy: landed.fact.id };
      this.append('fact', closed);
      this.append('event', {
        id: newId('ev'),
        kind: 'contradiction',
        signature: priorSig.signature,
        by: landed.fact.id,
        note: `${priorSig.rendered} contradicted by ${landed.fact.rendered}`,
        at,
      });
      return { ...landed, contradicted: closed };
    }

    const superseded = { ...priorSig, status: 'superseded', supersededBy: landed.fact.id, closedAt: at };
    this.append('fact', superseded);
    this.append('event', {
      id: newId('ev'),
      kind: 'superseded',
      signature: priorSig.signature,
      by: landed.fact.id,
      note: `${priorSig.rendered} superseded by ${landed.fact.rendered} — the target moved`,
      at,
    });
    return { ...landed, contradicted: superseded };
  }

  // ------------------------------------------------------------------ reads

  /** The live fact for subject+predicate on a shelf, if any. This is what
   *  makes contradiction COMPUTABLE: same left side, different right side. */
  findByPredicate(subject, predicate, shelf) {
    const s = String(subject || '').toLowerCase();
    const p = String(predicate || '').toLowerCase();
    for (const f of this.facts.values()) {
      if (f.closedAt) continue;
      if (f.shelf !== shelf) continue;
      if (f.equation.subject === s && f.equation.predicate === p) return f;
    }
    return null;
  }

  get(signature) {
    return this.facts.get(signature) || null;
  }

  live({ shelf } = {}) {
    return [...this.facts.values()].filter((f) => !f.closedAt && (!shelf || f.shelf === shelf));
  }

  /** Every fact, including closed and superseded. The carrier audit needs them. */
  all() {
    return [...this.facts.values()];
  }

  /** Facts whose target has not been re-observed inside `days`. The curator's
   *  staleness queue — it never deletes these, it asks for a recheck. */
  stale({ days = 30, now } = {}) {
    const cutoff = new Date(now || Date.now()).getTime() - days * 86400000;
    return this.live({ shelf: 'operational' }).filter((f) => new Date(f.lastSeenAt).getTime() < cutoff);
  }

  stats() {
    const live = this.live();
    const by = {};
    for (const f of live) {
      by[f.shelf] = by[f.shelf] || { total: 0, established: 0, provisional: 0 };
      by[f.shelf].total++;
      by[f.shelf][f.status === 'established' ? 'established' : 'provisional']++;
    }
    return {
      schema: SCHEMA,
      facts: this.facts.size,
      live: live.length,
      byShelf: by,
      events: this.events.length,
      chain: this.chain,
      corrupt: this.corrupt,
      logPath: this.logPath,
    };
  }

  static defaultDir(app) {
    return path.join(app.getPath('userData'), 'federation');
  }
}

module.exports = {
  Federation,
  FederationError,
  SCHEMA,
  SHELVES,
  WITNESS_KINDS,
  SELF_VERIFYING,
  OUTCOME_REPLICATION,
  PROMOTION_THRESHOLD,
  witnessSignature,
  chainHash,
  GENESIS,
};


