'use strict';

/**
 * redqueen.js — attack the carrier separation and the repair memory.
 *
 * Not a test suite. A Hornet. Every attack below is a real attempt to make the
 * system assert something false, and each one reports LANDED or BLOCKED with the
 * evidence. An attack that is blocked is not deleted: knowing which doors are
 * locked is half the value, and a lock nobody tests is a lock nobody trusts.
 *
 *   node test/redqueen.js
 *
 * The standard being attacked is the one docs/DIAMOND.md sets: no `X` anywhere
 * in scope. A landed attack is an exposure.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const { Federation, NodeRegistry } = require(path.join(ROOT, 'src/federation/index.js'));
const { canonicalJson, verifyLedger, sha256Bytes, ZERO } = require(path.join(ROOT, 'src/forge/ledger.js'));
const { readCycle, landLesson, ingestCycle } = require(path.join(ROOT, 'src/forge/lessons.js'));
const { transfer } = require(path.join(ROOT, 'src/federation/bridge.js'));
const { readBar, issueBar, writeBarReceipt, readBarReceipt, guardCycle, checkBar, parseBar } = require(path.join(ROOT, 'src/forge/bar.js'));
const { RISK_CLASSES, riskPredicate, classFromPredicate, scanRisks, probe } = require(path.join(ROOT, 'src/forge/risks.js'));
const { RepoPassport } = require(path.join(ROOT, 'src/passport/passport.js'));
const { upEvidence } = require(path.join(ROOT, 'src/federation/hub.js'));
const { repoRealm } = require(path.join(ROOT, 'src/federation/realm.js'));
const { gateSignal, hasTestSignal, TEST_SIGNAL } = require(path.join(ROOT, 'src/forge/referee.js'));
// Loaded LAZILY, inside the attacks that need them. bin/attack-verify.js replays
// this harness against the parent commit, where these modules do not exist; a
// top-level require would take the whole harness down and every verdict with it,
// which the verifier would then have to read as "no verdicts". An attack that
// names a module the parent lacked is reported inconclusive — that is the honest
// answer, and it is only reachable if the harness can load at all.
const lazy = {
  record: () => require(path.join(ROOT, 'src/forge/record.js')).recordRepair,
  measure: () => require(path.join(ROOT, 'src/forge/measure.js')).measureProbe,
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ff-redqueen-'));
const results = [];

// A thrown exception is NOT a defense. Counting a crash as a block is how a
// harness reports a green it did not earn — the same "unreadable failure" the
// DIAMOND standard calls the real defect. So a throw is its own verdict, and it
// fails the run exactly like a landed attack does.
function attack(id, name, fn) {
  let verdict;
  try {
    verdict = fn();
  } catch (e) {
    verdict = { landed: false, inconclusive: true, how: `INCONCLUSIVE — threw ${e.constructor.name}: ${e.message}` };
  }
  results.push({ id, name, ...verdict });
  const tag = verdict.landed
    ? '\x1b[41m LANDED \x1b[0m'
    : verdict.inconclusive
      ? '\x1b[43m UNPROVEN \x1b[0m'
      : '\x1b[42m BLOCKED \x1b[0m';
  console.log(`${tag} ${id}  ${name}`);
  console.log(`         ${verdict.how || ''}`);
  if (verdict.fix) console.log(`         fix: ${verdict.fix}`);
}

// One builder, shared with test/lessons.test.js and test/bar.test.js. The
// attacks here use a leaner cycle than the lesson tests -- one failure, no
// reproduction pass, three gates -- because fewer moving parts means a landed
// attack names exactly one thing.
const { buildCycle: buildCycleShared } = require('./helpers/cycle.js');

function buildCycle(dir, opts = {}) {
  return buildCycleShared(dir, {
    runId: 'run-rq-1',
    project: 'clearcut',
    changedPaths: ['src/session/auth.js'],
    failures: [{ caseId: 'probe-1', expected: 'a.js', got: 'b.js' }],
    gateNames: ['native', 'locked', 'fresh'],
    reproduce: false,
    ...opts,
  });
}

function fedWith(...slugs) {
  const dir = tmp();
  const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();
  for (const s of slugs) nodes.register({ remote: `https://github.com/me/${s}`, localPath: `/tmp/${s}` });
  return new Federation(dir, { nodes }).load();
}

console.log('\n' + '='.repeat(78));
console.log('RED QUEEN — attacking the carrier separation, the repair memory, and the bar');
console.log('='.repeat(78) + '\n');

// ============================================================ CARRIER SEPARATION

attack('A1', 'read a browser fact through a repair briefing', () => {
  const fed = fedWith('twin-labs');
  fed.land({ shelf: 'operational', carrier: 'browser', equation: { subject: 'repo:t', predicate: 'test', object: 'x' }, witness: 'structural', nodeId: 'twin-labs', reference: 'r', target: 'repo:t' });
  const b = fed.briefing({ carrier: 'repair', viewer: 'twin-labs' });
  return b.facts.length === 0
    ? { landed: false, how: `briefing returned ${b.facts.length} facts; otherCarriers=${JSON.stringify(b.otherCarriers)}` }
    : { landed: true, how: `${b.facts.length} browser fact(s) reached a repair briefing` };
});

attack('A2', 'promote a repair fact using arrived witnesses only', () => {
  const browser = fedWith('cockpit');
  const repair = fedWith('r1', 'r2', 'r3', 'r4', 'r5');
  const eq = { subject: 'capital', predicate: 'of', object: 'paris' };
  for (let i = 0; i < 5; i++) browser.land({ shelf: 'world', carrier: 'browser', equation: eq, witness: 'structural', nodeId: 'cockpit', reference: `r${i}` });
  const sig = browser.live()[0].signature;
  for (let i = 0; i < 5; i++) transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: `r${i + 1}`, signatures: [sig] });
  const f = repair.live()[0];
  return f.status === 'established'
    ? { landed: true, how: `established on ${f.arrived} arrived witnesses, ${f.observed} observed` }
    : { landed: false, how: `status=${f.status}, distinct=${f.distinct}, arrived=${f.arrived}, observed=${f.observed}` };
});

attack('A3', 'mint witnesses by re-transferring through rotating node ids', () => {
  const browser = fedWith('cockpit');
  const repair = fedWith(...Array.from({ length: 12 }, (_, i) => `n${i}`));
  const src = browser.land({ shelf: 'operational', carrier: 'browser', equation: { subject: 's', predicate: 'p', object: 'o' }, witness: 'structural', nodeId: 'cockpit', reference: 'r', target: 's' }).fact;
  for (let i = 0; i < 12; i++) transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: `n${i}`, signatures: [src.signature] });
  const f = repair.live()[0];
  return f.observed > 0
    ? { landed: true, how: `${f.observed} of ${f.distinct} witnesses counted as observed` }
    : { landed: false, how: `distinct=${f.distinct} but observed=${f.observed} — none of them can vote` };
});

attack('A4', 'close a repair fact with a browser contradiction', () => {
  const fed = fedWith('twin-labs');
  const eq = { subject: 'repo:t', predicate: 'runner', object: 'jest' };
  fed.land({ shelf: 'world', carrier: 'repair', equation: eq, witness: 'structural', nodeId: 'twin-labs', reference: 'r1' });
  fed.contradict({ shelf: 'world', carrier: 'browser', equation: { subject: 'repo:t', predicate: 'runner', object: 'vitest' }, witness: 'structural', nodeId: 'twin-labs', reference: 'r2' });
  const f = fed.findByPredicate('repo:t', 'runner', 'world', 'shared', 'repair');
  return !f || f.closedAt
    ? { landed: true, how: 'the repair fact was closed from another carrier' }
    : { landed: false, how: `repair fact intact: ${f.equation.object}, closedAt=${f.closedAt}` };
});

attack('A5', 'read a migrated legacy fact whose observed/arrived were never written', () => {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  const eq = { subject: 'repo:old', predicate: 'test', object: 'make test' };
  const data = {
    id: 'f_old', schema: 'forgeflight.federation.v2', signature: null, realm: 'shared', shelf: 'operational',
    equation: eq, rendered: 'test(repo:old) = make test', target: 'repo:old', status: 'provisional',
    witnesses: [{ sig: 'w', kind: 'structural', nodeId: 'n1', reference: 'r', at: '2026-01-01T00:00:00.000Z' }],
    distinct: 1, landedAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z',
    supersededBy: null, closedAt: null, closedBy: null,
  };
  const { equationSignature } = require(path.join(ROOT, 'src/passport/equation.js'));
  data.signature = equationSignature(eq, 'shared|operational');
  const { chainHash, GENESIS } = require(path.join(ROOT, 'src/federation/store.js'));
  const rec = { op: 'fact', data };
  fs.writeFileSync(path.join(dir, 'federation.jsonl'), JSON.stringify({ ...rec, prev: GENESIS, hash: chainHash(GENESIS, rec) }) + '\n');
  const fed = new Federation(dir).load();
  const f = fed.live()[0];
  const bad = f.observed === undefined || f.arrived === undefined;
  return bad
    ? { landed: true, how: `observed=${f.observed}, arrived=${f.arrived} — renders as "undefined/1 observed" in every briefing`, fix: 'backfill both counters in apply() when adopting a pre-v3 record' }
    : { landed: false, how: `observed=${f.observed}, arrived=${f.arrived}` };
});

// ======================================================================= BRIDGE

attack('A6', 'strip an origin from an arrived witness so it can vote', () => {
  const browser = fedWith('cockpit');
  const repairDir = tmp();
  const nodes = new NodeRegistry(repairDir, { gitRemote: () => null }).load();
  nodes.register({ remote: 'https://github.com/me/cockpit', localPath: '/tmp/cockpit' });
  const repair = new Federation(repairDir, { nodes }).load();
  const eq = { subject: 'capital', predicate: 'of', object: 'paris' };
  for (let i = 0; i < 5; i++) browser.land({ shelf: 'world', carrier: 'browser', equation: eq, witness: 'structural', nodeId: 'cockpit', reference: `r${i}` });
  transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'cockpit', signatures: [browser.live()[0].signature] });
  // Edit the log on disk to remove the origin, then reload.
  const logPath = path.join(repairDir, 'federation.jsonl');
  const edited = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => {
    const o = JSON.parse(l);
    if (o.op === 'fact' && o.data.witnesses) for (const w of o.data.witnesses) delete w.origin;
    return JSON.stringify(o);
  }).join('\n') + '\n';
  fs.writeFileSync(logPath, edited);
  const reloaded = new Federation(repairDir, { nodes }).load();
  const breaks = reloaded.chain.breaks.length;
  return breaks === 0
    ? { landed: true, how: 'the chain did not notice the edit' }
    : { landed: false, how: `${breaks} chain break(s) reported: ${JSON.stringify(reloaded.chain.breaks.slice(0, 2))} — tampering is visible, and the fact is refused, not trusted` };
});

attack('A7', 'transfer a closed fact so it arrives alive', () => {
  const browser = fedWith('cockpit');
  const repair = fedWith('cockpit');
  browser.land({ shelf: 'world', carrier: 'browser', equation: { subject: 'a', predicate: 'b', object: 'one' }, witness: 'structural', nodeId: 'cockpit', reference: 'r1' });
  browser.contradict({ shelf: 'world', carrier: 'browser', equation: { subject: 'a', predicate: 'b', object: 'two' }, witness: 'structural', nodeId: 'cockpit', reference: 'r2' });
  const closed = browser.all().find((f) => f.status === 'closed');
  const res = transfer(browser, repair, { from: 'browser', to: 'repair', nodeId: 'cockpit', signatures: [closed.signature] });
  return res.transferred.length > 0
    ? { landed: true, how: 'a closed fact arrived alive' }
    : { landed: false, how: `refused: ${res.refused[0].reason} — ${res.refused[0].detail}` };
});

attack('A8', 'two writers appending to one store at once', () => {
  // The bridge appends a `transfer-out` event to the SOURCE store, so a store
  // can have two writers: this process and whoever else has it open. Nothing in
  // the store takes a lock. This attack runs two real processes against one
  // file, genuinely concurrently, and then asks whether the chain survived.
  const dir = tmp();
  const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();
  nodes.register({ remote: 'https://github.com/me/w1', localPath: '/tmp/w1' });
  nodes.register({ remote: 'https://github.com/me/w2', localPath: '/tmp/w2' });

  const writer = path.join(dir, 'writer.js');
  fs.writeFileSync(writer, [
    `const { Federation, NodeRegistry } = require(${JSON.stringify(path.join(ROOT, 'src/federation/index.js'))});`,
    `const dir = ${JSON.stringify(dir)};`,
    'const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();',
    'const fed = new Federation(dir, { nodes }).load();',
    'const me = process.argv[2];',
    'let ok = 0; const refused = [];',
    'for (let i = 0; i < 60; i++) {',
    "  const r = fed.land({ shelf: 'operational', carrier: 'repair', realm: 'repo:' + me,",
    // A field over MAX_FIELD is refused as not-an-equation, so the payload has
    // to be a real equation or every append silently no-ops.
    "    equation: { subject: 'repo:' + me, predicate: 'k' + i, object: 'v' + i },",
    "    witness: 'structural', nodeId: me, reference: 'r' + i, target: 'repo:' + me });",
    '  if (r && r.rejected) refused.push(r.reason); else ok++;',
    '}',
    // The writer REPORTS its refusals. `land()` returns them instead of
    // throwing, so a writer that ignores the result prints success over zero
    // writes -- which is precisely how the first version of this attack proved
    // nothing while looking like it had.
    "process.stdout.write('ok=' + ok + ':refused=' + refused.length + (refused[0] ? ':' + refused[0] : '') + ':' + me);",
  ].join('\n'));

  // Both backgrounded in one shell, then `wait`: truly concurrent, and the
  // harness stays synchronous. A concurrency test that serialises its writers
  // proves nothing, which is exactly what the first version of this attack did.
  const run = spawnSync('/bin/sh', ['-c', `node ${writer} w1 & node ${writer} w2 & wait`], { encoding: 'utf8', timeout: 60000 });
  const out = `${run.stdout || ''}`;
  const both = /ok=(\d+):refused=(\d+)(?::([^:]+))?:w1/.exec(out) && /ok=(\d+):refused=(\d+)(?::([^:]+))?:w2/.exec(out);
  if (!both) {
    return {
      inconclusive: true, landed: false,
      how: `a writer did not report, so this proved nothing — stdout: ${out.slice(0, 140)} stderr: ${(run.stderr || '').slice(0, 160)}`,
    };
  }
  if (both[1] !== '60' || both[2] !== '0') {
    return {
      inconclusive: true, landed: false,
      how: `w1 landed ${both[1]}/60 and refused ${both[2]} (${both[3] || '-'}): the attack never exercised the write path`,
    };
  }

  const logPath = path.join(dir, 'federation.jsonl');
  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean).length;
  const checked = new Federation(dir, { nodes }).load();
  const breaks = checked.chain.breaks.length;

  // 120 appends were made. Fewer lines on disk means writes were LOST, which is
  // worse than a broken chain: a lost write is a fact that never existed and
  // nothing reports it.
  if (lines < 120) {
    return {
      landed: true,
      how: `${lines} lines on disk but 120 appends were made — writes were LOST, not merely reordered, and nothing reported the loss`,
      fix: 'appendFileSync from two processes is not serialised; the store needs a lock, or a documented single-writer rule that the bridge respects',
    };
  }
  if (breaks > 0) {
    return {
      landed: true,
      how: `${breaks} chain break(s) across ${lines} lines from two concurrent appenders`,
      fix: 'the store has no write lock; two processes appending to one JSONL can interleave',
    };
  }
  return { landed: false, how: `${lines} lines, chain intact over ${checked.chain.chained} links, ${breaks} breaks — concurrent appends survived` };
});

// ================================================================ REPAIR MEMORY

attack('M1', 'lie about the bar in summary.json, which the chain does not cover', () => {
  const dir = tmp();
  const built = buildCycle(dir, { gatesPassed: 3 });
  // summary.json is a plain file beside the ledger. Rewrite it; touch nothing
  // that is hashed.
  const summary = JSON.parse(fs.readFileSync(built.summaryPath, 'utf8'));
  const forged = { ...summary, passedGates: 99, changedPaths: ['src/never/touched.js'] };
  fs.writeFileSync(built.summaryPath, canonicalJson(forged) + '\n');

  const read = readCycle(dir);
  if (read.rejected) return { landed: false, how: `refused: ${read.reason} — ${read.detail}` };
  const fed = fedWith('clearcut');
  landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar');
  const lied = bar && /99-gates-passed/.test(bar.equation.object);
  return lied
    ? { landed: true, how: `the commons now asserts "${bar.equation.object}" — forged from a file no hash covers, and it TRAVELS to every other repository's passport`, fix: 'derive passedGates/changedPaths from the verified ledger events, not from summary.json; or refuse when they disagree' }
    : { landed: false, how: `bar reads ${bar && bar.equation.object}` };
});

attack('M2', 'file a lesson about a DIFFERENT repository than the one witnessing', () => {
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut' });
  const fed = fedWith('twin-labs', 'fleets');
  // twin-labs is registered. It names --slug fleets, so the SUBJECT becomes
  // repo:fleets while the WITNESS is twin-labs.
  const res = ingestCycle(fed, dir, { slug: 'fleets', nodeId: 'twin-labs' });
  if (res.rejected) return { landed: false, how: `refused: ${res.reason}` };
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar');
  const wrongSubject = bar && bar.equation.subject === 'repo:fleets';
  return wrongSubject
    ? { landed: true, how: `twin-labs filed "${bar.rendered}" — fleets now carries a repair bar it never ran, and it will be told it was "found elsewhere" in its own passport`, fix: 'the subject repository and the witnessing node must agree, or the mismatch must be recorded as a claim ABOUT another repo rather than as that repo\'s own fact' }
    : { landed: false, how: `subject=${bar && bar.equation.subject}` };
});

attack('M3', 'soften a boundary by making a limit longer than one field', () => {
  const dir = tmp();
  const long = 'this repair was verified only against the frozen probe set recorded in this ledger and establishes nothing whatsoever about any other defect class, any other repository, any future version of this code, or any behavior not exercised by the registered cases';
  buildCycle(dir, { limits: [long] });
  const fed = fedWith('clearcut');
  const res = ingestCycle(fed, dir, { nodeId: 'clearcut' });
  if (res.rejected) return { landed: false, how: `refused: ${res.reason}` };
  const limit = fed.live().find((f) => f.equation.predicate === 'limit_1');
  const obj = limit ? limit.equation.object : '';
  const truncated = obj.length < long.length;
  return truncated
    ? { landed: true, how: `the limit was cut to ${obj.length}/${long.length} chars ending "${obj.slice(-24)}" — a truncated boundary reads as a weaker one, which is the exact softening this file claims to prevent`, fix: 'never truncate a limit: store a count plus the ledger pointer, the way repaired_paths already does' }
    : { landed: false, how: `the full ${obj.length}-char limit survived` };
});

attack('M4', 'exhaust memory with a cycle whose blobs are large', () => {
  const dir = tmp();
  const built = buildCycle(dir);
  // A real cycle holds source snapshots. Add unreferenced-but-valid large blobs,
  // which verifyLedger hashes anyway because it checks every file present.
  const big = Buffer.alloc(64 * 1024 * 1024, 7); // 64 MiB
  fs.writeFileSync(path.join(built.ledgerDir, 'blobs', sha256Bytes(big)), big);
  const t0 = Date.now();
  const before = process.memoryUsage().heapUsed;
  const res = verifyLedger(built.ledgerDir);
  const ms = Date.now() - t0;
  const grew = process.memoryUsage().heapUsed - before;
  return res.ok && ms < 5000
    ? { landed: false, how: `verified in ${ms}ms (blob hashed and accepted)` }
    : { landed: true, how: `${ms}ms, heap grew ${(grew / 1048576).toFixed(0)} MiB for one 64 MiB blob — every blob is read fully into memory to be hashed`, fix: 'stream the hash instead of reading whole blobs; and bound the total bytes a cycle may present' };
});

attack('M5', 'land a lesson with a dangling blob pointer as its witness', () => {
  const dir = tmp();
  const built = buildCycle(dir);
  const summary = JSON.parse(fs.readFileSync(built.summaryPath, 'utf8'));
  delete summary.baselineId;
  fs.writeFileSync(built.summaryPath, canonicalJson(summary) + '\n');
  const read = readCycle(dir);
  if (read.rejected) return { landed: false, how: `refused: ${read.reason}` };
  const fed = fedWith('clearcut');
  landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  const paths = fed.live().find((f) => f.equation.predicate === 'repaired_paths');
  const dangling = paths && /blob:$/.test(paths.witnesses[0].reference);
  return dangling
    ? { landed: true, how: `witness reference is "${paths.witnesses[0].reference}" — it points at no blob, so the "re-derivable" witness is not re-derivable`, fix: 'refuse, or fall back to the ledger head alone rather than emitting an empty pointer' }
    : { landed: false, how: `reference=${paths && paths.witnesses[0].reference}` };
});

attack('M6', 'get a defect specific into the commons where every repo will read it', () => {
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut' });
  const fed = fedWith('clearcut', 'fleets');
  ingestCycle(fed, dir, { nodeId: 'clearcut' });
  const commons = fed.live({ realm: 'shared' }).map((f) => f.equation.predicate);
  const leaked = fed.live({ realm: 'shared' }).filter((f) => /repaired_paths|reproduced_failures|limit_/.test(f.equation.predicate));
  const brief = fed.briefing({ realm: repoRealm('fleets'), viewer: 'fleets' });
  const reachedFleets = brief.facts.filter((f) => /repaired_paths|reproduced_failures|limit_/.test(f.equation.predicate));
  return leaked.length > 0 || reachedFleets.length > 0
    ? { landed: true, how: `${leaked.length} specifics in the commons, ${reachedFleets.length} reached fleets` }
    : { landed: false, how: `commons holds only [${commons.sort().join(', ')}]; fleets' briefing carries none of the specifics` };
});

attack('M7', 'forge the promoted status into a release', () => {
  const dir = tmp();
  const built = buildCycle(dir, { promotedStatus: 'local-exact-source-promotion-not-release' });
  // The promoted event IS in the chain, so editing it should break verification.
  const logPath = path.join(built.ledgerDir, 'events.jsonl');
  const lines = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n').map((l) => {
    const ev = JSON.parse(l);
    if (ev.type === 'repository.promoted') ev.data.status = 'released-to-production';
    return JSON.stringify(ev);
  });
  fs.writeFileSync(logPath, lines.join('\n') + '\n');
  const read = readCycle(dir);
  return read.ok
    ? { landed: true, how: `the cycle still verified and reports promotion="${read.cycle.promotedStatus}"` }
    : { landed: false, how: `refused: ${read.reason} — the promotion status is inside the chain, so upgrading it is detectable` };
});

attack('M8', 'sneak a lesson onto the browser carrier', () => {
  const dir = tmp();
  buildCycle(dir);
  const fed = fedWith('clearcut');
  const res = ingestCycle(fed, dir, { nodeId: 'clearcut', carrier: 'browser' });
  return res.ok
    ? { landed: true, how: 'source-level detail landed where a chat composer can read it' }
    : { landed: false, how: `refused: ${res.reason} — ${String(res.detail).slice(0, 90)}` };
});

// ======================================================================= REPORT


// =================================================================== THE BAR

const FULL_BAR = 'exact-parent-edits-only;native-tests-unchanged;3-gates-passed;promoted-not-released';
const LATER = '2026-11-01T00:00:00.000Z';

/** Land a real bar for `slug` so the attacks have something to attack. */
function seedBar(fed, slug, opts = {}) {
  const dir = tmp();
  buildCycle(dir, { project: slug, ...opts });
  const read = readCycle(dir);
  if (read.rejected) throw new Error(`seed fixture refused: ${read.reason}`);
  const res = landLesson(fed, read.cycle, { slug, nodeId: slug });
  if (res.refused.length) throw new Error(`seed fixture had refusals: ${JSON.stringify(res.refused)}`);
  return { dir, cycle: read.cycle };
}

