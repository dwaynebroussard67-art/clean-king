/**
 * minds.js — every AI keeps its own memory, and the Federation keeps all of
 * them.
 *
 * THE SHAPE
 *
 *          ChatGPT        Claude         Gemini        Perplexity
 *        ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
 *        │  lane   │   │  lane   │   │  lane   │   │  lane   │   each AI reads
 *        │ its own │   │ its own │   │ its own │   │ its own │   its own lane
 *        └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘
 *             └─────────────┴──────┬──────┴─────────────┘
 *                     ┌────────────┴────────────┐
 *                     │   THE POOL (minds.jsonl) │   every memory, every
 *                     │   who · which chat · when│   AI, every conversation
 *                     └────────────┬────────────┘
 *                                  │  the same thing, independently, from
 *                                  ▼  OUTCOME_REPLICATION distinct AIs
 *                              SHARED — read by every AI, labelled as shared
 *
 * WHAT THE AI DECIDES, AND WHAT IT CANNOT
 *
 * An AI decides what IT remembers. It writes `REMEMBER: …` or `FORGET: …`
 * whenever it chooses and nobody approves the line. It lands in that AI's
 * lane immediately.
 *
 * What an AI cannot do is decide what ANOTHER AI remembers. A lane is read
 * only by its own AI. That is the whole defence against corruption: a model
 * that hallucinates, or a page that prompt-injects one model, writes into one
 * lane and stops there. A memory reaches other AIs only when several DISTINCT
 * AIs remembered the same thing on their own — replication, not agreement,
 * the same rule the Federation applies to outcomes (store.js). One AI saying
 * it ten times is one AI.
 *
 * WHO AN AI IS
 *
 * An AI is the site it runs on — chatgpt.com, claude.ai — taken from the
 * browser tab's address by the extension, never from anything the page or the
 * model says. A model cannot claim to be a different AI by typing a name. The
 * same rule Forge Flight uses: one seat per host.
 *
 * WHICH CONVERSATION
 *
 * Every event carries the conversation it came from (the chat's address), so
 * the pool can always answer "which AI said this, in which chat, when".
 *
 * NOTHING IS DELETED
 *
 * FORGET and a human Undo are new lines that retire a memory; the old line
 * stays. The file is append-only and hash-chained like every other log here.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { OUTCOME_REPLICATION } = require('../federation/store.js');

const SCHEMA = 'forgeflight.minds.v1';
const GENESIS = '0'.repeat(64);
const MAX_FACT = 450;
const OPS = ['link', 'remember', 'forget', 'retract'];
const SHARE_AT = OUTCOME_REPLICATION;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const chainHash = (prev, rec) => sha256(`${prev}|${JSON.stringify(rec)}`);

function hubDir() {
  return process.env.FORGE_FEDERATION_HOME || path.join(os.homedir(), '.forge-federation');
}

function clean(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= MAX_FACT) return s;
  const cut = s.slice(0, MAX_FACT);
  const sp = cut.lastIndexOf(' ');
  return (sp > 200 ? cut.slice(0, sp) : cut).trim();
}

/** Same thing, same signature, regardless of case, spacing or a trailing full stop. */
function signature(fact) {
  return sha256(clean(fact).toLowerCase().replace(/[.!]+$/, ''));
}

/** The AI is the host. Taken from the tab address, never from page text. */
function identify(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.host.toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  return { ai: host, conversation: `${host}${u.pathname.replace(/\/+$/, '') || '/'}` };
}

