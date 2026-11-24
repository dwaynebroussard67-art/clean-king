/**
 * desk.js — the smallest loop that makes the passport usable the way the
 * Sapphire video is usable: every turn the model reads the notebook, and it
 * can write a line into it.
 *
 * Not a persona. Not their code. A desk. Voice is the browser's own mic
 * and speaker (Web Speech) — nothing is piped through a third-party TTS.
 *
 *   - boot text is PASSPORT.md
 *   - save is passport.remember() then rewrite PASSPORT.md
 *   - a local OpenAI-compatible server (Ollama 11434 / LM Studio 1234) is
 *     optional; without it you can still type `remember …` and the file updates
 */
'use strict';

const { RepoPassport } = require('../passport/passport.js');

const MAX_MEMORY = 450;
const DEFAULT_ENDPOINTS = () => {
  const override = process.env.FORGE_DESK_LLM_URL || process.env.FORGEFLIGHT_LOCAL_LLM_URL;
  if (override) return [override.replace(/\/$/, '')];
  return ['http://127.0.0.1:11434', 'http://127.0.0.1:1234'];
};

function trimMemory(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= MAX_MEMORY) return s;
  const cut = s.slice(0, MAX_MEMORY);
  const sp = cut.lastIndexOf(' ');
  return (sp > 200 ? cut.slice(0, sp) : cut).trim();
}

function extractSaves(userText, modelText) {
  const out = [];
  const user = String(userText || '');
  const um = user.match(/^\s*remember(?:\s+that)?\s*[:\-]?\s+(.+)\s*$/i);
  if (um) out.push(trimMemory(um[1]));
  for (const line of String(modelText || '').split('\n')) {
    const m = line.match(/^\s*REMEMBER:\s*(.+)\s*$/i);
    if (m) out.push(trimMemory(m[1]));
  }
  return [...new Set(out.filter(Boolean))];
}

/** Strip tool lines so a speaker does not read REMEMBER: out loud. */
function speakable(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !/^\s*REMEMBER:\s*/i.test(line))
    .join('\n')
    .trim();
}

function instructions() {
  return [
    'You are sitting at the Forge Federation desk.',
    'The passport below is your memory. Read it. Do not invent what is not there.',
    'Reply in a few short sentences. No roleplay, no fireplace, no birthday.',
    'When the human tells you a fact worth keeping, output one extra line exactly:',
    'REMEMBER: <one short fact, no date unless they gave a date>',
    'Do not write REMEMBER for questions. Do not write REMEMBER for things already in the passport.',
  ].join('\n');
}

class Desk {
  constructor(repoDir, opts = {}) {
    this.repoDir = repoDir;
    this.passport = new RepoPassport(repoDir, {
      realm: opts.realm,
      slug: opts.slug,
      remote: opts.remote,
    }).init(opts.profile || {}).load();
    this.history = [];
    this.generate = opts.generate || null;
    this.endpoints = opts.endpoints || DEFAULT_ENDPOINTS();
    this.fetch = opts.fetch || globalThis.fetch;
  }

  boot() {
    return this.passport.render();
  }

  save(proposition, { witness = 'human', reference } = {}) {
    const text = trimMemory(proposition);
    if (!text) return { rejected: true, reason: 'empty' };
    const res = this.passport.remember({
      proposition: text,
      witness,
      reference: reference || `desk:${new Date().toISOString()}`,
    });
    if (!res.rejected) this.passport.writeDoc();
    return res;
  }

  recall(query) {
    const q = String(query || '').toLowerCase();
    const live = this.passport.live();
    if (!q) return live.slice(-12);
    return live.filter((m) => String(m.proposition || '').toLowerCase().includes(q)).slice(0, 12);
  }

  async discover() {
    for (const endpoint of this.endpoints) {
      try {
        const r = await this.fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(1200) });
        if (!r || !r.ok) continue;
        const j = await r.json();
        const model = j && Array.isArray(j.data) && j.data[0] && j.data[0].id ? j.data[0].id : 'local';
        return { endpoint, model };
      } catch {
        /* next */
      }
    }
    return null;
  }

  async complete(userText, found) {
    if (typeof this.generate === 'function') {
      return this.generate({ boot: this.boot(), text: userText, history: this.history });
    }
    if (!found) return null;
    const messages = [
      { role: 'system', content: `${instructions()}\n\n--- PASSPORT ---\n${this.boot()}` },
      ...this.history.slice(-12),
      { role: 'user', content: userText },
    ];
    const r = await this.fetch(`${found.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: found.model, messages, temperature: 0.4, max_tokens: 400 }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || null;
  }

  async turn(userText) {
    const text = String(userText || '').trim();
    if (!text) return { rejected: true, reason: 'empty' };

    const found = this.generate ? { endpoint: 'inject', model: 'inject' } : await this.discover();
    let reply = await this.complete(text, found);
    const facts = extractSaves(text, reply || '');
    const saved = facts.map((p) => this.save(p, { witness: 'human' }));
    const kept = saved.filter((s) => !s.rejected);
    if (reply == null) {
      reply = kept.length
        ? `Saved ${kept.length} memor${kept.length === 1 ? 'y' : 'ies'} to the passport. No local model is running — start Ollama or LM Studio to talk.`
        : 'No local model on 11434 or 1234. Type `remember …` to write the passport yourself, or start Ollama.';
    }
    this.history.push({ role: 'user', content: text });
    this.history.push({ role: 'assistant', content: reply });
    return {
      ok: true,
      reply,
      speak: speakable(reply),
      saved: kept.map((s) => s.memory && s.memory.proposition),
      model: found ? found.model : null,
      passport: this.passport.docPath,
    };
  }
}

module.exports = { Desk, extractSaves, trimMemory, speakable, MAX_MEMORY, instructions };