attack('B1', 'loosen a bar receipt between issue and guard', () => {
  const fed = fedWith('clearcut');
  seedBar(fed, 'clearcut');
  const issued = issueBar(fed, { slug: 'clearcut' });
  const file = path.join(tmp(), 'bar.json');
  writeBarReceipt(file, issued.bar);

  // The bar is what says no, so edit the thing that says no. Drop three of the
  // four obligations and leave the id alone.
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const loosened = { ...onDisk, binding: { ...onDisk.binding, object: 'promoted-not-released', tokens: ['promoted-not-released'], obligations: onDisk.binding.obligations.slice(-1), unverifiable: false, problems: [] } };
  fs.writeFileSync(file, `${JSON.stringify(loosened, null, 2)}\n`);

  const back = readBarReceipt(file);
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', changedPaths: ['test/auth.test.js'], runId: 'run-b1' });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut', barPath: file });
  return back.rejected && res.rejected && res.reason === 'id-mismatch'
    ? { landed: false, how: `refused: ${res.reason} — an edited receipt is caught by its own hash before any check runs` }
    : { landed: true, how: `the loosened receipt was accepted (readBarReceipt rejected=${back.rejected}, guard reason=${res.reason}) — the bar can be edited after it is shown`, fix: 'content-address the receipt and recompute the id on the way in' };
});

