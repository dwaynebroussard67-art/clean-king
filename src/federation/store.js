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
 *   THIS USED TO BE TRUE ONLY IN THE COMMENT. `OUTCOME_REPLICATION` and
 *   `SELF_VERIFYING` were exported and never read; the rule lived in prose
 *   and a node promoted its own outcome facts like any other. Harmless at
 *   one cockpit. Fatal at twenty-two repositories, where every repo is a
 *   node and "I acted and it worked" is the most common thing in the fleet.
 *   It is now enforced in `portable()` and applied in `briefing()`.
 *
 * NOTHING IS EVER DELETED
 *
 * Stale is not the same as wrong, and neither is handled by erasure. A stale
 * fact is superseded — the old record stays, marked, with a pointer to what
 * replaced it. The history is the entire reason the store is trustworthy;
 * destroying it on update defeats the purpose.
 *
 * THE THIRD AXIS — REALM
 *
 * The Federation began as the shared carrier under one browser. It is now
 * the collective intelligence across every repository a person owns, and
 * that needs one more dimension in the key, because a fact is not just
 * "what" and "how long" — it is "WHERE".
 *
 *   BEFORE   composer(claude.ai) = [data-testid=prompt-input]   world/operational
 *   AFTER    the same equation, in realm `shared` or in `repo:twld`
 *
 * Two repositories disagreeing is NOT a contradiction. It is a DIVERGENCE,
 * and it is information: `test_command` is `npm test` in one repo and
 * `pytest` in another, and both are right. Firing "one contradiction closes
 * it forever" across a repository boundary would empty the shelf the first
 * week. So contradiction is computed INSIDE a realm, and divergence is
 * reported ACROSS realms for a human to look at — never auto-resolved.
 *
 * Every fact that predates realms is adopted into `shared` on load, so
 * nothing a person built is lost in the reshape. That is the D26 standard,
 * applied to a key instead of a filename.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { equationSignature, canonicalEquation, renderEquation } = require('../passport/equation.js');
const {
  CARRIERS,
  DEFAULT_CARRIER,
  isCarrier,
  normalizeCarrier,
  legacyCarrier,
  isOrigin,
  origin,
} = require('./carrier.js');
const {
  SHARED_REALM,
  REPO_PREFIX,
  isRealm,
  realmSlug,
  federationSignature,
  sha256,
} = require('./realm.js');

// A per-record label, never checked on read: lines stamped with the OmniBox-era
// id ('omnibox.collective.v1') replay exactly as before. v2 records carry a
// `realm`; v3 records also carry a `carrier`. A record missing either is
// adopted — into the commons, and into the repair carrier — on load.
const SCHEMA = 'forgeflight.federation.v3';
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

function chainHash(prev, rec) {
  return sha256(`${prev}|${JSON.stringify(rec)}`);
}

/**
 * AN EXCLUSIVE WRITE LOCK, AND WHY THE STORE NEEDS ONE.
 *
 * `appendFileSync` on POSIX with O_APPEND will not interleave the BYTES of one
 * write, but that was never the hazard. The hazard is the HEAD: two processes
 * each hold `this.head` from when they loaded, so both compute `prev` from the
 * same stale value and both append. Every line is intact and the chain is
 * broken — measured at 23 breaks over 120 concurrent appends. Nothing is lost,
 * which is what makes it easy to miss: the file looks complete and reads as
 * tampered.
 *
 * The bridge made this reachable in a new way, because `transfer()` appends a
 * `transfer-out` event to a store it does not own — a store another process may
 * well have open.
 *
 * So: acquire an exclusive lock, RE-READ the true head from disk, then append.
 * Re-reading is the part that matters; a lock around a stale head only makes the
 * corruption orderly.
 *
 * A lock that cannot be acquired is a THROWN error, not a silent fallback. A
 * write that cannot be serialised must not be mis-chained instead, and quietly
 * appending anyway is the one option that produces a log you cannot trust and
 * cannot explain.
 *
 * A STALE lock is reported, never broken. Deleting somebody else's lock to make
 * progress is how two writers end up running at once, which is the exact failure
 * this exists to prevent.
 */
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 4;

