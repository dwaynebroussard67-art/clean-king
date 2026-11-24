/**
 * gate.js — the human gate.
 *
 * THE RULE
 *
 *   A human is always the gate. No agent changes anything on its own
 *   authority, in any repository, ever. This is not a policy preference — it
 *   is D20 ("the human is step four"), D29 (an anonymous approval is
 *   indistinguishable from the machine approving itself) and D30 (a name on
 *   disk is a memory, not a session).
 *
 * THE SHAPE OF THE GATE
 *
 *   An agent asks. The hub routes. Anything above the auto-grant ceiling does
 *   not execute — it becomes a TICKET in a queue, and the ticket needs a
 *   named human to release it. The hub holds the ticket; it never releases
 *   its own.
 *
 * DELEGATION — THE "ASK EVERY TIME / ACCEPT ALL" LADDER
 *
 * People reasonably want a dial. The usual dial is a boolean: trust
 * everything or prompt for everything. Both halves of that are wrong — a
 * boolean delegates by KIND OF ACTION and never learns, so it is either
 * tedious forever or dangerous immediately.
 *
 * This ladder delegates by TRACK RECORD instead, using the rule the system
 * already uses to decide what a skill is:
 *
 *   none     nothing is released. No operator configured → fail closed.
 *   sealed   every request needs a signature, reads included. For an agent
 *            you do not yet trust, or a repository you cannot afford to lose.
 *   ask      every deferred request needs a signature. THE DEFAULT.
 *   earned   a request SHAPE the human has released PROMOTE_AFTER times with
 *            zero rejections releases itself. Five approvals and not one
 *            refusal is the same bar a maneuver has to clear to be called a
 *            skill, and it is the same bar for the same reason: a shape with
 *            a known failure mode is not a skill, and a shape the human has
 *            ever said no to is not delegated.
 *
 * ONE REJECTION BLOCKS PERMANENTLY. Not "resets the counter" — blocks. If a
 * human refused that shape once, the machine does not get to ask again until
 * a human says otherwise. Otherwise the delegation is a lock the agent can
 * eventually pick by asking enough times.
 *
 * SIGN-IN IS PER LAUNCH
 *
 * A name on disk is a memory, not a session. An operator configures who may
 * sign, but configuring is not signing — a process must sign in before it can
 * release anything, or a stale name in a config file is a standing signature.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { sha256 } = require('./realm.js');
const { nowIso } = require('./util.js');

const SCHEMA = 'forgeflight.gate.v1';
const GENESIS = '0'.repeat(64);
const chainHash = (prev, rec) => sha256(`${prev}|${JSON.stringify(rec)}`);

/** Five approvals and not one refusal. The same bar as a maneuver. */
const PROMOTE_AFTER = 5;

const DELEGATION = ['none', 'sealed', 'ask', 'earned'];
const DEFAULT_DELEGATION = 'ask';

// ------------------------------------------------------------------ operators

/**
 * Who may sign. Configuration, never code — a hardcoded name is a constant,
 * and a constant trusted as "the human" is a standing backdoor.
 */
class OperatorStore {
  constructor(dir, { env } = {}) {
    this.dir = dir;
    this.path = path.join(dir, 'operators.json');
    this.env = env || process.env;
    this.operators = [];
    this.signedIn = null; // per-process, never persisted
  }

  load() {
    const fromEnv = this.env.FORGE_FEDERATION_OPERATORS;
    if (fromEnv) this.operators = String(fromEnv).split(',').map((s) => s.trim()).filter(Boolean);
    else if (fs.existsSync(this.path)) {
      try { this.operators = JSON.parse(fs.readFileSync(this.path, 'utf8')).operators || []; } catch { this.operators = []; }
    }
    return this;
  }