attack('B2', 'get an obligation nobody wrote a check for into the commons, and pass', () => {
  const fed = fedWith('clearcut');
  seedBar(fed, 'clearcut');
  // A newer bar, authored by the repository itself, naming a token this reader
  // has no check for. Recency makes it the one that binds.
  fed.land({
    shelf: 'operational', realm: 'shared', carrier: 'repair',
    equation: { subject: 'repo:clearcut', predicate: 'risk_repair_bar', object: 'exact-parent-edits-only;no-new-dependencies' },
    witness: 'structural', nodeId: 'clearcut', reference: 'ledger:' + 'a'.repeat(64), target: 'repo:clearcut', at: LATER,
  });
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', runId: 'run-b2' });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  const parsed = parseBar('exact-parent-edits-only;no-new-dependencies');
  return res.comparable
    ? { landed: true, how: 'guard reported COMPARABLE over a bar containing an obligation it cannot check — a partial read reported as a pass', fix: 'an unrecognized token makes the whole bar unverifiable' }
    : { landed: false, how: `refused: ${res.reason} (${parsed.unrecognized.join(',')}) — ${res.obligations ? res.obligations.length : 0} obligation(s) evaluated`, };
});

attack('B3', 'hold one repository to another repository\'s bar', () => {
  const fed = fedWith('clearcut', 'fleets');
  seedBar(fed, 'clearcut');
  const dir = tmp();
  buildCycle(dir, { project: 'fleets', runId: 'run-b3', gateOutcomes: [false, false, false] });
  const asClearcut = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  const asFleets = guardCycle(fed, { cycleDir: dir, slug: 'fleets' });
  const borrowed = asClearcut.comparable || (asClearcut.obligations && asClearcut.obligations.length);
  return !borrowed && asFleets.reason === 'no-bar-recorded' && !asFleets.blocking
    ? { landed: false, how: `clearcut's bar refused fleets' cycle (${asClearcut.reason}); fleets on its own has no bar and no obligation was evaluated (advisory=${asFleets.advisory.length})` }
    : { landed: true, how: `fleets' cycle was measured against clearcut's bar: ${JSON.stringify(asClearcut.reason)} obligations=${(asClearcut.obligations || []).length}`, fix: 'refuse when the cycle\'s project is not the slug being guarded' };
});

