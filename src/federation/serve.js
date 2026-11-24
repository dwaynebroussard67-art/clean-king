/**
 * serve.js — the neural link protocol. What the hub answers when an agent asks.
 *
 * THE SHAPE
 *
 *   A passport is not a store. It is a LINK — the helmet an agent puts on when
 *   it opens a repository. It carries just enough to orient on its own (read
 *   the file, no network, no hub) and a protocol for asking the hub for
 *   everything else.
 *
 *   The Federation is the thing with the goods. It holds the commons, the
 *   tools, and the skills, and it answers requests. An agent never reaches
 *   into another repository; it asks the hub, and the hub decides.
 *
 *   REQUEST, NOT COMMAND. An agent asks; the hub authorizes. That is D5 and
 *   D29 applied to this link: a compromised or merely confused agent can at
 *   worst ask. It can never authorize itself.
 *
 * WHAT THE HUB SERVES
 *
 *   context   the briefing for a realm — what applies here, what was found
 *             elsewhere, where the system disagrees
 *   ask       do you hold this? established / impossible / unknown /
 *             quarantined — never "true", because the collective does not
 *             answer questions it cannot answer
 *   tool      a capability, granted or deferred by its risk rank
 *   skill     a maneuver that has EARNED the right to be called one:
 *             PROMOTE_AFTER successes and not one failure
 *   remember  file a memory. Always deferred unless the witness is
 *             re-derivable — a self-reported outcome waits for a human
 *   evidence  file evidence. Structural, so it lands on its own.
 *
 * EVERY REQUEST IS LOGGED
 *
 * To a chained, append-only log at the hub. What was asked, by which realm,
 * and whether it was granted, refused, or deferred — that is evidence about
 * the system's own behaviour, and it is the record you read when you want to
 * know what the agents have actually been doing.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { sha256 } = require('./realm.js');
const { nowIso } = require('./util.js');

const SCHEMA = 'forgeflight.link.v1';
const GENESIS = '0'.repeat(64);
const chainHash = (prev, rec) => sha256(`${prev}|${JSON.stringify(rec)}`);

/** What an agent may ask for. Closed: an unlisted request has no policy. */
const REQUEST_KINDS = ['context', 'ask', 'tool', 'skill', 'remember', 'evidence'];

/** Risk rank, ported from the forge's capability gate. Lower is safer. */
const RISK_RANK = { read: 0, transform: 1, create: 2, update: 3, delete: 4, external_side_effect: 5 };

/** Above this rank a request waits for a human, whoever is asking. */
const AUTO_GRANT_MAX = RISK_RANK.create;

/**
 * A maneuver is not a skill until it has succeeded this many times — and it is
 * never a skill if it has failed even once. One failure blocks, because a
 * maneuver with a known failure mode is not a skill.
 */
const PROMOTE_AFTER = 5;

// --------------------------------------------------------------------- tools

/**
 * The tool registry. A tool the hub can hand down is a capability with a risk
 * rank, and the rank is what decides whether the hub grants it or waits.
 *
 * Scoped to the requesting realm: `repo.read_file` in TWLD reads TWLD. No
 * tool here can name another repository, which is why the hub can grant them
 * freely without one member reaching into another.
 */
const DEFAULT_TOOLS = [
  { id: 'repo.read_file', risk: 'read', scope: 'own', summary: 'read a file in the requesting repository' },
  { id: 'repo.list_files', risk: 'read', scope: 'own', summary: 'list files in the requesting repository' },
  { id: 'repo.run_tests', risk: 'transform', scope: 'own', summary: 'run the repository test command; the build is the referee' },
  { id: 'repo.grep', risk: 'read', scope: 'own', summary: 'search the requesting repository' },
  { id: 'repo.write_file', risk: 'create', scope: 'own', summary: 'write a file into this realm worktree — path-bounded, never the working checkout' },
  { id: 'evidence.file', risk: 'create', scope: 'own', summary: 'file a categorized evidence row in this repository passport' },
  { id: 'passport.remember', risk: 'create', scope: 'own', summary: 'remember something in this repository passport' },
  { id: 'federation.ask', risk: 'read', scope: 'hub', summary: 'ask the commons what it holds' },
  { id: 'federation.context', risk: 'read', scope: 'hub', summary: 'the briefing for this realm' },
  { id: 'git.commit', risk: 'external_side_effect', scope: 'own', summary: 'commit to the repository — always deferred to a human' },
  { id: 'git.push', risk: 'external_side_effect', scope: 'own', summary: 'push the repository — always deferred to a human' },
];

class ToolRegistry {
  constructor() { this.tools = new Map(DEFAULT_TOOLS.map((t) => [t.id, t])); }
  get(id) { return this.tools.get(id) || null; }
  list() { return [...this.tools.values()]; }
  register(t) { this.tools.set(t.id, t); return t; }
}