  configure(names) {
    this.operators = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.path, `${JSON.stringify({ schema: SCHEMA, operators: this.operators }, null, 2)}\n`, 'utf8');
    return this.operators;
  }

  hasOperators() { return this.operators.length > 0; }

  /**
   * Sign in. Required per process. Without it nothing releases, which is the
   * correct posture for a boundary that must never trust a constant.
   */
  signIn(name) {
    const n = String(name || '').trim();
    if (!n) return { ok: false, reason: 'no-name' };
    if (!this.operators.includes(n)) return { ok: false, reason: 'unauthorized-operator', detail: `'${n}' is not a configured operator.` };
    this.signedIn = n;
    return { ok: true, actor: n };
  }

  signOut() { this.signedIn = null; }

  /** The signed-in actor, or a named refusal. Never a default name. */
  authorize(supplied) {
    void supplied; // a renderer-supplied actor is ignored, by design
    if (!this.operators.length) return { ok: false, reason: 'no-operators-configured', detail: 'Nothing can be released until an operator is configured.' };
    if (!this.signedIn) return { ok: false, reason: 'not-signed-in', detail: 'A name on disk is a memory, not a session. Sign in this launch.' };
    return { ok: true, actor: this.signedIn };
  }
}

// --------------------------------------------------------------------- queue

/**
 * The release queue. Where deferred requests wait.
 *
 * Append-only, including refusals — a queue the machine could quietly retract
 * from would show only the proposals it still stood behind, which is exactly
 * the history you would want to inspect if you suspected it had started
 * steering.
 */
class ReleaseQueue {
  constructor(dir) {
    this.dir = dir;
    this.logPath = path.join(dir, 'releases.jsonl');
    this.tickets = new Map();
    this.shapes = new Map(); // shape -> { approvals, rejections }
    this.head = GENESIS;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.logPath)) return this;
    for (const line of fs.readFileSync(this.logPath, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try { this.apply(JSON.parse(s)); } catch { /* torn line, dropped */ }
    }
    return this;
  }

  apply(rec) {
    const d = rec.data;
    if (rec.op === 'defer') {
      this.tickets.set(d.id, d);
    } else if (rec.op === 'release' || rec.op === 'refuse') {
      const t = this.tickets.get(d.id);
      if (!t) return;
      t.status = rec.op === 'release' ? 'released' : 'refused';
      t.decidedAt = d.at;
      t.decidedBy = d.actor;
      t.note = d.note || null;
      const shape = this.shapes.get(t.shape) || { approvals: 0, rejections: 0 };
      if (rec.op === 'release') shape.approvals++;
      else shape.rejections++;
      this.shapes.set(t.shape, shape);
    }
    this.head = rec.hash || this.head;
  }

  append(op, data) {
    const prev = this.head;
    const body = { op, data };
    const hash = chainHash(prev, body);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.logPath, `${JSON.stringify({ ...body, prev, hash })}\n`, 'utf8');
    this.head = hash;
    this.apply({ ...body, hash });
    return data;
  }

  /** What makes two requests the same SHAPE, for delegation purposes: the
   *  kind of action, the tool, and the realm that asked. Not the arguments —
   *  otherwise every new filename would mint a fresh shape and nothing could
   *  ever earn delegation. */
  static shapeOf(req) {
    return sha256(`${req.kind}|${req.name || req.arg?.name || ''}|${req.from || ''}`);
  }

  defer(req, verdict) {
    const shape = ReleaseQueue.shapeOf(req);
    const existing = [...this.tickets.values()].find((t) => t.shape === shape && t.status === 'open');
    if (existing) return { ticket: existing, duplicate: true };

    const ticket = {
      id: `tk_${sha256(`${shape}|${nowIso()}`).slice(0, 12)}`,
      schema: SCHEMA,
      shape,
      from: req.from,
      kind: req.kind,
      name: req.name || null,
      arg: req.arg || null,
      reason: req.reason || null,
      deferredBecause: verdict.reason,
      status: 'open',
      createdAt: nowIso(),
      decidedAt: null,
      decidedBy: null,
      note: null,
    };
    this.append('defer', ticket);
    return { ticket, duplicate: false };
  }

  /** Has this shape earned the right to release itself? */
  earned(shape) {
    const s = this.shapes.get(shape);
    if (!s) return false;
    if (s.rejections > 0) return false; // one refusal blocks, permanently
    return s.approvals >= PROMOTE_AFTER;
  }

  open() { return [...this.tickets.values()].filter((t) => t.status === 'open'); }
  all() { return [...this.tickets.values()]; }

  release(id, { actor, note }) {
    const t = this.tickets.get(id);
    if (!t) return { ok: false, reason: 'unknown-ticket' };
    if (t.status !== 'open') return { ok: false, reason: 'already-decided', detail: `That ticket is ${t.status}.` };
    this.append('release', { id, actor, note: note || null, at: nowIso() });
    return { ok: true, ticket: this.tickets.get(id) };
  }

  refuse(id, { actor, note }) {
    const t = this.tickets.get(id);
    if (!t) return { ok: false, reason: 'unknown-ticket' };
    if (t.status !== 'open') return { ok: false, reason: 'already-decided' };
    this.append('refuse', { id, actor, note: note || null, at: nowIso() });
    return { ok: true, ticket: this.tickets.get(id) };
  }
}

