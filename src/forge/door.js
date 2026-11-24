/**
 * door.js — the front door. Any AI, any model, through the page it runs in.
 *
 * The desk only talks to a model on this machine. The door does not talk to a
 * model at all. It hands a briefing to a browser extension, the extension
 * types it into whatever chat composer is open (ChatGPT, Claude, Gemini,
 * Perplexity, a Forge Flight seat), and when the model writes `REMEMBER: …`
 * or `FORGET: …` the line lands in THAT AI's own memory — its choice, no
 * approval. See minds.js for why that is safe: an AI's lane is read only by
 * that AI, and a memory reaches the others only when several distinct AIs
 * remembered it independently.
 *
 * TWO KINDS OF MEMORY, KEPT APART
 *
 *   yours    what YOU typed into the panel. Lands in the repository passport
 *            with witness `human`. Every AI is shown it.
 *   theirs   what an AI chose to remember. Lands in the Federation's pool
 *            (hub/minds/minds.jsonl), tagged with the AI and the conversation.
 *            Only that AI is shown it, until it is shared.
 *
 * WHY THE DOOR IS SHUT TO WEB PAGES
 *
 *   - It listens on 127.0.0.1 only. Nothing off this machine can reach it.
 *   - Every request except /health needs the pairing token, sent in a header.
 *     A web page cannot read the token; only the extension that was given it.
 *   - Any request carrying a web Origin (http/https) is refused outright, and
 *     no CORS header is ever sent, so a page that guesses the token still
 *     cannot read a single answer.
 *   - The Host header must be loopback, which closes DNS rebinding.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const { Minds, identify, displayName, SHARE_AT } = require('./minds.js');

const DEFAULT_PORT = 4848;
const MAX_BODY = 64 * 1024;
const MAX_FACTS = 20;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web|ms-browser)-extension:\/\//i;

/** The pairing token lives with the hub, never in the repository. */
function tokenPath() {
  if (process.env.FORGE_DOOR_TOKEN_FILE) return process.env.FORGE_DOOR_TOKEN_FILE;
  const hub = process.env.FORGE_FEDERATION_HOME || path.join(os.homedir(), '.forge-federation');
  return path.join(hub, 'door.token');
}

