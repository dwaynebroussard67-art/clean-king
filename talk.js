#!/usr/bin/env node
/**
 * fed talk — chat with a model on this computer that keeps its own memory.
 *
 *   node bin/talk.js                       # http://127.0.0.1:4850, Ollama on 11434
 *   node bin/talk.js --api http://127.0.0.1:1234/v1    # LM Studio instead
 *   node bin/talk.js --dir PATH            # use the passport in another repository
 *   node bin/talk.js --think               # let thinking models think first (slower)
 *
 * The model is given remember / recall / forget tools and uses them when it
 * chooses. Memories land in the same Federation pool the browser door uses,
 * in that model's own lane. Conversations are kept in <hub>/talk/.
 *
 * Only this computer can reach it, and only this page can drive it: requests
 * from any other web origin are refused, and the Host must be loopback.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { Desk } = require('../src/forge/desk.js');
const { Minds, hubDir } = require('../src/forge/minds.js');
const talk = require('../src/forge/talk.js');

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const PORT = Number(arg('--port') || process.env.FORGE_TALK_PORT || 4850);
const API = (arg('--api') || process.env.FORGE_TALK_API || talk.DEFAULT_API).replace(/\/$/, '');
const THINK = argv.includes('--think') || process.env.FORGE_TALK_THINK === '1';
const ROOT = path.resolve(__dirname, '..');
const desk = new Desk(arg('--dir') ? path.resolve(arg('--dir')) : ROOT);
const minds = new Minds();
const CHATS = path.join(hubDir(), 'talk');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function apiIsLocal(u) {
  try { return LOOPBACK.has(new URL(u).hostname) || new URL(u).hostname === '::1'; } catch { return false; }
}

// ------------------------------------------------------------------ chats
const chatFile = (id) => path.join(CHATS, `${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
function loadChat(id) { try { return JSON.parse(fs.readFileSync(chatFile(id), 'utf8')); } catch { return null; } }
function saveChat(c) { fs.mkdirSync(CHATS, { recursive: true }); fs.writeFileSync(chatFile(c.id), JSON.stringify(c, null, 1)); }
function listChats() {
  if (!fs.existsSync(CHATS)) return [];
  return fs.readdirSync(CHATS).filter((f) => f.endsWith('.json')).map((f) => {
    try { const c = JSON.parse(fs.readFileSync(path.join(CHATS, f), 'utf8')); return { id: c.id, model: c.model, title: c.title, updated: c.updated }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

// ------------------------------------------------------------------ http
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > 256 * 1024) { reject(new Error('too big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!LOOPBACK.has(host)) return send(res, 403, { ok: false, error: 'loopback only' });
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, { ok: false, error: 'other web pages cannot use this' });
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { ok: false, error: 'json only' });
  }
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/models') return send(res, 200, { ...(await talk.models({ api: API })), api: API });
    if (req.method === 'GET' && url.pathname === '/api/chats') return send(res, 200, { ok: true, chats: listChats() });
    if (req.method === 'GET' && url.pathname === '/api/chat') {
      const c = loadChat(url.searchParams.get('id') || '');
      return c ? send(res, 200, { ok: true, chat: c }) : send(res, 404, { ok: false });
    }
    if (req.method === 'GET' && url.pathname === '/api/memory') {
      minds.load();
      const { ai, name } = talk.whoIs(url.searchParams.get('model') || '');
      return send(res, 200, { ok: true, ai, name, own: minds.liveIn(ai).map((m) => ({ id: m.id, fact: m.fact, at: m.at })), human: desk.passport.live().length, shared: minds.shared().length });
    }
    if (req.method === 'POST' && url.pathname === '/api/say') {
      const b = await readBody(req);
      const model = String(b.model || '').slice(0, 120);
      const text = String(b.text || '').slice(0, 20000);
      if (!model || !text.trim()) return send(res, 400, { ok: false, error: 'pick a model and type something' });
      let c = b.id ? loadChat(b.id) : null;
      if (!c || c.model !== model) {
        c = { id: `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`, model, title: text.slice(0, 60), created: new Date().toISOString(), messages: [] };
      }
      const history = c.messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-40).map((m) => ({ role: m.role, content: m.content }));
      const r = await talk.turn({ minds, desk, model, chatId: c.id, history, text, api: API, think: THINK });
      if (!r.ok) return send(res, 502, { ok: false, error: r.error, id: c.id });
      c.messages.push({ role: 'user', content: text, at: new Date().toISOString() });
      c.messages.push({ role: 'assistant', content: r.reply, events: r.events, at: new Date().toISOString() });
      c.updated = new Date().toISOString();
      saveChat(c);
      return send(res, 200, { ok: true, id: c.id, reply: r.reply, events: r.events, name: r.name, tools: r.tools });
    }
    if (req.method === 'POST' && url.pathname === '/api/undo') {
      const b = await readBody(req);
      minds.load();
      return send(res, 200, minds.retract(String(b.id || '')));
    }
    if (req.method === 'POST' && url.pathname === '/api/tell') {
      const b = await readBody(req);
      const r = desk.save(String(b.text || ''), { witness: 'human' });
      return send(res, 200, { ok: !r.rejected, ...r });
    }
    return send(res, 404, { ok: false });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e && e.message || e) });
  }
});

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Forge Federation — Talk</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--text:#e7e9ee;--dim:#9aa3b2;--acc:#3ecf8e}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,Segoe UI,sans-serif;background:var(--bg);color:var(--text);display:grid;grid-template-columns:240px 1fr 300px;height:100vh}
aside,section{border-right:1px solid var(--line);overflow:auto;padding:14px}#mem{border-right:0;border-left:1px solid var(--line)}
h1{font-size:15px;margin:0 0 10px}h2{font-size:13px;color:var(--dim);margin:16px 0 6px;font-weight:600}
select,input,textarea,button{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px}
select{width:100%}button{cursor:pointer}button.p{background:var(--acc);color:#06281a;border:0;font-weight:600}
.chat{padding:6px 8px;border-radius:6px;cursor:pointer;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat.on,.chat:hover{background:var(--panel);color:var(--text)}
main{display:flex;flex-direction:column;height:100vh}#log{flex:1;overflow:auto;padding:18px}
.m{max-width:760px;margin:0 auto 14px;white-space:pre-wrap}.m.user{color:#cfe3ff}.m .who{font-size:12px;color:var(--dim);display:block}
.ev{max-width:760px;margin:-6px auto 12px;font-size:13px;color:var(--acc)}.ev button{font-size:12px;padding:2px 8px;margin-left:6px}
form{display:flex;gap:8px;padding:12px;border-bottom:1px solid var(--line)}form textarea{flex:1;height:60px;resize:vertical}
.f{font-size:13px;padding:6px 0;border-bottom:1px solid var(--line)}.dim{color:var(--dim);font-size:13px}
@media (max-width:820px){body{display:flex;flex-direction:column;height:auto;min-height:100vh;font-size:16px}
main{order:1;height:auto;min-height:70vh}aside{order:2;border-right:0;border-top:1px solid var(--line)}#mem{order:3;border-left:0;border-top:1px solid var(--line)}
#log{padding:12px}form textarea{height:72px;font-size:16px}button{min-height:44px}}
</style></head><body>
<aside><h1>Forge Federation</h1>
<h2>Model on this computer</h2><select id="model"></select><div id="api" class="dim"></div>
<p><button id="new">New conversation</button></p><h2>Conversations</h2><div id="chats"></div></aside>
<main><form id="f"><textarea id="t" autofocus placeholder="Type your message to the AI here, then press Enter"></textarea><button class="p">Send</button></form>
<div id="log"><p class="dim m">Type in the box above and press Enter. The AI keeps its own memory and decides what to save.</p></div></main>
<section id="mem"><h1 id="memname">Memory</h1><div id="memlist" class="dim"></div>
<h2>A note for every AI (not the chat)</h2><input id="tell" style="width:100%" placeholder="e.g. I live in Baton Rouge"><p><button id="tellBtn">Save note for every AI</button></p><p class="dim" id="tellst"></p></section>
<script>
const $=id=>document.getElementById(id);let chat=null;
const j=(u,b)=>fetch(u,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{}).then(r=>r.json());
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function addMsg(role,text,name){const d=el('div','m '+role);d.append(el('span','who',role==='user'?'You':name||'AI'),document.createTextNode(text));$('log').append(d);$('log').scrollTop=1e9}
function addEvents(evs){for(const e of evs||[]){const d=el('div','ev');
 if(e.kind==='remembered'){d.textContent='Remembered: '+e.fact;const b=el('button',null,'Undo');b.onclick=async()=>{await j('/api/undo',{id:e.id});d.textContent='Undone: '+e.fact;mem()};d.append(b)}
 else if(e.kind==='forgot')d.textContent='Forgot: '+e.fact;else if(e.kind==='recalled')d.textContent='Looked in memory'+(e.query?' for "'+e.query+'"':'')+' ('+e.found+' found)';
 $('log').append(d)}}
async function models(){const r=await j('/api/models');$('api').textContent=r.ok?'Server: '+r.api:r.error;$('model').innerHTML='';
 for(const m of r.models||[])$('model').append(el('option',null,m));const last=localStorage.model;if(last&&(r.models||[]).includes(last))$('model').value=last;mem()}
async function chats(){const r=await j('/api/chats');$('chats').innerHTML='';for(const c of r.chats){const d=el('div','chat'+(chat===c.id?' on':''),c.title||'(untitled)');d.title=c.model;d.onclick=()=>open(c.id);$('chats').append(d)}}
async function open(id){const r=await j('/api/chat?id='+encodeURIComponent(id));if(!r.ok)return;chat=id;$('log').innerHTML='';$('model').value=r.chat.model;
 for(const m of r.chat.messages){addMsg(m.role,m.content,r.chat.model);if(m.events)addEvents(m.events)}chats();mem()}
async function mem(){const m=$('model').value;if(!m)return;localStorage.model=m;const r=await j('/api/memory?model='+encodeURIComponent(m));
 $('memname').textContent=r.name+"'s memory ("+r.own.length+')';$('memlist').innerHTML='';
 if(!r.own.length)$('memlist').append(el('p','dim','Nothing saved yet. It decides what to keep.'));
 for(const f of r.own.slice().reverse()){const d=el('div','f',f.fact);$('memlist').append(d)}
 $('memlist').append(el('p','dim','It can also read '+r.human+' thing(s) you told every AI and '+r.shared+' shared memory(ies).'))}
$('model').onchange=()=>{chat=null;$('log').innerHTML='';mem();chats();$('t').focus()};
$('new').onclick=()=>{chat=null;$('log').innerHTML='';chats();$('t').focus()};
$('t').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('f').requestSubmit()}});
$('f').onsubmit=async e=>{e.preventDefault();const text=$('t').value.trim();if(!text)return;$('t').value='';const intro=$('log').querySelector('p.dim');if(intro&&!chat)intro.remove();addMsg('user',text);
 const wait=el('p','dim m','Thinking…');$('log').append(wait);
 const r=await j('/api/say',{id:chat,model:$('model').value,text}).catch(()=>({ok:false,error:'the talk window stopped'}));wait.remove();
 if(!r.ok){addMsg('assistant','[error] '+r.error,'');return}chat=r.id;addMsg('assistant',r.reply,r.name);addEvents(r.events);chats();mem()};
$('tellBtn').onclick=async()=>{const v=$('tell').value.trim();if(!v)return;$('tell').value='';
 const r=await j('/api/tell',{text:v});$('tellst').textContent=r.ok?'Saved for every AI.':'Not saved: '+(r.reason||r.error||'');mem();$('t').focus()};
models();chats();$('t').focus();
</script></body></html>`;

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('FORGE FEDERATION — TALK');
  console.log(`  open        http://127.0.0.1:${PORT}   (this computer only)`);
  console.log(`  models      ${API}${apiIsLocal(API) ? '' : '   (NOT on this computer — your words go there)'}`);
  console.log(`  memory      ${minds.file}`);
  console.log(`  chats       ${CHATS}`);
  console.log('');
  console.log(`  thinking    ${THINK ? 'on (--think)' : 'off — faster; add --think to turn it on'}`);
  console.log('  Leave this window open while you chat. Ctrl+C to stop.');
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `  port ${PORT} is busy — is Talk already open?` : String(e));
  process.exit(1);
});