function sleepSync(ms) {
  // No dependencies, no timers: block the thread deliberately. The store's
  // whole API is synchronous and a lock wait has to be too.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(dir) {
  const lockPath = path.join(dir, '.lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n`);
      } finally {
        fs.closeSync(fd);
      }
      return lockPath;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let holder = null;
      let ageMs = null;
      try {
        const st = fs.statSync(lockPath);
        ageMs = Date.now() - st.mtimeMs;
        holder = fs.readFileSync(lockPath, 'utf8').trim();
      } catch { /* the holder released between our checks; retry at once */ }
      if (ageMs !== null && ageMs > LOCK_STALE_MS) {
        throw new FederationError(
          `The write lock at ${lockPath} is ${(ageMs / 1000).toFixed(0)}s old and was taken by pid ${holder || '?'}. ` +
          'It is NOT being broken, because deleting another writer\'s lock is how two writers end up running at once. ' +
          'If that process is genuinely gone, remove the lock by hand and re-run.',
          'lock-stale'
        );
      }
      if (Date.now() > deadline) {
        throw new FederationError(
          `Could not take the write lock at ${lockPath} within ${LOCK_TIMEOUT_MS}ms (held by pid ${holder || '?'}). ` +
          'Nothing was appended: a write that cannot be serialised would be mis-chained instead.',
          'lock-timeout'
        );
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch { /* already gone; a lock we no longer hold is not our problem */ }
}

/**
 * The head as the FILE holds it, not as this process remembers it.
 *
 * A tail that does not end in a newline is a torn write, and appending after it
 * would glue the new record onto the fragment and destroy both. That is refused
 * rather than repaired: the store never overwrites, so the only honest move is
 * to stop and let an operator look.
 */
function headFromDisk(logPath) {
  if (!fs.existsSync(logPath)) return GENESIS;
  const text = fs.readFileSync(logPath, 'utf8');
  if (text && !text.endsWith('\n')) {
    throw new FederationError(
      `${logPath} ends mid-line: a previous write was torn. Nothing was appended, because appending now would glue a ` +
      'new record onto the fragment and destroy both. The torn tail needs an operator, not a repair.',
      'torn-tail'
    );
  }
  const lines = text.split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed.hash === 'string') return parsed.hash;
    } catch { /* an unparseable tail is verify()'s finding, not the writer's */ }
  }
  return GENESIS;
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

/**
 * D24, made executable. A fact TRAVELS when somebody who did not witness it
 * can still check it. Three ways to clear that bar and no fourth:
 *
 *   self-verifying  it carries a `structural` or `contract` witness — anyone
 *                   holding the artifact can re-derive it without trusting
 *                   the reporter.
 *   human-ruled     a named person ruled. Weakest, and the only kind that
 *                   carries a person's name into the record, but it is a
 *                   ruling and it travels.
 *   replicated      OUTCOME_REPLICATION distinct nodes measured the same
 *                   outcome. Five measurements, not five opinions.
 *
 * Failing all three, an outcome fact is NODE-LOCAL: it is served only to the
 * nodes that witnessed it. It is still on the carrier — nothing is deleted —
 * it simply does not get handed to a cockpit that cannot check it.
 */
function portable(fact) {
  const witnesses = (fact && fact.witnesses) || [];
  const kinds = new Set(witnesses.map((w) => w.kind));
  const selfVerifying = [...kinds].some((k) => SELF_VERIFYING.has(k));
  const humanRuled = kinds.has('human');
  // Replication means N distinct nodes independently MEASURED it. A witness
  // that arrived from another carrier was measured somewhere else, so it does
  // not count here — a re-derivable provenance or a named ruling still does,
  // because those are checkable regardless of where they came from.
  const observed = witnesses.filter((w) => !w.origin);
  const replicated = observed.length >= OUTCOME_REPLICATION;

  if (selfVerifying) return { portable: true, reason: 'self-verifying', distinct: witnesses.length };
  if (humanRuled) return { portable: true, reason: 'human-ruled', distinct: witnesses.length };
  if (replicated) return { portable: true, reason: 'replicated', distinct: witnesses.length };
  return { portable: false, reason: 'single-node-outcome', distinct: witnesses.length };
}

/** May THIS node be handed this fact? A node-local fact goes to its own
 *  witnesses and to nobody else. */