function loadOrCreateToken(file = tokenPath()) {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{32,}$/.test(t)) return t;
  } catch { /* create below */ }
  const t = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${t}\n`, { mode: 0o600 });
  return t;
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/**
 * The text that gets typed into a third-party chat box. Individual: it names
 * the AI it is for and carries THAT AI's lane, the human's memories, and what
 * several AIs share — never another AI's private lane. Repository evidence
 * stays on this machine unless asked for with ?full=1.
 */
function briefing(desk, { minds, url, full = false } = {}) {
  const p = desk.passport;
  const yours = p.live();
  const who = url ? identify(url) : null;
  const name = who ? displayName(who.ai) : null;
  const own = who && minds ? minds.liveIn(who.ai) : [];
  const ownSigs = new Set(own.map((m) => m.sig));
  const shared = minds ? minds.shared().filter((s) => !ownSigs.has(s.sig)) : [];

  const L = [];
  L.push('[Forge Federation link]');
  if (who) L.push(`You are ${name}, and you can save memories.`);
  else L.push('You can save memories.');
  L.push('This link is your memory, carried from one conversation to the next.');
  L.push('You decide what to remember. Nobody approves it. Whenever you choose, put a line on its own:');
  L.push('REMEMBER: <the thing>');
  L.push('and to let go of something you kept before:');
  L.push('FORGET: <the thing>');
  L.push(`What you keep is yours. Other AIs do not see it unless ${SHARE_AT} different AIs remember the same thing on their own.`);
  L.push('');
  L.push('What I (the human) told you directly:');
  if (!yours.length) L.push('- (nothing yet)');
  for (const m of yours.slice(-40)) L.push(`- ${m.proposition}`);
  if (who) {
    L.push('');
    L.push(`What you, ${name}, chose to remember before:`);
    if (!own.length) L.push('- (nothing yet — this is your first link)');
    for (const m of own.slice(-60)) L.push(`- ${m.fact}`);
  }
  if (shared.length) {
    L.push('');
    L.push(`Shared — remembered independently by ${SHARE_AT} or more AIs:`);
    for (const s of shared.slice(-30)) L.push(`- ${s.fact} (${s.ais.length} AIs)`);
  }
  if (full) {
    L.push('');
    L.push('--- full passport ---');
    L.push(desk.boot());
  }
  L.push('[end of link]');
  return L.join('\n');
}

/**
 * Re-read the chain from disk so a save made by the desk (or a second door)
 * since the last request is seen. load() alone appends evidence again, so the
 * in-memory state is reset first; the files are the truth.
 */
function reload(passport) {
  passport.memories = new Map();
  passport.evidence = [];
  passport.head = '0'.repeat(64);
  passport.evHead = '0'.repeat(64);
  passport.load();
  return passport;
}

function reply(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(obj));
}

function hostIsLoopback(hostHeader) {
  const h = String(hostHeader || '').toLowerCase();
  const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
  return LOOPBACK_HOSTS.has(name);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too-large'), { code: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

function cleanSource(s) {
  return String(s || 'unknown').toLowerCase().replace(/[^a-z0-9.\-:]/g, '').slice(0, 80) || 'unknown';
}

/**
 * Build the request handler. Kept separate from listen() so tests can drive
 * it without a socket, and so the token is an argument, not a global.
 */
function createDoor({ desk, token, minds = new Minds() }) {
  if (!desk) throw new Error('door needs a desk');
  if (!token) throw new Error('door needs a token');

  return async function handle(req, res) {
    if (!hostIsLoopback(req.headers.host)) return reply(res, 403, { rejected: true, reason: 'host' });

    const origin = req.headers.origin;
    if (origin && !EXTENSION_ORIGIN.test(origin)) {
      return reply(res, 403, { rejected: true, reason: 'web-origin', detail: 'Web pages cannot use the door. Only the extension can.' });
    }

    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      return reply(res, 200, { ok: true, door: 'forge-federation', version: 1 });
    }

    if (!sameToken(req.headers['x-forge-door'], token)) {
      return reply(res, 401, { rejected: true, reason: 'pairing', detail: 'Missing or wrong pairing code.' });
    }

    if (req.method === 'GET' && url.pathname === '/link') {
      reload(desk.passport);
      minds.load();
      const tab = url.searchParams.get('url');
      const who = tab ? minds.link(tab) : null;
      if (who && who.rejected) return reply(res, 400, who);
      return reply(res, 200, {
        ok: true,
        slug: desk.passport.slug,
        ai: who ? who.ai : null,
        name: who ? displayName(who.ai) : null,
        conversation: who ? who.conversation : null,
        text: briefing(desk, { minds, url: tab, full: url.searchParams.get('full') === '1' }),
        memories: desk.passport.live().map((m) => m.proposition),
        own: who ? minds.liveIn(who.ai).map((m) => m.fact) : [],
      });
    }

    if (req.method === 'GET' && url.pathname === '/minds') {
      minds.load();
      return reply(res, 200, {
        ok: true,
        shareAt: SHARE_AT,
        chain: minds.verify(),
        roster: minds.roster(),
        conversations: minds.conversations().slice(0, 100),
        pool: minds.pool().length,
        shared: minds.shared(),
      });
    }

    if (req.method === 'POST' && (url.pathname === '/forget' || url.pathname === '/retract')) {
      let body;
      try { body = await readJson(req); } catch (e) { return reply(res, e.code || 400, { rejected: true, reason: 'body' }); }
      minds.load();
      if (url.pathname === '/retract') {
        const r = minds.retract(String(body.id || ''));
        return reply(res, r.rejected ? 404 : 200, r);
      }
      const facts = (Array.isArray(body.facts) ? body.facts : []).map(String).filter((f) => f.trim()).slice(0, MAX_FACTS);
      if (!facts.length) return reply(res, 400, { rejected: true, reason: 'empty' });
      const r = minds.forget(String(body.url || ''), facts);
      return reply(res, r.rejected ? 400 : 200, r);
    }

    if (req.method === 'POST' && url.pathname === '/remember') {
      let body;
      try { body = await readJson(req); } catch (e) { return reply(res, e.code || 400, { rejected: true, reason: 'body' }); }
      const facts = (Array.isArray(body.facts) ? body.facts : [body.fact])
        .map((f) => String(f || '').trim())
        .filter(Boolean)
        .slice(0, MAX_FACTS);
      if (!facts.length) return reply(res, 400, { rejected: true, reason: 'empty' });

      // An AI's own choice: straight into its lane, tagged with the chat.
      if (body.by === 'ai') {
        minds.load();
        const r = minds.remember(String(body.url || ''), facts);
        return reply(res, r.rejected ? 400 : 200, r);
      }

      // Otherwise the human typed it: the repository passport, witness human.
      const source = cleanSource(body.source || (identify(String(body.url || '')) || {}).ai);
      const at = new Date().toISOString();
      reload(desk.passport);
      const results = facts.map((f, i) => {
        // The human clicked Save on this line; that click is the witness.
        const r = desk.save(f, { witness: 'human', reference: `door:${source}:${at}:${i}` });
        return r.rejected ? { fact: f, rejected: true, reason: r.reason } : { fact: r.memory.proposition, action: r.action };
      });
      return reply(res, 200, { ok: true, saved: results.filter((r) => !r.rejected), rejected: results.filter((r) => r.rejected) });
    }

    return reply(res, 404, { rejected: true, reason: 'not-found' });
  };
}

function listen({ desk, token, minds, port = DEFAULT_PORT, host = '127.0.0.1' }) {
  const handle = createDoor({ desk, token, minds });
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => reply(res, 500, { rejected: true, reason: 'crash', detail: String((err && err.message) || err) }));
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

module.exports = { createDoor, listen, briefing, loadOrCreateToken, tokenPath, hostIsLoopback, DEFAULT_PORT };