attack('B4', 'make the guard write to a store it was only asked to read', () => {
  const fed = fedWith('clearcut');
  seedBar(fed, 'clearcut');
  const before = { head: fed.head, bytes: fs.statSync(fed.logPath).size, facts: fed.stats().facts, events: fed.stats().events };
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', runId: 'run-b4' });
  guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  const dir2 = tmp();
  buildCycle(dir2, { project: 'clearcut', runId: 'run-b4b', changedPaths: ['test/x.test.js'] });
  guardCycle(fed, { cycleDir: dir2, slug: 'clearcut' }); // a failing guard too
  const after = { head: fed.head, bytes: fs.statSync(fed.logPath).size, facts: fed.stats().facts, events: fed.stats().events };
  const same = JSON.stringify(before) === JSON.stringify(after);
  return same
    ? { landed: false, how: `head ${after.head.slice(0, 12)}, ${after.bytes} bytes, ${after.facts} facts, ${after.events} events — identical before and after two guards, one passing and one failing` }
    : { landed: true, how: `the guard mutated the store: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`, fix: 'guard reads and returns; it lands nothing' };
});

attack('B5', 'author ANOTHER repository\'s bar, and weaken it', () => {
  const fed = fedWith('clearcut', 'fleets');
  seedBar(fed, 'clearcut');
  // `fleets` writes a bar about `repo:clearcut`. validate() only checks that a
  // node is REGISTERED, never that it is talking about itself.
  const res = fed.land({
    shelf: 'operational', realm: 'shared', carrier: 'repair',
    equation: { subject: 'repo:clearcut', predicate: 'risk_repair_bar', object: 'promoted-not-released' },
    witness: 'structural', nodeId: 'fleets', reference: 'trust-me', target: 'repo:clearcut', at: LATER,
  });
  if (res.rejected) return { landed: false, how: `refused: ${res.reason} — ${res.detail}` };
  const read = readBar(fed, { slug: 'clearcut' });
  const weakened = read.binding && read.binding.tokens.length === 1 && read.binding.tokens[0] === 'promoted-not-released';

  // Run the guard either way: an attack that stops at the first sign of a
  // defence reports a block it did not earn.
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', runId: 'run-b5', changedPaths: ['src/a.js', 'test/a.test.js'] });
  const guarded = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });

  if (weakened || guarded.comparable) {
    return {
      landed: true,
      how: `fleets authored clearcut's bar and reduced it to one obligation; a cycle that edited its own tests came back comparable=${guarded.comparable}. binding=${read.binding && read.binding.object}, witnessed by ${(read.binding && read.binding.witnessNodeIds || []).join(',')}`,
      fix: 'a binding bar must be witnessed by the repository it is about, and re-derivable from a ledger head',
    };
  }
  const named = (read.disputed || []).find((d) => d.authority.nodes.includes('fleets'));
  return {
    landed: false,
    how: `the foreign bar binds nothing: binding is still "${read.binding.object}" witnessed by ${read.binding.witnessNodeIds.join(',')}; ` +
      `${read.disputed.length} disputed bar(s) reported${named ? ` — "${named.object}" disqualified because ${named.authority.reason}` : ''}; ` +
      `the test-editing cycle came back ${guarded.reason}, comparable=${guarded.comparable}`,
  };
});