// ---------------------------------------------------------------------- gate

/**
 * The gate itself. Wraps operators, delegation policy, and the queue.
 */
class Gate {
  constructor(dir, { delegation } = {}) {
    this.dir = dir;
    this.operators = new OperatorStore(dir).load();
    this.queue = new ReleaseQueue(dir).load();
    this.delegation = DELEGATION.includes(delegation) ? delegation : DEFAULT_DELEGATION;
  }

  setDelegation(d) {
    if (!DELEGATION.includes(d)) return { rejected: true, reason: 'delegation', detail: `must be one of ${DELEGATION.join(', ')}` };
    this.delegation = d;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, 'delegation.json'), `${JSON.stringify({ schema: SCHEMA, delegation: d }, null, 2)}\n`, 'utf8');
    return { ok: true, delegation: d };
  }

  /**
   * Route a deferred verdict.
   *
   * Returns the ticket, and — only when delegation is `earned` and this exact
   * shape has cleared the bar — an auto-release. Nothing else self-releases.
   */
  hold(req, verdict) {
    const shape = ReleaseQueue.shapeOf(req);

    if (this.delegation === 'earned' && this.queue.earned(shape)) {
      const { ticket } = this.queue.defer(req, verdict);
      this.queue.release(ticket.id, { actor: 'delegation:earned', note: `auto-released: this shape was approved ${this.queue.shapes.get(shape).approvals} times with zero refusals` });
      return { ticket: this.queue.tickets.get(ticket.id), autoReleased: true };
    }

    const { ticket, duplicate } = this.queue.defer(req, verdict);
    return { ticket, autoReleased: false, duplicate };
  }

  /** A human decides. The actor comes from the session, never from the caller. */
  release(id, { actor: supplied, note } = {}) {
    const who = this.operators.authorize(supplied);
    if (!who.ok) return who;
    return this.queue.release(id, { actor: who.actor, note });
  }

  refuse(id, { actor: supplied, note } = {}) {
    const who = this.operators.authorize(supplied);
    if (!who.ok) return who;
    return this.queue.refuse(id, { actor: who.actor, note });
  }

  status() {
    return {
      delegation: this.delegation,
      operatorsConfigured: this.operators.operators.length,
      signedIn: this.operators.signedIn,
      open: this.queue.open().length,
      tickets: this.queue.all().length,
      earnedShapes: [...this.queue.shapes.entries()].filter(([, s]) => s.rejections === 0 && s.approvals >= PROMOTE_AFTER).length,
    };
  }
}

module.exports = { Gate, OperatorStore, ReleaseQueue, DELEGATION, DEFAULT_DELEGATION, PROMOTE_AFTER, SCHEMA };