function servable(fact, nodeId) {
  const p = portable(fact);
  if (p.portable) return { servable: true, ...p };
  const mine = (fact.witnesses || []).some((w) => w.nodeId === nodeId);
  return { servable: mine, reason: mine ? 'own-witness' : 'not-portable', distinct: p.distinct };
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
 * Append-only, hash-chained, equation-keyed, realm-scoped. It exposes NO
 * update and NO delete — the absence is the design, not an omission.
 */
class Federation {
  /**
   * @param {string} dir
   * @param {object} [opts]
   * @param {import('./nodes.js').NodeRegistry} [opts.nodes]  when supplied,
   *   a witness from an unregistered node is REFUSED. Omitted, the store
   *   behaves exactly as it always did, so nothing already deployed breaks.
   */
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.logPath = path.join(dir, 'federation.jsonl');
    this.nodes = opts.nodes || null;
    this.facts = new Map(); // signature -> fact
    this.events = [];
    this.head = GENESIS;
    this.corrupt = 0;
    this.chain = { head: GENESIS, chained: 0, breaks: [] };
    this.migrated = 0; // pre-axis records re-keyed on load
    this.carrierMigrated = 0; // of those, how many needed a carrier adopted
    this.torn = false; // a torn final line: power loss, not tampering
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    adoptLegacyLog(this.dir, this.logPath);
    if (!fs.existsSync(this.logPath)) return this;
    const lines = fs
      .readFileSync(this.logPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    lines.forEach((s, i) => {
      try {
        this.apply(JSON.parse(s));
      } catch {
        // A torn final line is the power going out mid-write, not somebody
        // editing the record. `corrupt` is reserved for the second thing,
        // because "the disk was full" and "this log was tampered with" are
        // different findings and a curator should not have to guess which.
        if (i === lines.length - 1) this.torn = true;
        else this.corrupt++;
      }
    });
    this.chain = this.verify();
    this.head = this.chain.head;
    return this;
  }

  /**
   * Replay one record.
   *
   * THE RE-KEY. Old lines carry their own `signature` and were hashed with
   * it inside them, so the chain does not care what we do with the key. That
   * freedom is what lets a fact written before an axis existed be adopted
   * into it and KEEP its identity: we recompute the signature from the
   * equation plus every axis, and a fact landed years ago MERGES with a new
   * one about the same thing instead of sitting beside it as a duplicate.
   *
   * Two axes are adopted here, independently, because they went in at
   * different times and a record can be missing one and not the other:
   *
   *   realm    absent -> `shared`, the commons      (pre-v2 records)
   *   carrier  absent -> `repair`, this population  (pre-v3 records)
   *
   * The carrier default is not a convenience. This repository IS the repair
   * federation, so its history is repair history; adopting an existing chain
   * into the browser carrier would misfile every fact ever landed here.
   *
   * A new record's recomputed signature is identical to the one it was
   * written with, so this is a no-op on the normal path.
   */
  apply(rec) {
    if (rec.op === 'fact') {
      const f = rec.data;
      if (f) {
        let adopted = false;
        if (!isRealm(f.realm)) {
          f.realm = SHARED_REALM;
          adopted = true;
        }
        if (!isCarrier(f.carrier)) {
          f.carrier = legacyCarrier();
          adopted = true;
          this.carrierMigrated++;
        }
        // The two counters went in with the carriers, so a pre-v3 record has
        // neither. Backfill them from the witnesses rather than leaving them
        // undefined: every fact in a briefing renders `observed/distinct`, and
        // "undefined/1 observed" is a hole in the read, not a cosmetic one.
        // A legacy witness has no `origin` field, so all of them were observed.
        if (typeof f.observed !== 'number' || typeof f.arrived !== 'number') {
          const ws = Array.isArray(f.witnesses) ? f.witnesses : [];
          f.observed = ws.filter((w) => w && !w.origin).length;
          f.arrived = ws.length - f.observed;
          adopted = true;
        }
        if (adopted) {
          const recomputed = federationSignature(f.equation, f.carrier, f.realm, f.shelf, equationSignature);
          if (recomputed && recomputed !== f.signature) {
            f.signature = recomputed;
            this.migrated++;
          }
        }
      }
      this.facts.set(f.signature, f);
    } else if (rec.op === 'event') {
      this.events.push(rec.data);
    } else {
      this.corrupt++;
    }
  }

  /** The only write path. Every line chains to the last — and "the last" is
   *  read from disk under a lock, because another process may have written
   *  since this one loaded. See acquireLock. */
  append(op, data) {
    const rec = { op, data };
    fs.mkdirSync(this.dir, { recursive: true });
    const lockPath = acquireLock(this.dir);
    let line;
    try {
      const prev = headFromDisk(this.logPath);
      const hash = chainHash(prev, rec);
      line = { ...rec, prev, hash };
      fs.appendFileSync(this.logPath, `${JSON.stringify(line)}\n`, 'utf8');
      this.head = hash;
    } finally {
      releaseLock(lockPath);
    }
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
   * @param {string} [spec.realm]   'shared' or 'repo:<slug>'; defaults to shared
   * @param {object} spec.equation  subject/predicate/object[/units/time]
   * @param {'outcome'|'structural'|'contract'|'human'} spec.witness
   * @param {string} spec.nodeId    which node observed it
   * @param {string} spec.reference evidence pointer
   * @param {string} [spec.target]  operational facts only: what it is scoped to
   * @param {string} [spec.actor]   human rulings only: who ruled
   */
  land(spec) {
    const v = this.validate(spec);
    if (v.rejected) return v;

    const sig = federationSignature(v.equation, v.carrier, v.realm, v.shelf, equationSignature);
    const wsig = witnessSignature(v.witness, v.nodeId, v.reference);
    const existing = this.facts.get(sig);
    const at = nowIso(spec.at);

    // Provenance belongs to the OBSERVATION, not the claim: one fact can carry
    // witnesses that were measured here alongside witnesses that arrived from
    // another carrier, and a reader is entitled to tell them apart row by row.
    const witness = { sig: wsig, kind: v.witness, nodeId: v.nodeId, reference: v.reference, at, origin: v.origin || null };

    if (!existing) {
      const fact = {
        id: newId('f'),
        schema: SCHEMA,
        signature: sig,
        carrier: v.carrier,
        realm: v.realm,
        shelf: v.shelf,
        equation: v.equation,
        rendered: renderEquation(v.equation),
        target: v.target,
        status: 'provisional',
        witnesses: [witness],
        distinct: 1,
        observed: witness.origin ? 0 : 1,
        arrived: witness.origin ? 1 : 0,
        landedAt: at,
        lastSeenAt: at,
        supersededBy: null,
        closedAt: null,
        closedBy: null,
      };
      this.append('fact', fact);
      return { ok: true, fact, action: 'landed', arrived: Boolean(witness.origin) };
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

    const witnesses = [...existing.witnesses, witness];
    const distinct = witnesses.length;
    const observed = witnesses.filter((w) => !w.origin).length;
    const next = {
      ...existing,
      witnesses,
      distinct,
      observed,
      arrived: distinct - observed,
      lastSeenAt: at,
      // PROMOTION COUNTS ONLY WHAT THIS POPULATION OBSERVED. An arrived
      // witness is corroboration and it is recorded, but it does not vote:
      // letting the browser carrier's observations help establish a repair
      // fact would pool the two populations through the back door, which is
      // the exact contamination the carrier axis exists to prevent.
      status: existing.shelf === 'world' && observed >= PROMOTION_THRESHOLD ? 'established' : existing.status,
    };
    this.append('fact', next);
    if (next.status === 'established' && existing.status !== 'established') {
      this.append('event', { id: newId('ev'), kind: 'established', signature: sig, carrier: v.carrier, realm: v.realm, distinct, observed, at });
    }
    return { ok: true, fact: next, action: 'witnessed', arrived: Boolean(witness.origin) };
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

    // The carrier, outermost. Absent means this store's own population, which
    // is also where every pre-v3 fact already lives — so, as with the realm,
    // the default is not a convenience, it is the migration.
    const carrier = normalizeCarrier(spec.carrier == null || spec.carrier === '' ? DEFAULT_CARRIER : spec.carrier);
    if (!isCarrier(carrier)) {
      return {
        rejected: true,
        reason: 'carrier',
        detail:
          `carrier must be one of ${CARRIERS.join(', ')}. A fact has to belong to the population ` +
          'that observed it, or two populations that must never pool witnesses will pool them.',
      };
    }

    // The realm. Absent means the commons, which is also where every legacy
    // fact already lives — so the default is not a convenience, it is the
    // migration.
    const realm = spec.realm == null || spec.realm === '' ? SHARED_REALM : String(spec.realm).trim();
    if (!isRealm(realm)) {
      return {
        rejected: true,
        reason: 'realm',
        detail: `realm must be '${SHARED_REALM}' or '${REPO_PREFIX}<slug>'. A fact has to live somewhere findable.`,
      };
    }

    // Provenance, for a fact that crossed carriers. Two rules, both refusals:
    // a partial origin looks checkable and is not, and an origin naming THIS
    // carrier is a fact "transferred" from where it already is — a no-op that
    // would launder a local observation into an arrived one.
    let origin = null;
    if (spec.origin != null) {
      if (!isOrigin(spec.origin)) {
        return {
          rejected: true,
          reason: 'origin',
          detail: 'An origin must name a carrier, factId, signature, head and time. A partial provenance is worse than none.',
        };
      }
      if (spec.origin.carrier === carrier) {
        return {
          rejected: true,
          reason: 'origin-same-carrier',
          detail: `An origin carrier must differ from the landing carrier ('${carrier}'). A fact cannot arrive from where it already is.`,
        };
      }
      origin = spec.origin;
    }

    const nodeId = String(spec.nodeId || '').trim();
    if (!nodeId) return { rejected: true, reason: 'nodeId', detail: 'Every witness names the node that observed it.' };

    // Identity is a REGISTERED FACT, not a string. Without this the distinct-
    // node arithmetic is a vote you can mint by renaming yourself.
    if (this.nodes && !this.nodes.has(nodeId)) {
      return {
        rejected: true,
        reason: 'unregistered-node',
        detail: `'${nodeId}' is not a registered node. Register the repository before it can witness, or the distinct-witness count means nothing.`,
      };
    }

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

    // A fact that ARRIVED may not claim an outcome. `outcome` means "I acted
    // and it worked", and the destination node did not act — the source
    // carrier did. Letting a transfer carry an outcome witness would mint the
    // one witness kind the replication rule exists to constrain, so an arrived
    // fact is witnessed by how it was authorised: a named human ruling, or the
    // re-derivable provenance itself.
    if (origin && spec.witness === 'outcome') {
      return {
        rejected: true,
        reason: 'origin-outcome',
        detail:
          'A fact transferred from another carrier cannot carry an `outcome` witness — this node did not act. ' +
          "Witness it as 'human' (a named ruling) or 'structural' (the provenance is re-derivable).",
      };
    }
    return { shelf: spec.shelf, carrier, realm, equation, witness: spec.witness, nodeId, reference, target: spec.target || null, origin };
  }

  /**
   * A contradiction. Same subject and predicate, different object — INSIDE
   * ONE REALM.
   *
   * On the WORLD shelf this CLOSES the claim — one contradiction, permanently,
   * and it does not decrement a tally.
   *
   * On the OPERATIONAL shelf it SUPERSEDES: the target mutated, which is
   * normal. The old fact stays, marked, pointing at what replaced it.
   * Nothing is ever deleted on either shelf.
   *
   * Across realms none of this fires. See `divergences()`.
   */
  contradict(spec) {
    const v = this.validate(spec);
    if (v.rejected) return v;
    const priorSig = this.findByPredicate(v.equation.subject, v.equation.predicate, v.shelf, v.realm, v.carrier);
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
        carrier: v.carrier,
        realm: v.realm,
        by: landed.fact.id,
        note: `${priorSig.rendered} contradicted by ${landed.fact.rendered} in ${v.carrier}/${v.realm}`,
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
      carrier: v.carrier,
      realm: v.realm,
      by: landed.fact.id,
      note: `${priorSig.rendered} superseded by ${landed.fact.rendered} in ${v.carrier}/${v.realm} — the target moved`,
      at,
    });
    return { ...landed, contradicted: superseded };
  }

  // ------------------------------------------------------------------ reads

  /** The live fact for subject+predicate on a shelf IN A REALM AND A CARRIER,
   *  if any. This is what makes contradiction COMPUTABLE: same left side,
   *  different right side, same place, same population.
   *
   *  The carrier is part of "the same place" on purpose. A browser observing
   *  `composer(site) = A` and a repository recording `composer(site) = B` are
   *  two populations describing two different targets that happen to share a
   *  name. Firing "one contradiction closes it forever" across that boundary
   *  would let a website redesign permanently close a repair fact. */
  findByPredicate(subject, predicate, shelf, realm = SHARED_REALM, carrier = DEFAULT_CARRIER) {
    const s = String(subject || '').toLowerCase();
    const p = String(predicate || '').toLowerCase();
    for (const f of this.facts.values()) {
      if (f.closedAt) continue;
      if (f.shelf !== shelf) continue;
      if ((f.realm || SHARED_REALM) !== realm) continue;
      if ((f.carrier || DEFAULT_CARRIER) !== carrier) continue;
      if (f.equation.subject === s && f.equation.predicate === p) return f;
    }
    return null;
  }

  get(signature) {
    return this.facts.get(signature) || null;
  }

  live({ shelf, realm, carrier } = {}) {
    return [...this.facts.values()].filter(
      (f) =>
        !f.closedAt &&
        (!shelf || f.shelf === shelf) &&
        (!realm || (f.realm || SHARED_REALM) === realm) &&
        (!carrier || (f.carrier || DEFAULT_CARRIER) === carrier)
    );
  }

  /** Every fact, including closed and superseded. The carrier audit needs them. */
  all() {
    return [...this.facts.values()];
  }

  /** Facts whose target has not been re-observed inside `days`. The curator's
   *  staleness queue — it never deletes these, it asks for a recheck.
   *
   *  Defaults to ONE carrier, because a recheck is work, and work belongs to the
   *  population that can actually do it: a repair node cannot re-observe a
   *  website, so a browser fact sitting in the repair staleness queue is a task
   *  that can never be closed. Pass `carrier: null` to see every population at
   *  once, which is an analytic question and a legitimate one.
   *
   *  That is the same line `briefing()` draws, enforced differently: a briefing
   *  REFUSES an unknown carrier, because a hand-off must never silently widen,
   *  while an analytic read accepts `null` as "all". */
  stale({ days = 30, now, realm, carrier = DEFAULT_CARRIER } = {}) {
    const cutoff = new Date(now || Date.now()).getTime() - days * 86400000;
    return this.live({ shelf: 'operational', realm, carrier }).filter((f) => new Date(f.lastSeenAt).getTime() < cutoff);
  }

  /**
   * THE DIVERGENCE REPORT.
   *
   * The same left side — subject, predicate, shelf — held with DIFFERENT
   * values in different realms. In a one-repo world this function cannot
   * return anything, because the store would already have closed or
   * superseded the loser. Across twenty-two repositories it is the most
   * interesting read in the system:
   *
   *   test_command(repo) = npm test      in repo:twld
   *   test_command(repo) = pytest        in repo:striper
   *
   * Both true. Both useful. Neither is a contradiction, and the value is
   * precisely that the Federation did NOT try to reconcile them. This is
   * reported for a human and is never auto-resolved — the moment the
   * collective starts averaging divergent repos into one answer it has
   * started listening, and that is the one thing it must never do.
   */
  divergences({ subject, predicate, shelf, carrier = DEFAULT_CARRIER } = {}) {
    const groups = new Map();
    // One carrier at a time. Divergence is interesting when two REPOSITORIES
    // answer the same question differently; a browser and a repository
    // answering differently is two populations describing two targets that
    // share a name, which is noise dressed as a finding.
    for (const f of this.live({ shelf, carrier })) {
      if (subject && f.equation.subject !== String(subject).toLowerCase()) continue;
      if (predicate && f.equation.predicate !== String(predicate).toLowerCase()) continue;
      const key = `${f.shelf}|${f.equation.subject}|${f.equation.predicate}`;
      const g = groups.get(key) || { shelf: f.shelf, subject: f.equation.subject, predicate: f.equation.predicate, values: [] };
      g.values.push({ realm: f.realm || SHARED_REALM, value: f.equation.object, rendered: f.rendered, status: f.status, distinct: f.distinct });
      groups.set(key, g);
    }
    const out = [];
    for (const g of groups.values()) {
      const distinctValues = new Set(g.values.map((v) => v.value));
      if (distinctValues.size > 1) out.push({ ...g, count: g.values.length });
    }
    return out;
  }

  /**
   * WHAT A READER IS ACTUALLY HANDED.
   *
   * ONE CARRIER, then within it the commons plus this repository's own facts,
   * minus anything that has not earned the right to travel. This is the D24
   * rule landing in the read path at last: a single node's `outcome` fact is
   * visible in the realm that measured it and nowhere else, until either two
   * more nodes measure it or somebody attaches a witness anyone can re-derive.
   *
   * THE CARRIER IS NOT OPTIONAL AND IT IS NOT INFERRED FROM THE FILE. It
   * defaults to this store's own population, and a reader wanting the other
   * one has to ask for it by name. That is the whole fix: before the carrier
   * axis, a briefing returned every fact in the commons, so one browser
   * observation reached every repository's passport — and the browser's own
   * boot block reads `all()`, which handed the entire store to whatever chat
   * composer was open. Two populations, one pool, no error.
   *
   * Facts held by the OTHER carrier are counted and reported, never shown.
   * A briefing that quietly omits a population is a briefing nobody can audit;
   * the exclusion is half the read, exactly as it is in the boot block.
   *
   * `live()` stays unfiltered on purpose — the carrier's own view is not the
   * same thing as what gets handed to a reader, and conflating them is how a
   * local observation quietly becomes fleet doctrine.
   */
  briefing({ realm = SHARED_REALM, viewer, shelf, carrier = DEFAULT_CARRIER } = {}) {
    if (!isCarrier(carrier)) {
      return { rejected: true, reason: 'carrier', detail: `carrier must be one of ${CARRIERS.join(', ')}.` };
    }
    const pool = [
      ...this.live({ shelf, realm: SHARED_REALM, carrier }),
      ...(realm === SHARED_REALM ? [] : this.live({ shelf, realm, carrier })),
    ];
    const seen = new Set();
    const out = [];
    let withheld = 0;
    for (const f of pool) {
      if (seen.has(f.signature)) continue;
      seen.add(f.signature);
      const sv = servable(f, viewer);
      if (sv.servable) out.push({ ...f, travel: sv.reason });
      else withheld++;
    }

    // What the other carrier holds, by name and count. Reported, not shown.
    const otherCarriers = {};
    for (const f of this.live({ shelf })) {
      const c = f.carrier || DEFAULT_CARRIER;
      if (c === carrier) continue;
      otherCarriers[c] = (otherCarriers[c] || 0) + 1;
    }

    return { carrier, realm, facts: out, withheld, otherCarriers, viewer: viewer || null };
  }

  stats() {
    const live = this.live();
    const by = {};
    for (const f of live) {
      by[f.shelf] = by[f.shelf] || { total: 0, established: 0, provisional: 0 };
      by[f.shelf].total++;
      by[f.shelf][f.status === 'established' ? 'established' : 'provisional']++;
    }
    const realms = {};
    const carriers = {};
    let arrived = 0;
    for (const f of live) {
      const r = f.realm || SHARED_REALM;
      realms[r] = (realms[r] || 0) + 1;
      const c = f.carrier || DEFAULT_CARRIER;
      carriers[c] = (carriers[c] || 0) + 1;
      arrived += (f.witnesses || []).filter((w) => w.origin).length;
    }
    return {
      schema: SCHEMA,
      facts: this.facts.size,
      live: live.length,
      byShelf: by,
      byRealm: realms,
      byCarrier: carriers,
      arrivedWitnesses: arrived,
      events: this.events.length,
      chain: this.chain,
      corrupt: this.corrupt,
      migrated: this.migrated,
      carrierMigrated: this.carrierMigrated,
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
  acquireLock,
  releaseLock,
  headFromDisk,
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  SCHEMA,
  CARRIERS,
  DEFAULT_CARRIER,
  isCarrier,
  normalizeCarrier,
  legacyCarrier,
  origin,
  isOrigin,
  SHELVES,
  WITNESS_KINDS,
  SELF_VERIFYING,
  OUTCOME_REPLICATION,
  PROMOTION_THRESHOLD,
  SHARED_REALM,
  REPO_PREFIX,
  witnessSignature,
  chainHash,
  portable,
  servable,
  federationSignature,
  realmSlug,
  GENESIS,
};
