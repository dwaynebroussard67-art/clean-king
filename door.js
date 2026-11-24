#!/usr/bin/env node
/**
 * fed door — the front door for any AI in any browser tab.
 *
 *   node bin/door.js              # listens on 127.0.0.1:4848, prints the pairing code
 *   node bin/door.js --dir PATH   # use the passport in another repository
 *   node bin/door.js --code       # print the pairing code and exit
 *   node bin/door.js --minds      # who the Federation has met, and what each kept
 *
 * Then load door/extension in Edge or Chrome, paste the pairing code once,
 * open any AI and click the Forge Federation button. See docs/DOOR.md.
 */
'use strict';

const path = require('node:path');
const { Desk } = require('../src/forge/desk.js');
const { listen, loadOrCreateToken, tokenPath, DEFAULT_PORT } = require('../src/forge/door.js');
const { Minds, SHARE_AT } = require('../src/forge/minds.js');

const argv = process.argv;
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);

const token = loadOrCreateToken();
if (argv.includes('--code')) {
  console.log(token);
  process.exit(0);
}

const minds = new Minds();
if (argv.includes('--minds')) {
  const chain = minds.verify();
  console.log(`\nTHE POOL  ${minds.file}`);
  console.log(`  chain ${chain.ok ? 'intact' : `BROKEN at ${chain.breaks.map((b) => `${b.line}:${b.kind}`).join(', ')}`} · ${chain.lines} line(s)\n`);
  const roster = minds.roster();
  if (!roster.length) console.log('  No AI has been linked yet.\n');
  for (const r of roster) {
    console.log(`  ${r.name.padEnd(14)} ${r.ai.padEnd(24)} keeps ${String(r.kept).padStart(3)} · ${r.conversations} conversation(s)`);
    for (const m of minds.liveIn(r.ai).slice(-5)) console.log(`      - ${m.fact}`);
  }
  const shared = minds.shared();
  console.log(`\n  SHARED (${SHARE_AT}+ distinct AIs): ${shared.length}`);
  for (const s of shared) console.log(`      - ${s.fact}  [${s.ais.join(', ')}]`);
  console.log('');
  process.exit(0);
}

const ROOT = path.resolve(__dirname, '..');
const dir = arg('--dir') ? path.resolve(arg('--dir')) : ROOT;
const port = Number(process.env.FORGE_DOOR_PORT || DEFAULT_PORT);
const desk = new Desk(dir);

listen({ desk, token, minds, port }).then(() => {
  console.log('');
  console.log('FORGE FEDERATION — FRONT DOOR OPEN');
  console.log(`  listening   http://127.0.0.1:${port}   (this computer only)`);
  console.log(`  passport    ${desk.passport.docPath}`);
  console.log(`  yours       ${desk.passport.live().length} memories (every AI sees these)`);
  console.log(`  the pool    ${minds.roster().length} AI(s) met · ${minds.pool().length} memories · ${minds.shared().length} shared`);
  console.log('');
  console.log('  PAIRING CODE (paste once into the extension):');
  console.log(`  ${token}`);
  console.log(`  stored in ${tokenPath()}`);
  console.log('');
  console.log('  Leave this window open. Ctrl+C closes the door.');
  console.log('');
}).catch((err) => {
  console.error(`door failed to open: ${err.message}`);
  if (err.code === 'EADDRINUSE') console.error(`  port ${port} is busy — is the door already open in another window?`);
  process.exitCode = 1;
});