// -------------------------------------------------------------------- skills

/**
 * The skill registry.
 *
 * A skill is not a tool. A tool is something the hub CAN do. A skill is a
 * sequence of tools that has been done this way PROMOTE_AFTER times and has
 * never failed — the plane owns it. The distinction is the whole reason the
 * hub gets smarter instead of just busier: every successful run teaches the
 * hub a maneuver, and a maneuver that has never failed is worth handing to
 * the next agent that opens any repository.
 */
class SkillRegistry {
  constructor() { this.skills = new Map(); }

  /**
   * Record an outcome for a tool sequence. Five successes with no failure
   * promotes it to a skill. One failure demotes it permanently — a skill with
   * a known failure mode is not a skill.
   */
  record(signature, sequence, { ok, at, realm } = {}) {
    const s = this.skills.get(signature) || { signature, sequence, successes: 0, failures: 0, promotedAt: null, realms: new Set(), firstSeenAt: nowIso(at), lastSeenAt: nowIso(at) };
    if (ok) s.successes++;
    else s.failures++;
    s.lastSeenAt = nowIso(at);
    if (realm) s.realms.add(realm);
    if (!s.promotedAt && s.successes >= PROMOTE_AFTER && s.failures === 0) s.promotedAt = nowIso(at);
    this.skills.set(signature, s);
    return s;
  }

  /** Only promoted skills are servable. Everything else is still a candidate. */
  promoted() {
    return [...this.skills.values()].filter((s) => s.promotedAt && s.failures === 0);
  }

  get(signature) { return this.skills.get(signature) || null; }

  list() {
    return [...this.skills.values()].map((s) => ({
      ...s,
      realms: [...s.realms],
      status: s.promotedAt && s.failures === 0 ? 'skill' : s.failures > 0 ? 'blocked' : 'candidate',
    }));
  }
}

// ---------------------------------------------------------------------- hub

/**
 * The link server. One method — `request` — and a chained audit of every call.
 */
