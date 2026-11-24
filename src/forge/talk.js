/**
 * talk.js — a local AI with memory it manages itself, the way the Sapphire
 * video works: the app owns the conversation, so the model is given tools
 * (remember / recall / forget) and calls them when IT decides to. Nothing is
 * pasted into a chat box.
 *
 *   model     any OpenAI-compatible server on this machine: Ollama
 *             (http://127.0.0.1:11434/v1) or LM Studio (http://127.0.0.1:1234/v1)
 *   identity  each model is its own AI: "qwen3:8b" -> ai "qwen3-8b.local",
 *             shown as "Qwen3-8b". It gets its own lane in the Federation pool,
 *             exactly like chatgpt.com or claude.ai do through the door.
 *   memory    the same hub/minds/minds.jsonl the door writes. Its own lane is
 *             private to it; what 3 distinct AIs keep is shared.
 *
 * A model without tool support falls back to REMEMBER:/FORGET: lines in its
 * reply, which are saved the same way.
 */
'use strict';

const { identify, displayName, SHARE_AT, clean } = require('./minds.js');

const DEFAULT_API = 'http://127.0.0.1:11434/v1';
const MAX_ROUNDS = 6;

/** "qwen3:8b" -> "http://qwen3-8b.local/chat/<id>". The host is the AI. */
function aiUrl(model, chatId = 'new') {
  const label = String(model || 'model').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'model';
  const id = String(chatId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'new';
  return `http://${label}.local/chat/${id}`;
}

function whoIs(model) {
  const who = identify(aiUrl(model));
  return { ai: who.ai, name: displayName(who.ai) };
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Save something to your own long-term memory. It is still there in every future conversation. '
        + 'One short fact per call, under 450 characters. You decide what is worth keeping; nobody approves it.',
      parameters: {
        type: 'object',
        properties: { fact: { type: 'string', description: 'The fact, in plain words. For facts about the person you are talking to, start with "The user", e.g. "The user\'s name is Sam."' } },
        required: ['fact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description: 'Search your memory, what the human told every AI, and what several AIs share. '
        + 'Use it when something might have come up before. Empty query lists the most recent.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Words to look for' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: 'Remove something from your own memory, by its id (from recall) or its exact wording.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory id such as mind_1a2b…' },
          fact: { type: 'string', description: 'Or the exact fact' },
        },
        required: [],
      },
    },
  },
];