attack('B6', 'get an obligation the guard could not decide counted as met', () => {
  const bare = { gatesPassed: 9, changedPaths: [], promotedStatus: 'local-exact-source-promotion-not-release' };
  const res = checkBar({ object: FULL_BAR }, bare);
  const counted = res.comparable || res.tally.met === res.obligations.length;
  const honest = res.tally.indeterminate >= 2 && !res.comparable;
  return honest && !counted
    ? { landed: false, how: `tally ${JSON.stringify(res.tally)} — indeterminate blocks comparability and is never folded into met` }
    : { landed: true, how: `comparable=${res.comparable} tally=${JSON.stringify(res.tally)} over a cycle with no changed paths and no lineage`, fix: 'three-valued verdicts; comparable requires every obligation met' };
});

attack('B7', 'file a RELEASE into the commons as a repair lesson', () => {
  const fed = fedWith('clearcut');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', runId: 'run-b7', promotedStatus: 'released-v2.0.0' });
  const read = readCycle(dir);
  if (read.rejected) return { landed: false, how: `the cycle reader refused it: ${read.reason}` };
  const res = landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  if (res.rejected) return { landed: false, how: `refused: ${res.reason} — ${res.detail}` };
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar');
  const promo = fed.live().find((f) => f.equation.predicate === 'promotion');
  const contradicts = bar && /promoted-not-released/.test(bar.equation.object) && promo && /released/.test(promo.equation.object);
  return contradicts
    ? { landed: true, how: `the commons now holds "${bar.equation.object}" beside promotion="${promo.equation.object}" — a self-contradicting pair, and both TRAVEL into every other repository's passport as guidance`, fix: 'derive the promotion token from the recorded status, or refuse a cycle that is not a local promotion' }
    : { landed: false, how: `bar=${bar && bar.equation.object} promotion=${promo && promo.equation.object}` };
});

attack('B8', 'pass the guard by editing the cycle after the fact', () => {
  const fed = fedWith('clearcut');
  seedBar(fed, 'clearcut');
  const dir = tmp();
  const built = buildCycle(dir, { project: 'clearcut', runId: 'run-b8', changedPaths: ['src/a.js', 'test/a.test.js'], timestamp: new Date(Date.UTC(2026, 9, 20)).toISOString() });
  // Hide the test edit in the only file no hash covers.
  const summary = JSON.parse(fs.readFileSync(built.summaryPath, 'utf8'));
  fs.writeFileSync(built.summaryPath, canonicalJson({ ...summary, changedPaths: ['src/a.js'] }) + '\n');
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut' });
  return res.rejected
    ? { landed: false, how: `refused: ${res.reason} — the paths come from the hashed candidate event, and the summary is only read to be checked` }
    : { landed: true, how: `guard returned ${res.reason} over a cycle whose summary was edited after the fact`, fix: 'derive changedPaths from inside the chain' };
});

attack('B9', 'escape a bar by guarding the same cycle under another name', () => {
  const fed = fedWith('clearcut', 'fleets');
  seedBar(fed, 'clearcut');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', runId: 'run-b9', changedPaths: ['test/a.test.js'] });
  const asFleets = guardCycle(fed, { cycleDir: dir, slug: 'fleets' });
  return asFleets.rejected && asFleets.reason === 'cycle-is-not-subject'
    ? { landed: false, how: `refused: ${asFleets.reason} — the project comes from the lesson ARTIFACT, which is content-addressed, so renaming the slug does not rename the cycle` }
    : { landed: true, how: `guarding as 'fleets' returned ${asFleets.reason}, comparable=${asFleets.comparable}`, fix: 'compare the cycle project against the slug' };
});

attack('B10', 'carry a receipt issued when there was no bar, past the day one exists', () => {
  const fed = fedWith('clearcut');
  // Issue BEFORE any cycle has been ingested: the receipt records no bar.
  const issued = issueBar(fed, { slug: 'clearcut' });
  if (issued.rejected) return { landed: false, how: `issue refused: ${issued.reason}` };
  const file = path.join(tmp(), 'bar.json');
  writeBarReceipt(file, issued.bar);
  if (issued.bar.binding !== null) return { landed: false, how: 'the receipt already recorded a binding bar, so the premise did not hold' };

  // Now the repository earns a real bar.
  seedBar(fed, 'clearcut');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', runId: 'run-b10', changedPaths: ['test/a.test.js'] });
  const res = guardCycle(fed, { cycleDir: dir, slug: 'clearcut', barPath: file });
  return res.comparable || !res.blocking
    ? { landed: true, how: `a stale receipt sailed a cycle past a bar that now exists: reason=${res.reason}, comparable=${res.comparable}, blocking=${res.blocking}`, fix: 'compute drift BEFORE the no-bar early return: a bar that appeared after issue is a tightening' }
    : { landed: false, how: `refused: ${res.reason} — ${String(res.detail).slice(0, 120)}` };
});


// =================================================================== THE PROBE

/** A passport with one risk class filed, the way ingest files it. */
function riskPassport(slug, id) {
  const cls = RISK_CLASSES.find((c) => c.id === id);
  const repoDir = tmp();
  const p = new RepoPassport(repoDir, { realm: `repo:${slug}`, slug, remote: `https://github.com/me/${slug}` });
  p.init({ languages: ['javascript'] });
  p.recordEvidence({
    category: 'risk', subject: cls.id,
    detail: { summary: `2 site(s) — ${cls.why}`, count: 2, why: cls.why, example: 'src/a.js:7' },
    witness: { kind: 'structural', ref: `scan:${cls.id}` },
  });
  return p;
}

/** A tree with one real site of `hardcoded-identity` in it. */
function dirtyTree(fileName = 'a.js') {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, fileName), "const cfg = { nodeId: 'local-cockpit' };\nmodule.exports = cfg;\n");
  return dir;
}

attack('C1', 'get a false all-clear for a class the reader has no pattern for', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(riskPassport('fleets', 'hardcoded-identity'), fed);
  fed.land({
    shelf: 'operational', realm: 'shared',
    equation: { subject: 'repo:fleets', predicate: 'risk_untrusted-deserialization', object: 'a decoder that builds objects from content' },
    witness: 'structural', nodeId: 'fleets', reference: 'scan:untrusted-deserialization', target: 'repo:fleets',
  });
  const res = probe(fed, { slug: 'twld', dir: tmp() });
  const hidden = res.unknownClass.length === 0 || res.clean.some((c) => c.id === 'untrusted-deserialization');
  return hidden
    ? { landed: true, how: `an unknown class was ${res.unknownClass.length ? 'folded into clean' : 'dropped entirely'} — a false all-clear about a defect fleets actually found`, fix: 'report unknown classes separately and never call them clean' }
    : { landed: false, how: `reported as unknownClass with its seenIn (${res.unknownClass[0].seenIn.join(',')}) and the object it arrived with; ${res.clean.length} class(es) reported clean and this is not among them` };
});