class LinkServer {
  constructor(dir, { federation, registry, passports, gate } = {}) {
    this.dir = dir;
    this.federation = federation;
    this.registry = registry;
    this.gate = gate || null;
    this.passports = passports || new Map(); // realm -> RepoPassport
    this.tools = new ToolRegistry();
    this.skills = new SkillRegistry();
    this.requests = [];
    this.logPath = path.join(dir, 'requests.jsonl');
    this.head = GENESIS;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.logPath)) return this;
    for (const line of fs.readFileSync(this.logPath, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const rec = JSON.parse(s);
        this.requests.push(rec.data);
        this.head = rec.hash || this.head;
      } catch { /* a torn line is dropped, never fatal */ }
    }
    return this;
  }

  /**
   * Answer one request.
   *
   * Returns exactly one of:
   *   granted  — here it is
   *   deferred — a human has to release this; it is queued, not refused
   *   refused  — this is not a thing the hub does, named
   *
   * Never throws, never guesses, never silently does nothing.
   */
  request(req, { at } = {}) {
    const at_ = nowIso(at);
    const id = `rq_${sha256(`${at_}|${JSON.stringify(req)}`).slice(0, 12)}`;
    const from = req.from || null;

    let verdict;
    if (!REQUEST_KINDS.includes(req.kind)) {
      verdict = { status: 'refused', reason: 'unknown-request', detail: `kind must be one of ${REQUEST_KINDS.join(', ')}` };
    } else if (!from) {
      verdict = { status: 'refused', reason: 'anonymous-request', detail: 'A request names the realm it comes from. An anonymous request is indistinguishable from the machine asking itself.' };
    } else if (this.registry && !this.registry.has(String(from).replace(/^repo:/, ''))) {
      verdict = { status: 'refused', reason: 'unregistered-realm', detail: `'${from}' is not a registered realm. Register its passport before it can ask.` };
    } else {
      verdict = this.dispatch(req, from, at_);
    }

    // THE HUMAN GATE. Everything the hub will not do on its own authority
    // becomes a ticket, and the ticket waits for a named human. The hub holds
    // the ticket; it does not release its own.
    if (this.gate) {
      if (this.gate.delegation === 'none') {
        verdict = { status: 'refused', reason: 'gate-closed', detail: 'Delegation is `none`. Nothing is released in this system right now.' };
      } else if (this.gate.delegation === 'sealed' && verdict.status === 'granted') {
        verdict = { status: 'deferred', reason: 'sealed', detail: 'Delegation is `sealed`: every request needs a signature, reads included.', payload: verdict.payload };
      }
      if (verdict.status === 'deferred') {
        const held = this.gate.hold(req, verdict);
        if (held.autoReleased) {
          verdict = {
            status: 'granted',
            releasedBy: 'delegation:earned',
            detail: `Auto-released: this exact request shape was approved ${PROMOTE_AFTER} times with zero refusals.`,
            payload: verdict.payload,
            ticket: held.ticket,
          };
        } else {
          verdict = { ...verdict, ticket: held.ticket, duplicate: !!held.duplicate };
        }
      }
    }

    const rec = { id, at: at_, from, kind: req.kind, name: req.name || null, status: verdict.status, reason: verdict.reason || null };
    this.log(rec);
    return { ...verdict, id, at: at_ };
  }

  log(rec) {
    const prev = this.head;
    const body = { op: 'request', data: rec };
    const hash = chainHash(prev, body);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.logPath, `${JSON.stringify({ ...body, prev, hash })}\n`, 'utf8');
    this.head = hash;
    this.requests.push(rec);
  }

  dispatch(req, from, at) {
    const slug = String(from).replace(/^repo:/, '');
    const passport = this.passports.get(from) || this.passports.get(slug);

    switch (req.kind) {
      case 'context': {
        if (!this.federation) return { status: 'refused', reason: 'no-federation' };
        const b = this.federation.briefing({ realm: from, viewer: slug });
        return { status: 'granted', payload: { facts: b.facts.length, withheld: b.withheld, facts: b.facts } };
      }

      case 'ask': {
        if (!this.federation) return { status: 'refused', reason: 'no-federation' };
        const { subject, predicate, value } = req.arg || {};
        if (!subject || !predicate) {
          return { status: 'refused', reason: 'malformed-ask', detail: 'ask needs { subject, predicate, value }' };
        }
        const hit = this.federation.findByPredicate(subject, predicate, req.shelf || 'operational', 'shared');
        if (!hit) return { status: 'granted', payload: { answer: 'unknown' } };
        const same = String(hit.equation.object) === String(value);
        return { status: 'granted', payload: { answer: same ? 'established' : 'impossible', fact: hit, because: same ? null : [hit] } };
      }

      case 'tool': {
        const tool = this.tools.get(req.name);
        if (!tool) return { status: 'refused', reason: 'unknown-tool', detail: `The hub holds no tool called '${req.name}'.` };
        const rank = RISK_RANK[tool.risk];
        if (rank === undefined) return { status: 'refused', reason: 'unranked-tool', detail: 'A tool with no risk rank cannot be authorized.' };
        if (rank > AUTO_GRANT_MAX) {
          return {
            status: 'deferred',
            reason: 'needs-human-release',
            detail: `'${req.name}' is ${tool.risk}. It is queued and waits for a named human. Asking again does not speed this up.`,
            tool,
          };
        }
        return { status: 'granted', payload: { tool, scope: tool.scope === 'own' ? from : 'hub' } };
      }

      case 'skill': {
        const s = this.skills.get(req.name);
        if (!s) return { status: 'refused', reason: 'unknown-maneuver', detail: `No maneuver '${req.name}' has been recorded yet.` };
        if (s.failures > 0) {
          return { status: 'refused', reason: 'maneuver-blocked', detail: `This maneuver has failed ${s.failures} time(s). A maneuver with a known failure mode is not a skill.` };
        }
        if (!s.promotedAt) {
          return { status: 'deferred', reason: 'not-yet-a-skill', detail: `${s.successes}/${PROMOTE_AFTER} successes. It is a candidate, not a skill — candidates are not handed out.`, maneuver: { ...s, realms: [...s.realms] } };
        }
        return { status: 'granted', payload: { skill: { ...s, realms: [...s.realms] } } };
      }

      case 'evidence': {
        if (!passport) return { status: 'refused', reason: 'no-passport', detail: 'No passport is mounted for this realm.' };
        const res = passport.recordEvidence({ ...req.arg, at });
        if (res.rejected) return { status: 'refused', reason: res.reason, detail: res.detail };
        return { status: 'granted', payload: { evidence: res.evidence } };
      }

      case 'remember': {
        if (!passport) return { status: 'refused', reason: 'no-passport', detail: 'No passport is mounted for this realm.' };
        const w = (req.arg && req.arg.witness) || 'outcome';
        // Self-reported outcomes wait. Re-derivable evidence does not. That is
        // the whole difference between the hub learning and the hub listening.
        if (w === 'outcome') {
          return { status: 'deferred', reason: 'outcome-needs-replication', detail: `Filed locally as a candidate. It reaches the commons when ${PROMOTE_AFTER - 1} other realm(s) measure the same thing, or a human releases it.` };
        }
        const res = passport.remember({ ...req.arg, at });
        if (res.rejected) return { status: 'refused', reason: res.reason, detail: res.detail };
        return { status: 'granted', payload: { memory: res.memory } };
      }

      default:
        return { status: 'refused', reason: 'unknown-request' };
    }
  }
}

module.exports = { LinkServer, ToolRegistry, SkillRegistry, REQUEST_KINDS, RISK_RANK, PROMOTE_AFTER, SCHEMA, AUTO_GRANT_MAX };