/** "chatgpt.com" -> "Chatgpt", "gemini.google.com" -> "Gemini". Mirrors Forge Flight's seats.js. */
function displayName(host) {
  const bare = String(host || '').split(':')[0];
  if (!bare.includes('.') || /^\d+(\.\d+){3}$/.test(bare)) return bare || 'AI';
  const skip = new Set(['com', 'ai', 'io', 'app', 'dev', 'org', 'net', 'co', 'sh', 'me', 'chat', 'google', 'cloud', 'www']);
  const label = bare.split('.').find((p) => !skip.has(p)) || bare.split('.')[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

class Minds {
  constructor(dir = path.join(hubDir(), 'minds')) {
    this.dir = dir;
    this.file = path.join(dir, 'minds.jsonl');
    this.head = GENESIS;
    this.events = [];
    this.corrupt = 0;
    this.load();
  }

  load() {
    this.head = GENESIS;
    this.events = [];
    this.corrupt = 0;
    if (!fs.existsSync(this.file)) return this;
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const rec = JSON.parse(s);
        this.events.push(rec.data);
        this.head = rec.hash || this.head;
      } catch { this.corrupt++; }
    }
    return this;
  }

  append(data) {
    if (!OPS.includes(data.op)) throw new Error(`unknown op ${data.op}`);
    const rec = { op: data.op, data: { schema: SCHEMA, ...data } };
    const hash = chainHash(this.head, rec);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify({ ...rec, prev: this.head, hash })}\n`, 'utf8');
    this.head = hash;
    this.events.push(rec.data);
    return rec.data;
  }

  /** Walk the chain from genesis. Returns every break, by line. */
  verify() {
    const breaks = [];
    if (!fs.existsSync(this.file)) return { ok: true, lines: 0, breaks };
    let prev = GENESIS;
    let n = 0;
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      n++;
      let rec;
      try { rec = JSON.parse(line); } catch { breaks.push({ line: n, kind: 'unparseable' }); continue; }
      if (rec.prev !== prev) breaks.push({ line: n, kind: 'prev-mismatch' });
      if (chainHash(rec.prev, { op: rec.op, data: rec.data }) !== rec.hash) breaks.push({ line: n, kind: 'hash-mismatch' });
      prev = rec.hash;
    }
    return { ok: breaks.length === 0, lines: n, breaks };
  }

  // ------------------------------------------------------------- writes

  /** A conversation was linked. This is the ledger of which chat went to which AI. */
  link(url, { at } = {}) {
    const who = identify(url);
    if (!who) return { rejected: true, reason: 'no-identity', detail: 'The tab has no web address an AI can be identified by.' };
    this.append({ op: 'link', ...who, at: at || new Date().toISOString() });
    return { ok: true, ...who };
  }

  /** The AI chose to remember these. Its lane, its call. */
  remember(url, facts, { at } = {}) {
    const who = identify(url);
    if (!who) return { rejected: true, reason: 'no-identity' };
    const when = at || new Date().toISOString();
    const out = [];
    for (const f of facts) {
      const fact = clean(f);
      if (!fact) continue;
      const sig = signature(fact);
      if (this.liveIn(who.ai).some((m) => m.sig === sig)) { out.push({ fact, action: 'already-remembered' }); continue; }
      // Unique per line, not per fact: two AIs remembering the same thing in
      // the same millisecond must get two ids, or one forgetting retires both.
      const id = `mind_${crypto.randomBytes(8).toString('hex')}`;
      const ev = this.append({ op: 'remember', ...who, fact, sig, id, at: when });
      out.push({ fact, action: 'remembered', id: ev.id });
    }
    return { ok: true, ...who, results: out };
  }

  /** The AI chose to drop these. Only from its own lane — it cannot forget for anyone else. */
  forget(url, facts, { at } = {}) {
    const who = identify(url);
    if (!who) return { rejected: true, reason: 'no-identity' };
    const when = at || new Date().toISOString();
    const out = [];
    for (const f of facts) {
      const sig = signature(f);
      const mine = this.liveIn(who.ai).filter((m) => m.sig === sig);
      if (!mine.length) { out.push({ fact: clean(f), action: 'not-yours' }); continue; }
      for (const m of mine) this.append({ op: 'forget', ...who, target: m.id, sig, at: when });
      out.push({ fact: clean(f), action: 'forgotten' });
    }
    return { ok: true, ...who, results: out };
  }

  /** The human took one back. Named separately from forget: the AI did not choose this. */
  retract(id, { at } = {}) {
    const m = this.events.find((e) => e.op === 'remember' && e.id === id);
    if (!m) return { rejected: true, reason: 'unknown-id' };
    if (!this.isLive(m)) return { ok: true, action: 'already-retired' };
    this.append({ op: 'retract', ai: m.ai, conversation: m.conversation, target: id, sig: m.sig, by: 'human', at: at || new Date().toISOString() });
    return { ok: true, action: 'retracted', fact: m.fact, ai: m.ai };
  }

  // -------------------------------------------------------------- reads

  isLive(m) {
    return !this.events.some((e) => (e.op === 'forget' || e.op === 'retract') && e.target === m.id);
  }

  /** One AI's lane: what it chose to keep, still kept. */
  liveIn(ai) {
    return this.events.filter((e) => e.op === 'remember' && e.ai === ai && this.isLive(e));
  }

  /**
   * The pool, grouped by signature. `ais` counts DISTINCT AIs that hold it
   * live. `shared` only when that reaches SHARE_AT.
   */
  pool() {
    const by = new Map();
    for (const e of this.events) {
      if (e.op !== 'remember' || !this.isLive(e)) continue;
      const g = by.get(e.sig) || { sig: e.sig, fact: e.fact, ais: new Set(), conversations: new Set(), first: e.at };
      g.ais.add(e.ai);
      g.conversations.add(e.conversation);
      by.set(e.sig, g);
    }
    return [...by.values()].map((g) => ({
      sig: g.sig,
      fact: g.fact,
      ais: [...g.ais].sort(),
      conversations: g.conversations.size,
      shared: g.ais.size >= SHARE_AT,
      first: g.first,
    }));
  }

  shared() { return this.pool().filter((p) => p.shared); }

  /** Every AI the Federation has met, with what it holds. */
  roster() {
    const ais = new Map();
    for (const e of this.events) {
      const r = ais.get(e.ai) || { ai: e.ai, name: displayName(e.ai), conversations: new Set(), links: 0, kept: 0 };
      r.conversations.add(e.conversation);
      if (e.op === 'link') r.links++;
      ais.set(e.ai, r);
    }
    return [...ais.values()].map((r) => ({ ...r, conversations: r.conversations.size, kept: this.liveIn(r.ai).length }));
  }

  /** Which conversations went to which AI, newest first. */
  conversations() {
    const by = new Map();
    for (const e of this.events) {
      const c = by.get(e.conversation) || { conversation: e.conversation, ai: e.ai, first: e.at, last: e.at, remembered: 0, forgot: 0 };
      c.last = e.at;
      if (e.op === 'remember') c.remembered++;
      if (e.op === 'forget') c.forgot++;
      by.set(e.conversation, c);
    }
    return [...by.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)));
  }
}

module.exports = { Minds, identify, displayName, signature, clean, hubDir, SHARE_AT, SCHEMA };