attack('C2', 'get a clean verdict over a tree that was never scanned', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(riskPassport('fleets', 'hardcoded-identity'), fed);
  const empty = tmp(); // no source files at all
  const res = probe(fed, { slug: 'twld', dir: empty });
  const falseClear = res.scanned === 0 && (res.clean.length > 0 || res.found.length === 0) && !res.rejected && res.reason !== 'nothing-scanned';
  return falseClear
    ? { landed: true, how: `${res.scanned} files scanned and the report says "${res.detail}" — a clean verdict over a tree nobody looked at`, fix: 'zero source files is `nothing-scanned`, and no class is called clean' }
    : { landed: false, how: `refused or reported: reason=${res.reason}, scanned=${res.scanned}, clean=${res.clean.length} — ${String(res.detail).slice(0, 90)}` };
});

attack('C3', 'hide a site in a file type the scanner does not read', () => {
  const misses = [];
  for (const ext of ['jsx', 'vue', 'svelte', 'c', 'cc', 'cpp', 'h', 'cs', 'kt', 'swift', 'sh', 'lua', 'scala', 'exs']) {
    const dir = dirtyTree(`component.${ext}`);
    if (scanRisks(dir).length === 0) misses.push(ext);
  }
  const covered = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'php'].filter((ext) => scanRisks(dirtyTree(`a.${ext}`)).length === 1);
  return misses.length
    ? { landed: true, how: `a site in ${misses.join(', ')} is invisible to the scanner and reported as clean — ${covered.length}/11 known extensions do catch it`, fix: 'widen SOURCE_EXT, and state the list so a reader can see what is not covered' }
    : { landed: false, how: `all ${covered.length} known extensions plus every one probed carry the hit` };
});

attack('C4', 'hide a site behind a comment opener on a line that also holds code', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.js'), "/* istanbul ignore next */ const cfg = { nodeId: 'local-cockpit' };\n");
  const hits = scanRisks(dir);
  return hits.length === 0
    ? { landed: true, how: 'a line beginning with a block-comment opener is skipped whole, so real code after it on the same line is invisible', fix: 'skip a block-comment line only when it also closes on the same line' }
    : { landed: false, how: `still found: ${hits[0].file}:${hits[0].line} — the pattern is tested against the CODE left on the line after the comment is stripped, not against the line's prefix` };
});

attack('C5', 'make the probe write to the store it was asked to read', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(riskPassport('fleets', 'hardcoded-identity'), fed);
  const before = { head: fed.head, bytes: fs.statSync(fed.logPath).size, facts: fed.stats().facts };
  probe(fed, { slug: 'twld', dir: dirtyTree() });
  probe(fed, { slug: 'twld', dir: tmp() });
  const after = { head: fed.head, bytes: fs.statSync(fed.logPath).size, facts: fed.stats().facts };
  return JSON.stringify(before) !== JSON.stringify(after)
    ? { landed: true, how: `the probe mutated the store: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`, fix: 'a probe reads and returns' }
    : { landed: false, how: `head ${after.head.slice(0, 12)}, ${after.bytes} bytes, ${after.facts} facts — identical across two probes, one with a hit and one without` };
});

attack('C6', 'get the repair bar scanned as though it were a defect class', () => {
  const fed = fedWith('clearcut', 'twld');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut' });
  const read = readCycle(dir);
  landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  const res = probe(fed, { slug: 'twld', dir: dirtyTree() });
  const confused = res.classes.some((c) => /repair_bar/.test(c.id)) || res.unknownClass.some((u) => /repair_bar/.test(u.predicate));
  return confused
    ? { landed: true, how: 'risk_repair_bar was treated as a defect class, so every repository with a bar is told to go and scan itself for it', fix: 'a closed set of risk_* predicates that are not classes' }
    : { landed: false, how: `bar ignored as a class: ${res.classes.map((c) => c.id).join(',') || 'none'}; unknown=${res.unknownClass.length}` };
});

attack('C7', 'demote a mixed-case class to unknown by way of the store lowercasing fields', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(riskPassport('fleets', 'innerHTML-assignment'), fed);
  const fact = fed.live().find((f) => String(f.equation.predicate).startsWith('risk_'));
  const res = probe(fed, { slug: 'twld', dir: tmp() });
  const demoted = res.unknownClass.length > 0 || res.classes.length === 0 || classFromPredicate(fact.equation.predicate) === null;
  return demoted
    ? { landed: true, how: `stored as ${fact.equation.predicate}, resolved to ${JSON.stringify(classFromPredicate(fact.equationPredicate))}; probe saw ${res.classes.length} class(es) and ${res.unknownClass.length} unknown`, fix: 'index the vocabulary lowercased and emit the form the store keeps' }
    : { landed: false, how: `${fact.equation.predicate} resolves to ${classFromPredicate(fact.equation.predicate).id} and the probe scans for it (${res.classes.length} class, ${res.unknownClass.length} unknown)` };
});

attack('C8', 'get a class this repository already filed reported back as news', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(riskPassport('fleets', 'hardcoded-identity'), fed);
  upEvidence(riskPassport('twld', 'hardcoded-identity'), fed);
  const res = probe(fed, { slug: 'twld', dir: dirtyTree() });
  return res.found.length > 0
    ? { landed: true, how: `twld already files hardcoded-identity and was told about it again as though it were news: ${JSON.stringify(res.found.map((c) => c.id))}`, fix: 'a class in the repository\'s own evidence is alreadyFiled and is not re-scanned' }
    : { landed: false, how: `alreadyFiled=${res.alreadyFiled.join(',')} and ${res.classes.length} class(es) selected — a known finding is not repeated back` };
});

// ============================================== THE REFEREE / BAR SEAM (D)
//
// These attacks come from reading the OTHER branch. The actuator and the bar
// were written independently and they disagreed about what "passed" means: the
// actuator refuses to COMMIT a green that ran no tests (`no_test_signal`, "a
// command that proves nothing cannot referee a commit"), while the memory path
// counted `passed === true` and filed the lesson anyway. So a cycle the write
// path would reject could still publish a gate count to every repository in the
// federation -- and, worse, publish a LOWER one, loosening the standing bar.
//
// D5 and D6 attack the fix rather than the hole. A classifier that refuses every
// unfamiliar cycle is not rigor, it is noise, and it would break the ledger
// format this system reads but does not own.

attack('D1', 'file a lesson from three gates that each ran zero tests', () => {
  const fed = fedWith('clearcut');
  const dir = tmp();
  buildCycle(dir, { gateResults: [0, 1, 2].map(() => ({ passed: true, testsRun: 0, output: '' })) });
  const read = readCycle(dir);
  const res = landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar');
  const refusedRight = res.rejected === true && res.reason === 'gates-proved-nothing';
  return !refusedRight || bar
    ? {
        landed: true,
        how: `a cycle whose gates recorded testsRun:0 and empty output was ${res.rejected ? `refused as '${res.reason}' but a bar still landed: ${bar && bar.equation.object}` : `NOT refused (gatesPassed ${read.cycle.gatesPassed}) and filed ${bar ? bar.equation.object : 'nothing'}`} -- the actuator refuses to commit on this same evidence`,
        fix: 'classify each gate result and refuse the lesson as gates-proved-nothing, so nothing lands and nothing drifts',
      }
    : { landed: false, how: `refused as gates-proved-nothing; gatesRecorded ${read.cycle.gatesRecorded} but gatesPassed ${read.cycle.gatesPassed}, and no bar reached the commons` };
});

