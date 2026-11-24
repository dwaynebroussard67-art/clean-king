#!/usr/bin/env node
/**
 * fed desk — talk, with the passport in the room.
 *
 *   node bin/desk.js              # page on 127.0.0.1:4747 (this computer only)
 *   node bin/desk.js --once "remember I prefer dark roast"
 */
'use strict';

const http = require('node:http');
const path = require('node:path');
const { Desk } = require('../src/forge/desk.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.FORGE_DESK_PORT || 4747);
// Loopback by default. 0.0.0.0 put the passport's write path on every network
// the machine joined; set FORGE_DESK_HOST=0.0.0.0 only on purpose.
const HOST = process.env.FORGE_DESK_HOST || '127.0.0.1';

const desk = new Desk(process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : ROOT);

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Forge desk</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font: 15px/1.45 system-ui, sans-serif; background:#111; color:#eee; }
  main { display:grid; grid-template-columns: 1fr 1fr; min-height:100vh; }
  @media (max-width: 800px) { main { grid-template-columns: 1fr; } }
  section { display:flex; flex-direction:column; min-height:50vh; }
  h1 { font-size:14px; letter-spacing:.08em; text-transform:uppercase; margin:0; padding:12px 16px; border-bottom:1px solid #333; }
  pre { flex:1; margin:0; padding:16px; overflow:auto; white-space:pre-wrap; color:#cfc; }
  #log { flex:1; overflow:auto; padding:16px; }
  .u { color:#9cf; margin:0 0 8px; }
  .a { color:#eee; margin:0 0 16px; }
  .s { color:#8c8; font-size:13px; }
  form { display:flex; gap:8px; padding:12px; border-top:1px solid #333; }
  input { flex:1; background:#1b1b1b; color:#eee; border:1px solid #444; padding:10px 12px; border-radius:6px; }
  button { background:#3a6; color:#041; border:0; padding:10px 16px; border-radius:6px; font-weight:700; cursor:pointer; }
  button.mic { background:#246; color:#def; min-width:48px; }
  button.mic.hot { background:#a33; color:#fff; }
  label.hear { display:flex; align-items:center; gap:6px; color:#aaa; font-size:13px; white-space:nowrap; }
  .hint { padding:8px 16px; color:#888; font-size:13px; }
</style>
</head>
<body>
<main>
  <section>
    <h1>Passport</h1>
    <pre id="pass"></pre>
  </section>
  <section>
    <h1>Desk</h1>
    <p class="hint">Every turn the model reads that passport. Type or speak <code>remember …</code> to write it. Mic and speaker use this browser — allow the microphone when asked. Ollama (11434) or LM Studio (1234) talks if running.</p>
    <div id="log"></div>
    <form id="f">
      <button type="button" class="mic" id="mic" title="Hold a conversation — click to listen">Mic</button>
      <input id="q" autocomplete="off" placeholder="say something, or: remember I drink dark roast"/>
      <button type="submit">Send</button>
      <label class="hear"><input type="checkbox" id="hear" checked/> Speak</label>
    </form>
  </section>
</main>
<script>
const log = document.getElementById('log');
const pass = document.getElementById('pass');
const q = document.getElementById('q');
const hear = document.getElementById('hear');
const micBtn = document.getElementById('mic');
async function loadPass() {
  const r = await fetch('/passport');
  pass.textContent = await r.text();
}
loadPass();
function speak(text) {
  if (!hear.checked || !text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02;
  window.speechSynthesis.speak(u);
}
async function sendText(text) {
  if (!text) return;
  q.value = '';
  log.insertAdjacentHTML('beforeend', '<p class="u"></p>');
  log.lastChild.textContent = 'You: ' + text;
  const r = await fetch('/chat', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ text }) });
  const j = await r.json();
  const p = document.createElement('p');
  p.className = 'a';
  p.textContent = j.reply || JSON.stringify(j);
  log.appendChild(p);
  if (j.saved && j.saved.length) {
    const s = document.createElement('p');
    s.className = 's';
    s.textContent = 'Saved: ' + j.saved.join(' · ');
    log.appendChild(s);
  }
  log.scrollTop = log.scrollHeight;
  loadPass();
  speak(j.speak || j.reply || '');
}
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  await sendText(q.value.trim());
});
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Rec) {
  micBtn.disabled = true;
  micBtn.title = 'This browser has no speech recognition';
} else {
  const rec = new Rec();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.continuous = false;
  rec.onstart = () => micBtn.classList.add('hot');
  rec.onend = () => micBtn.classList.remove('hot');
  rec.onerror = () => micBtn.classList.remove('hot');
  rec.onresult = (ev) => {
    const said = ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript;
    if (said) sendText(said.trim());
  };
  micBtn.addEventListener('click', () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    try { rec.start(); } catch (e) { /* already started */ }
  });
}
</script>
</body>
</html>
`;

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'content-type': type,
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://desk.local');
  // The page is served from this origin, so it never needs CORS. Any other
  // site asking is a web page trying to write the passport: refuse it.
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) {
    send(res, 403, JSON.stringify({ rejected: true, reason: 'cross-origin' }));
    return;
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    send(res, 200, PAGE, 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/passport') {
    send(res, 200, desk.boot(), 'text/markdown; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/status') {
    const found = await desk.discover();
    send(res, 200, JSON.stringify({ ok: true, model: found && found.model, endpoint: found && found.endpoint }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/chat') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
    const out = await desk.turn(body.text || body.message || '');
    send(res, out.rejected ? 400 : 200, JSON.stringify(out));
    return;
  }
  send(res, 404, JSON.stringify({ rejected: true, reason: 'not-found' }));
}

async function main() {
  const once = process.argv.indexOf('--once');
  if (once !== -1) {
    const text = process.argv[once + 1] || '';
    const out = await desk.turn(text);
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
    process.exitCode = out.rejected ? 1 : 0;
    return;
  }
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      send(res, 500, JSON.stringify({ rejected: true, reason: 'crash', detail: String(err && err.message || err) }));
    });
  });
  server.listen(PORT, HOST, () => {
    console.log(`desk on http://${HOST}:${PORT}  (passport: ${desk.passport.docPath})`);
  });
}

main();