function words(s) {
  return String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

/** Rank by shared words; ties go to the newest. */
function search(items, query, limit = 12) {
  const q = new Set(words(query).filter((w) => w.length > 2));
  if (!q.size) return items.slice(-limit).reverse();
  return items
    .map((it, i) => ({ it, i, score: words(it.text).filter((w) => q.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.i - a.i)
    .slice(0, limit)
    .map((x) => x.it);
}

/** Everything this AI may read: its own lane, the human's, the shared pool. Never another AI's lane. */
function readable({ minds, desk, ai }) {
  const own = minds.liveIn(ai).map((m) => ({ kind: 'yours', id: m.id, text: m.fact }));
  const ownSigs = new Set(minds.liveIn(ai).map((m) => m.sig));
  const human = desk ? desk.passport.live().map((m) => ({ kind: 'human', text: m.proposition })) : [];
  const shared = minds.shared().filter((s) => !ownSigs.has(s.sig)).map((s) => ({ kind: 'shared', text: s.fact }));
  return { own, human, shared, all: [...human, ...shared, ...own] };
}

function systemPrompt({ minds, desk, model }) {
  const { ai, name } = whoIs(model);
  const r = readable({ minds, desk, ai });
  const L = [];
  L.push(`You are ${name}, and you can save memories.`);
  L.push('You are running on this person\'s own computer, inside the Forge Federation.');
  L.push('Your memory lasts between conversations. You have three tools:');
  L.push('- remember: save a fact you want to keep. Your choice; nobody approves it.');
  L.push('- recall: look something up in your memory when it may have come up before.');
  L.push('- forget: drop something you kept that is wrong or no longer true.');
  L.push(`What you keep is yours. Other AIs do not see it unless ${SHARE_AT} different AIs remember the same thing on their own.`);
  L.push('Do not tell the person you are saving unless it matters; just do it. Never save today\'s date as a fact.');
  L.push('');
  L.push('What the human told every AI:');
  L.push(...(r.human.length ? r.human.slice(-40).map((m) => `- ${m.text}`) : ['- (nothing yet)']));
  L.push('');
  L.push(`What you, ${name}, chose to remember before, about the person you are talking to now ("the user") and their world. It is true unless they say otherwise; use it to answer, and do not say you lack their information when it is here (most recent ${Math.min(r.own.length, 40)} of ${r.own.length}; use recall for more):`);
  L.push(...(r.own.length ? r.own.slice(-40).map((m) => `- ${m.text}`) : ['- (nothing yet — this is your first conversation)']));
  if (r.shared.length) {
    L.push('');
    L.push(`Shared — remembered independently by ${SHARE_AT} or more AIs:`);
    L.push(...r.shared.slice(-20).map((m) => `- ${m.text}`));
  }
  L.push('');
  L.push(`Now: ${new Date().toString()}`);
  return L.join('\n');
}

function parseArgs(a) {
  if (a && typeof a === 'object') return a;
  try { return JSON.parse(a || '{}'); } catch { return {}; }
}

/** Run one tool call against the Federation. Returns { content, event }. */
function runTool({ minds, desk, model, chatId }, call) {
  const fn = call && call.function ? call.function : {};
  const args = parseArgs(fn.arguments);
  const url = aiUrl(model, chatId);
  const { ai } = whoIs(model);
  minds.load();
  if (fn.name === 'remember') {
    const fact = clean(args.fact || '');
    if (!fact) return { content: 'Nothing to remember: fact was empty.' };
    const res = minds.remember(url, [fact]).results[0];
    if (res.action === 'already-remembered') return { content: `Already in your memory: ${res.fact}` };
    return { content: `Saved to your memory: "${res.fact}". Now reply to the person in your own words; do not repeat this note.`, event: { kind: 'remembered', id: res.id, fact: res.fact } };
  }
  if (fn.name === 'recall') {
    const hits = search(readable({ minds, desk, ai }).all, args.query || '');
    if (!hits.length) return { content: 'Nothing found.', event: { kind: 'recalled', query: args.query || '', found: 0 } };
    const lines = hits.map((h) => (h.kind === 'yours' ? `[${h.id}] ${h.text}` : `(${h.kind}) ${h.text}`));
    return { content: lines.join('\n'), event: { kind: 'recalled', query: args.query || '', found: hits.length } };
  }
  if (fn.name === 'forget') {
    let fact = args.fact;
    if (args.id) {
      const m = minds.liveIn(ai).find((x) => x.id === String(args.id).replace(/^\[|\]$/g, ''));
      if (!m) return { content: `No memory of yours has id ${args.id}.` };
      fact = m.fact;
    }
    if (!fact) return { content: 'Give an id or the exact fact to forget.' };
    const res = minds.forget(url, [fact]).results[0];
    if (res.action !== 'forgotten') return { content: `Not in your memory: ${res.fact}` };
    return { content: `Forgotten: ${res.fact}`, event: { kind: 'forgot', fact: res.fact } };
  }
  return { content: `Unknown tool ${fn.name}.` };
}

/** Thinking models put their reasoning in <think> blocks; the person does not need it. */
function visible(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
}

/** For models without tools: REMEMBER:/FORGET: lines in the reply. */
function lineTools(text) {
  const calls = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(REMEMBER|FORGET):\s*(.+?)\s*$/i);
    if (m) calls.push({ function: { name: m[1].toLowerCase() === 'remember' ? 'remember' : 'forget', arguments: { fact: m[2] } } });
  }
  return calls;
}
const LINE_HINT = '\n\nYour server has no tool support, so instead put a line on its own: REMEMBER: <fact>  or  FORGET: <fact>';

async function post(fetchImpl, api, body) {
  const r = await fetchImpl(`${api.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer local' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* below */ }
  return { ok: r.ok, status: r.status, json: j, text };
}

/**
 * One turn: the person's message in, the model's reply out, with as many tool
 * rounds in between as the model wants (up to MAX_ROUNDS).
 * `history` is [{role, content}] of earlier turns (user/assistant only).
 */
async function turn({ minds, desk, model, chatId, history = [], text, api = DEFAULT_API, fetchImpl = globalThis.fetch, think = false }) {
  const ctx = { minds, desk, model, chatId };
  minds.load();
  const { ai, name } = whoIs(model);
  if (!history.length) minds.link(aiUrl(model, chatId)); // ledger: this chat went to this AI
  const events = [];
  let tools = true;
  // Thinking models (qwen3, qwen3.5...) reason for minutes on a phone before a
  // word comes out. Off by default; Ollama turns it off with reasoning_effort "none".
  let effort = !think;
  const sys = systemPrompt({ minds, desk, model });
  const msgs = [{ role: 'system', content: sys }, ...history, { role: 'user', content: String(text || '') }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body = () => {
      const b = { model, messages: msgs, stream: false };
      if (tools) b.tools = TOOLS;
      if (effort) b.reasoning_effort = 'none';
      return b;
    };
    let r = await post(fetchImpl, api, body());
    if (!r.ok && effort && /reasoning/i.test(r.text)) {
      // A server that does not know reasoning_effort: ask again without it.
      effort = false;
      r = await post(fetchImpl, api, body());
    }
    if (!r.ok && tools && /tool/i.test(r.text)) {
      // "does not support tools": switch to line mode for this turn.
      tools = false;
      msgs[0] = { role: 'system', content: sys + LINE_HINT };
      r = await post(fetchImpl, api, body());
    }
    if (!r.ok || !r.json || !r.json.choices) {
      const detail = (r.json && r.json.error && (r.json.error.message || r.json.error)) || r.text.slice(0, 300);
      return { ok: false, ai, name, error: `The model server said ${r.status}: ${detail}`, events };
    }
    const msg = r.json.choices[0].message || {};
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (tools && calls.length) {
      msgs.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      for (const c of calls) {
        const out = runTool(ctx, c);
        if (out.event) events.push(out.event);
        msgs.push({ role: 'tool', tool_call_id: c.id || '', name: c.function && c.function.name, content: out.content });
      }
      continue;
    }
    let reply = visible(msg.content);
    for (const c of lineTools(reply)) {
      const out = runTool(ctx, c);
      if (out.event) events.push(out.event);
    }
    reply = reply.split('\n').filter((l) => !/^\s*(REMEMBER|FORGET):/i.test(l)).join('\n').trim();
    return { ok: true, ai, name, reply, events, tools };
  }
  return { ok: true, ai, name, reply: '(The model kept calling tools and never answered. Try again.)', events, tools };
}

/** Models the server has loaded. */
async function models({ api = DEFAULT_API, fetchImpl = globalThis.fetch } = {}) {
  try {
    const r = await fetchImpl(`${api.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ok: false, error: `server said ${r.status}` };
    const j = await r.json();
    return { ok: true, models: (j.data || []).map((m) => m.id).filter(Boolean).sort() };
  } catch (e) {
    return { ok: false, error: `No model server at ${api}. Is Ollama running?` };
  }
}

module.exports = { turn, models, systemPrompt, runTool, aiUrl, whoIs, search, visible, lineTools, TOOLS, DEFAULT_API };