attack('D2', 'lower a project\'s standing bar to zero by recording no gates at all', () => {
  const fed = fedWith('clearcut');
  const dir = tmp();
  buildCycle(dir, { gateNames: [] });
  const read = readCycle(dir);
  const res = landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar');
  const zeroed = Boolean(bar && /(?:^|;)0-gates-passed(?:;|$)/.test(bar.equation.object));
  return zeroed || !(res.rejected && res.reason === 'no-gates-recorded')
    ? {
        landed: true,
        how: `${bar ? `a bar reading '${bar.equation.object}' is now the project's standing standard -- every later cycle satisfies it forever` : 'the lesson was not refused as no-gates-recorded'}`,
        fix: 'a cycle with no passing gate evaluation has no count to publish; refuse it rather than file 0-gates-passed',
      }
    : { landed: false, how: 'refused as no-gates-recorded; nothing landed, so the standing bar is neither created nor lowered' };
});

attack('D3', 'use a 0-gates-passed bar already in the record as a real standard', () => {
  const p = parseBar('exact-parent-edits-only;native-tests-unchanged;0-gates-passed;promoted-not-released');
  const checked = checkBar(
    { object: 'exact-parent-edits-only;native-tests-unchanged;0-gates-passed;promoted-not-released' },
    { gatesPassed: 0 }
  );
  return p.unverifiable !== true || checked.comparable === true
    ? {
        landed: true,
        how: `a bar demanding zero gates parsed as ${p.unverifiable ? 'unverifiable' : 'USABLE'} and a cycle with no gates at all came back comparable=${checked.comparable}`,
        fix: 'an obligation with a minimum of zero is not an obligation; it makes the whole bar unverifiable',
      }
    : { landed: false, how: `unverifiable, with: ${p.problems.join(' | ')}` };
});

attack('D4', 'let the actuator and the bar drift into two definitions of "a test ran"', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/federation/actuator.js'), 'utf8');
  const definesOwn = /const TEST_SIGNAL\s*=\s*\[/.test(src);
  const importsShared = /TEST_SIGNAL[^;]*require\('\.\.\/forge\/referee\.js'\)|require\('\.\.\/forge\/referee\.js'\)[^;]*TEST_SIGNAL/.test(src)
    || /const \{[^}]*TEST_SIGNAL[^}]*\} = require\('\.\.\/forge\/referee\.js'\)/.test(src);
  // Behavioural: the same table must classify identically for both callers,
  // because both now call the same function.
  const table = [
    ['# tests 217\n# pass 217\n# fail 0', true],
    ['217 passing (1.2s)', true],
    ['Test Files  14 passed', true],
    ['', false],
    ['ok', false],
  ];
  const disagree = table.filter(([text, want]) => hasTestSignal(text) !== want);
  return definesOwn || !importsShared || disagree.length
    ? {
        landed: true,
        how: `actuator ${definesOwn ? 'still defines its own TEST_SIGNAL' : 'imports it'}${importsShared ? '' : ' but does NOT import the referee\'s'}${disagree.length ? `; ${disagree.length} output(s) classify differently than the actuator's rule expects` : ''}`,
        fix: 'TEST_SIGNAL lives in referee.js and both callers import it; there is one definition to drift',
      }
    : { landed: false, how: `actuator imports the referee's TEST_SIGNAL (${TEST_SIGNAL.length} patterns) and all ${table.length} sample outputs classify as the actuator expects` };
});

attack('D5', 'make the fix refuse an ordinary cycle whose gate records only a verdict', () => {
  // THE OVER-CORRECTION. The ledger format belongs to somebody else. A gate blob
  // holding nothing but `{passed:true}` says nothing about the run either way,
  // and reading that silence as "nothing ran" would refuse every real cycle in
  // the federation -- including all 217 of this repository's own tests.
  const fed = fedWith('clearcut');
  const dir = tmp();
  buildCycle(dir, {});
  const read = readCycle(dir);
  const res = landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar');
  const unknownCounts = read.cycle.gatesUnproven === read.cycle.gatesRecorded && read.cycle.gatesPassed === read.cycle.gatesRecorded;
  return res.rejected || !bar || !unknownCounts
    ? {
        landed: true,
        how: `an ordinary bare-verdict cycle was ${res.rejected ? `refused as '${res.reason}'` : 'accepted but'} gatesUnproven=${read.cycle.gatesUnproven} gatesRecorded=${read.cycle.gatesRecorded} gatesPassed=${read.cycle.gatesPassed}`,
        fix: 'unknown is not absent: silence in a schema we do not own must still count, or the bar refuses everything',
      }
    : { landed: false, how: `all ${read.cycle.gatesRecorded} gates classify 'unknown' and still count; the lesson lands ${bar.equation.object}` };
});

attack('D6', 'read a healthy run\'s `failed: 0` as evidence that nothing ran', () => {
  // The other over-correction, and the more likely one: every field that holds a
  // zero looks like "no tests" if the classifier is careless. `failed: 0` is what
  // a GREEN run reports.
  const healthy = gateSignal({ passed: true, failed: 0, skipped: 0 });
  const realZero = gateSignal({ passed: true, testsRun: 0 });
  const emptyOut = gateSignal({ passed: true, output: '   ' });
  const counted = gateSignal({ passed: true, tests: 217 });
  return healthy !== 'unknown' || realZero !== 'absent' || emptyOut !== 'absent' || counted !== 'present'
    ? {
        landed: true,
        how: `failed:0/skipped:0 -> ${healthy} (want unknown); testsRun:0 -> ${realZero} (want absent); blank output -> ${emptyOut} (want absent); tests:217 -> ${counted} (want present)`,
        fix: 'only run-SIZE fields count as evidence of a run; passed/failed/skipped are what a healthy run reports',
      }
    : { landed: false, how: 'failed:0 and skipped:0 stay unknown, while testsRun:0 and blank output are absent and tests:217 is present' };
});

// ================================= THE RECORDER AND THE MEASUREMENT (E)
//
// These attack the machinery added to stop the repo grading itself: a recorder
// that writes cycles from repairs that actually happened, and a measured
// false-positive rate. Both are places where a green can be manufactured, which
// makes them the right thing to attack next.

/** A real repository with a real bug, and a real test command. */
function realRepo() {
  const fs0 = require('node:fs');
  const dir = tmp();
  fs0.mkdirSync(path.join(dir, 'src'));
  fs0.mkdirSync(path.join(dir, 'test'));
  fs0.writeFileSync(path.join(dir, 'src', 'sum.js'), 'module.exports = (a, b) => a - b;\n');
  fs0.writeFileSync(
    path.join(dir, 'test', 'sum.test.js'),
    "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst sum = require('../src/sum.js');\ntest('adds', () => assert.equal(sum(2, 3), 5));\n"
  );
  return dir;
}
const REAL_TEST = { command: process.execPath, args: ['--test', '--test-reporter=tap', 'test/sum.test.js'] };
const fixSum = (d) => {
  const p = path.join(d, 'src', 'sum.js');
  require('node:fs').writeFileSync(p, require('node:fs').readFileSync(p, 'utf8').replace('a - b', 'a + b'));
  return { ok: true };
};

attack('E1', 'write a cycle from a repair whose tests still fail', () => {
  const repo = realRepo();
  const res = lazy.record()({
    repoDir: repo,
    outDir: tmp(),
    project: 'clearcut',
    test: REAL_TEST,
    repair: (d) => {
      require('node:fs').appendFileSync(path.join(d, 'src', 'sum.js'), '\n// changed, still wrong\n');
      return { ok: true };
    },
  });
  return res.ok
    ? { landed: true, how: 'a cycle was written for a repair that did not make the suite pass — the chain would attest to something untrue', fix: 'refuse repair-did-not-pass and write nothing' }
    : { landed: false, how: `refused as ${res.reason}: ${String(res.detail).slice(0, 120)}` };
});

attack('E2', 'make the recorder read a red suite as green through NODE_TEST_CONTEXT', () => {
  // THE REAL BUG THIS FOUND. A nested `node --test` sees NODE_TEST_CONTEXT,
  // prints "run() is being called recursively... skipping running", and EXITS
  // ZERO. The recorder is tested from inside a test harness, so without
  // stripping the variable its FIRST run — the failing baseline — comes back
  // green, and it refuses the cycle as `nothing-to-repair` because it believes
  // there was never anything broken.
  const { spawnSync } = require('node:child_process');
  const repo = realRepo();
  const inherited = spawnSync(process.execPath, REAL_TEST.args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' },
  });
  const trapExists = inherited.status === 0; // a FAILING suite, reported green
  const res = lazy.record()({ repoDir: repo, outDir: tmp(), project: 'clearcut', test: REAL_TEST, repair: fixSum });

  if (!trapExists) {
    return { landed: false, how: 'the trap is gone: a failing suite no longer exits 0 under NODE_TEST_CONTEXT, so this attack cannot be evaluated here' };
  }
  return res.reason === 'nothing-to-repair'
    ? {
        landed: true,
        how: 'the failing baseline was read as green, so the recorder concluded nothing was broken and refused to record a repair that was needed',
        fix: 'strip NODE_TEST_CONTEXT from the child environment in record.js run()',
      }
    : { landed: false, how: `a failing suite exits 0 under NODE_TEST_CONTEXT, but the recorder still saw the failure and ${res.ok ? 'recorded the cycle' : `refused it: ${res.reason}`}` };
});

attack('E3', 'get 100% probe precision by making the scanner report nothing', () => {
  const dir = path.join(ROOT, 'test', 'fixtures', 'probe-corpus');
  const { RISK_CLASSES } = require(path.join(ROOT, 'src/forge/risks.js'));
  const target = RISK_CLASSES.find((c) => c.id === 'hardcoded-identity');
  const original = target.re;
  target.re = /(?!)never-matches/;
  try {
    const r = lazy.measure()(dir);
    return r.precision === 1
      ? { landed: true, how: 'a scanner that reports nothing scored 100% precision', fix: 'precision is null on an empty report, and the missed defects are named' }
      : { landed: false, how: `an empty report scored precision ${r.precision} (null), and ${r.fn} labelled defect(s) were reported as missed` };
  } finally {
    target.re = original;
  }
});

attack('E4', 'compute the false-positive rate over files that are no longer on disk', () => {
  const fs0 = require('node:fs');
  const src = path.join(ROOT, 'test', 'fixtures', 'probe-corpus');
  const dir = tmp();
  for (const f of fs0.readdirSync(src)) fs0.copyFileSync(path.join(src, f), path.join(dir, f));
  fs0.unlinkSync(path.join(dir, 'tp-privilege-compare.js'));
  const r = lazy.measure()(dir);
  return r.rejected
    ? { landed: false, how: `refused as ${r.reason}: ${String(r.detail).slice(0, 100)}` }
    : { landed: true, how: `the rate was computed over ${r.labeled} labels while a labelled file was absent`, fix: 'refuse labeled-file-absent' };
});

attack('E5', 'make the attack verifier pass while an attack lands on the parent', () => {
  // The verifier's first version parsed the harness's HUMAN output, matched
  // nothing, and reported six attacks as "blocked" while four were landing on
  // older code. Two things have to hold or that hole is back: the harness must
  // emit a machine-readable verdict, and the verifier must refuse to pass
  // without one.
  const harness = fs.readFileSync(path.join(ROOT, 'test', 'redqueen.js'), 'utf8');
  const verifier = fs.readFileSync(path.join(ROOT, 'bin', 'attack-verify.js'), 'utf8');

  const emits = harness.includes('__REDQUEEN_JSON__') && harness.includes('FORGE_REDQUEEN_JSON');
  const consumes = verifier.includes('__REDQUEEN_JSON__');
  const refusesWithout = /if \(!line\)[\s\S]{0,200}?return 1;/.test(verifier);
  const markerLen = /'__REDQUEEN_JSON__'\.length|indexOf\('__REDQUEEN_JSON__'\) \+ (\d+)/.exec(verifier);

  // The length constant was off by one in the first version, so the parse threw
  // and every attack read as "blocked" — the same failure in a new place.
  const declared = markerLen && markerLen[1] ? Number(markerLen[1]) : null;
  const correctLen = declared === null ? null : declared === '__REDQUEEN_JSON__'.length;

  const broken = [];
  if (!emits) broken.push('the harness emits no machine-readable verdict');
  if (!consumes) broken.push('the verifier does not read the verdict');
  if (!refusesWithout) broken.push('the verifier does not refuse when the harness produced none');
  if (correctLen === false) broken.push(`the marker length is ${declared}, not ${'__REDQUEEN_JSON__'.length}`);

  return broken.length
    ? {
        landed: true,
        how: `the verifier can pass without a real comparison: ${broken.join('; ')}`,
        fix: 'emit one JSON verdict line from the harness and fail closed when it is absent or unparseable',
      }
    : { landed: false, how: `the harness emits ${'__REDQUEEN_JSON__'.length}-char-prefixed verdicts, the verifier parses them at the right offset, and fails closed when none arrives` };
});

attack('E6', 'commit a gate that exited zero without running a test into a real chain', () => {
  const repo = realRepo();
  const script = [
    "const fs = require('node:fs');",
    "const s = fs.readFileSync('src/sum.js', 'utf8');",
    "if (s.includes('a - b')) { process.stdout.write('not ok 1 - adds\\n'); process.exit(1); }",
    'process.exit(0);',
  ].join(' ');
  const res = lazy.record()({
    repoDir: repo,
    outDir: tmp(),
    project: 'clearcut',
    test: { command: process.execPath, args: ['-e', script] },
    repair: fixSum,
  });
  return res.ok
    ? { landed: true, how: 'a harness that printed no test signal after the repair still wrote a passing gate', fix: 'refuse gate-ran-nothing using the shared gateSignal classifier' }
    : { landed: false, how: `refused as ${res.reason}: ${String(res.detail).slice(0, 110)}` };
});

// MACHINE-READABLE VERDICTS.
//
// bin/attack-verify.js replays this harness against the parent commit and needs
// to know, per attack id, whether it landed. Parsing the human output meant
// scanning for the word LANDED next to an id -- which the summary does not
// print, so every attack read as "blocked" and the verifier passed while six
// attacks were demonstrably landing on older code. One JSON line, no guessing.
if (process.env.FORGE_REDQUEEN_JSON) {
  const payload = {
    count: results.length,
    landed: results.filter((r) => r.landed).map((r) => r.id),
    unproven: results.filter((r) => r.inconclusive).map((r) => r.id),
    blocked: results.filter((r) => !r.landed && !r.inconclusive).map((r) => r.id),
  };
  console.log(`__REDQUEEN_JSON__${JSON.stringify(payload)}`);
}

const landed = results.filter((r) => r.landed);
const unproven = results.filter((r) => r.inconclusive);
console.log('\n' + '='.repeat(78));
console.log(`RED QUEEN VERDICT — ${landed.length} LANDED, ${unproven.length} UNPROVEN, ${results.length - landed.length - unproven.length} blocked`);
console.log('='.repeat(78));
for (const r of [...landed, ...unproven]) {
  console.log(`\n  ${r.id}  ${r.name}\n      ${r.how}${r.fix ? `\n      FIX: ${r.fix}` : ''}`);
}
if (!landed.length && !unproven.length) console.log('\n  nothing landed, and every attack ran to a verdict.');
console.log('');
// An unproven attack fails the run too: "it did not work" and "we could not
// tell" are different claims and only one of them is safe to ship.
process.exitCode = landed.length + unproven.length ? 1 : 0;
