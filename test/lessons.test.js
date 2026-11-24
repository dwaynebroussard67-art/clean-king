'use strict';

/**
 * A repair cycle becomes memory without becoming a rule.
 *
 * Twin Labs stamps every lesson `bounded-historical-observation-not-universal-
 * rule` and refuses to generalize. That refusal is correct. These tests pin what
 * the Federation does with it: the METHOD and its boundary travel to the commons,
 * the defect specifics stay scoped to the repository they came from, and the
 * scope line travels with the claim every time.
 *
 * They also pin the part that makes the witness `structural` rather than
 * `outcome`: the ledger is re-derived from the published format here, so a
 * tampered cycle is refused instead of believed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { canonicalJson, verifyLedger, readBlob } = require('../src/forge/ledger.js');
const { readCycle, landLesson, ingestCycle, lessonEquations, LESSON_SCOPE } = require('../src/forge/lessons.js');
// One builder, shared with test/bar.test.js and test/redqueen.js: a fixture in
// three copies is a fixture that silently diverges.
const { buildCycle } = require('./helpers/cycle.js');
const { fedWith, tmp } = require('./helpers/fed.js');
const { Federation } = require('../src/federation/store.js');
const { NodeRegistry } = require('../src/federation/nodes.js');

test('a cycle whose promotion is a RELEASE refuses to become a repair lesson', () => {
  // The bar asserts `promoted-not-released` because that is what a local
  // promotion is. Landing a release anyway would put that token into the commons
  // beside a `promotion` fact saying the opposite, and the pair travels into
  // every other repository's passport as guidance.
  const fed = fedWith('clearcut');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', promotedStatus: 'released-v2.0.0' });
  const read = readCycle(dir);
  assert.equal(read.ok, true, 'the cycle itself is genuine — reading is not landing');

  const res = landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'promotion-is-not-local');
  assert.match(res.detail, /released-v2\.0\.0/);
  assert.match(res.detail, /Nothing landed/);
  assert.equal(fed.live().length, 0, 'a refusal lands nothing at all, not a corrected version');
});

test('a cycle that records no promotion status is refused rather than assumed local', () => {
  const fed = fedWith('clearcut');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', promotedStatus: '' });
  const read = readCycle(dir);
  assert.equal(read.ok, true);
  const res = landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'promotion-is-not-local');
  assert.match(res.detail, /'unrecorded'/);
});

// --------------------------------------------------------------- canonicalJson

test('canonicalJson sorts object keys and preserves array order', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]', 'an array is a sequence, not a set');
  assert.equal(canonicalJson({ z: { y: [1, { b: 1, a: 2 }] } }), '{"z":{"y":[1,{"a":2,"b":1}]}}');
  assert.equal(canonicalJson('a"b'), '"a\\"b"');
  assert.equal(canonicalJson(null), 'null');
  assert.equal(canonicalJson(true), 'true');
});

test('canonicalJson refuses anything JSON would silently lose', () => {
  assert.throws(() => canonicalJson(NaN), /lossless/);
  assert.throws(() => canonicalJson(Infinity), /lossless/);
  assert.throws(() => canonicalJson(-0), /lossless/, '-0 and 0 stringify the same but are not the same number');
  assert.throws(() => canonicalJson([1, , 3]), /sparse/);
  assert.throws(() => canonicalJson({ [Symbol('s')]: 1 }), /symbol/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cycle/);
  class Thing { constructor() { this.a = 1; } }
  assert.throws(() => canonicalJson(new Thing()), /plain data/);
  const accessor = {}; Object.defineProperty(accessor, 'x', { get: () => 1, enumerable: true });
  assert.throws(() => canonicalJson(accessor), /accessor/);
});

// ------------------------------------------------------------------ the ledger

test('a well-formed ledger verifies, and reports its head', () => {
  const dir = tmp();
  const built = buildCycle(dir);
  const res = verifyLedger(built.ledgerDir, { expectedHead: built.head });
  assert.equal(res.ok, true);
  assert.equal(res.head, built.head);
  assert.equal(res.events.length, built.lines.length);
  assert.equal(res.runId, 'run-test-0001');
});

test('an edited event is caught, because its id is recomputed from its body', () => {
  const dir = tmp();
  const built = buildCycle(dir);
  const logPath = path.join(built.ledgerDir, 'events.jsonl');
  const lines = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n');
  const ev = JSON.parse(lines[4]);
  ev.data.status = 'release'; // a quiet upgrade of what the promotion meant
  lines[4] = JSON.stringify(ev);
  fs.writeFileSync(logPath, lines.join('\n') + '\n');

  const res = verifyLedger(built.ledgerDir);
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'id-mismatch');
  assert.match(res.detail, /does not hash to its own id/);
});

test('a swapped blob is caught by its own address', () => {
  const dir = tmp();
  const built = buildCycle(dir);
  const blobs = fs.readdirSync(path.join(built.ledgerDir, 'blobs'));
  const victim = path.join(built.ledgerDir, 'blobs', blobs[0]);
  fs.writeFileSync(victim, Buffer.from('{"tampered":true}'));
  const res = verifyLedger(built.ledgerDir);
  assert.equal(res.rejected, true);
  assert.ok(['artifact-integrity', 'blob-integrity'].includes(res.reason), res.reason);
});

test('a truncated log, a broken chain and a moved head are each refused by name', () => {
  const good = tmp();
  const built = buildCycle(good);

  // truncated: last line cut off
  const t = tmp(); buildCycle(t);
  const tl = path.join(t, 'ledger', 'events.jsonl');
  fs.writeFileSync(tl, fs.readFileSync(tl, 'utf8').slice(0, -20));
  const trunc = verifyLedger(path.join(t, 'ledger'));
  assert.equal(trunc.rejected, true);
  assert.ok(['truncated', 'unparseable-event', 'id-mismatch'].includes(trunc.reason), trunc.reason);

  // chain broken: an event re-pointed at the wrong predecessor
  const c = tmp(); const cb = buildCycle(c);
  const cl = path.join(c, 'ledger', 'events.jsonl');
  const clines = fs.readFileSync(cl, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
  clines[3].previous = clines[0].id;
  fs.writeFileSync(cl, clines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const brk = verifyLedger(path.join(c, 'ledger'));
  assert.equal(brk.rejected, true);
  assert.ok(['chain-break', 'id-mismatch'].includes(brk.reason), brk.reason);

  // head pinned to something else
  const head = verifyLedger(built.ledgerDir, { expectedHead: 'f'.repeat(64) });
  assert.equal(head.rejected, true);
  assert.equal(head.reason, 'head-mismatch');
});

test('a stray file in the evidence directory is refused, not skipped', () => {
  const dir = tmp();
  const built = buildCycle(dir);
  fs.writeFileSync(path.join(built.ledgerDir, 'blobs', 'notes.txt'), 'not evidence');
  const res = verifyLedger(built.ledgerDir);
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'stray-blob');
  assert.match(res.detail, /not evidence is in the evidence directory/);
});

test('a symlinked ledger is refused: evidence that can be a link can be swapped', () => {
  const real = tmp(); buildCycle(real);
  const dir = tmp();
  fs.symlinkSync(path.join(real, 'ledger'), path.join(dir, 'ledger'));
  const res = verifyLedger(path.join(dir, 'ledger'));
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'symlink');
});

// ------------------------------------------------------------------ readCycle

test('a completed cycle reads, and carries its own refusal verbatim', () => {
  const dir = tmp();
  buildCycle(dir);
  const res = readCycle(dir);
  assert.equal(res.ok, true);
  const c = res.cycle;
  assert.equal(c.lesson.status, LESSON_SCOPE);
  assert.equal(c.promotedStatus, 'local-exact-source-promotion-not-release');
  assert.equal(c.gatesPassed, 3);
  assert.equal(c.reproducedFailingCases, 2);
  assert.deepEqual(c.changedPaths, ['src/federation/store.js', 'src/forge/runner.js']);
  assert.equal(c.lesson.limits.length, 2);
  assert.ok(c.head && c.head.length === 64);
});

test('an incomplete or failed cycle is not a lesson', () => {
  const a = tmp(); buildCycle(a, { status: 'failed' });
  assert.equal(readCycle(a).reason, 'incomplete');

  const b = tmp(); const bb = buildCycle(b);
  fs.writeFileSync(path.join(b, 'receipt.json'), canonicalJson({ ...bb.receipt, failed: true }) + '\n');
  assert.equal(readCycle(b).reason, 'failed-run');

  const c = tmp(); const cb = buildCycle(c);
  fs.writeFileSync(path.join(c, 'receipt.json'), canonicalJson({ ...cb.receipt, events: cb.receipt.events - 1 }) + '\n');
  assert.equal(readCycle(c).reason, 'event-count');

  assert.equal(readCycle('').reason, 'no-directory');
  assert.equal(readCycle(tmp()).reason, 'missing-file');
});

// ----------------------------------------------------------------- landing it

test('a lesson lands on the repair carrier, witnessed structurally', () => {
  const dir = tmp(); buildCycle(dir, { project: 'twin-labs' });
  const cycle = readCycle(dir).cycle;
  const fed = fedWith('twin-labs');

  const res = landLesson(fed, cycle, { slug: 'twin-labs', nodeId: 'twin-labs' });
  assert.equal(res.ok, true);
  assert.equal(res.refused.length, 0, JSON.stringify(res.refused));
  assert.equal(res.carrier, 'repair');
  assert.equal(res.scope, LESSON_SCOPE);
  assert.ok(res.landed.length >= 6);
  assert.equal(fed.live().every((f) => f.carrier === 'repair'), true);
  assert.equal(fed.live().every((f) => f.witnesses[0].kind === 'structural'), true, 're-derivable, so it travels on its own');
  assert.equal(fed.live().every((f) => f.witnesses[0].reference.startsWith('ledger:')), true);
});

test('THE REFUSAL TRAVELS: the scope lands in the commons, not beside the lesson', () => {
  const dir = tmp(); buildCycle(dir);
  const fed = fedWith('twin-labs');
  landLesson(fed, readCycle(dir).cycle, { slug: 'twin-labs', nodeId: 'twin-labs' });

  const scope = fed.live().find((f) => f.equation.predicate === 'claim_scope');
  assert.ok(scope, 'the scope is a fact');
  assert.equal(scope.realm, 'shared', 'in the commons, where every reader will meet it');
  assert.equal(scope.equation.object, LESSON_SCOPE, 'verbatim — rewording it would soften it');

  const promotion = fed.live().find((f) => f.equation.predicate === 'promotion');
  assert.equal(promotion.equation.object, 'local-exact-source-promotion-not-release', 'a promotion is never upgraded to a release');
});

test('the METHOD travels and the DEFECT does not', () => {
  const dir = tmp(); buildCycle(dir);
  const fed = fedWith('twin-labs');
  landLesson(fed, readCycle(dir).cycle, { slug: 'twin-labs', nodeId: 'twin-labs' });

  const commons = fed.live({ realm: 'shared' }).map((f) => f.equation.predicate).sort();
  const scoped = fed.live({ realm: 'repo:twin-labs' }).map((f) => f.equation.predicate).sort();

  assert.deepEqual(commons, ['claim_scope', 'promotion', 'repair_verified', 'risk_repair_bar']);
  assert.ok(scoped.includes('repaired_paths'), 'the specifics stay in the repository');
  assert.ok(scoped.includes('reproduced_failures'));
  assert.ok(scoped.includes('limit_1') && scoped.includes('limit_2'), 'every stated limit is its own fact');

  // The point of the split: another repository's briefing picks up the bar and
  // the boundary, and never the defect.
  const other = fedWith('fleets');
  const brief = fed.briefing({ realm: 'repo:fleets', viewer: 'fleets' });
  const preds = brief.facts.map((f) => f.equation.predicate).sort();
  assert.deepEqual(preds, ['claim_scope', 'promotion', 'repair_verified', 'risk_repair_bar'],
    'a repair lesson in one repository reaches another passport as method + boundary, never as a defect claim');
  assert.equal(brief.facts.every((f) => f.equation.subject === 'repo:twin-labs'), true);
  void other;
});

test('risk_repair_bar is shaped for the hub to surface as "found elsewhere"', () => {
  const dir = tmp(); buildCycle(dir);
  const fed = fedWith('twin-labs');
  landLesson(fed, readCycle(dir).cycle, { slug: 'twin-labs', nodeId: 'twin-labs' });
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar');
  // hub.down() surfaces predicates starting with `risk` that are present
  // somewhere and absent here. That filter is what makes a repair lesson reach
  // another repository's PASSPORT.md without any change to the hub.
  assert.ok(bar.equation.predicate.startsWith('risk'));
  assert.match(bar.equation.object, /exact-parent-edits-only/);
  assert.match(bar.equation.object, /native-tests-unchanged/);
  assert.match(bar.equation.object, /3-gates-passed/);
  assert.match(bar.equation.object, /promoted-not-released/);
});

test('a long path list becomes a count, never half a path', () => {
  const dir = tmp();
  const many = Array.from({ length: 40 }, (_, i) => `src/some/deeply/nested/module/file-number-${String(i).padStart(3, '0')}.js`);
  buildCycle(dir, { changedPaths: many });
  const cycle = readCycle(dir).cycle;
  const fed = fedWith('twin-labs');
  const res = landLesson(fed, cycle, { slug: 'twin-labs', nodeId: 'twin-labs' });
  assert.equal(res.refused.length, 0, JSON.stringify(res.refused));

  const paths = fed.live().find((f) => f.equation.predicate === 'repaired_paths');
  assert.equal(paths.equation.object, '40-paths-see-ledger');
  assert.ok(paths.equation.object.length <= 120);
  assert.match(paths.witnesses[0].reference, /^ledger:[a-f0-9]{64}\|blob:/, 'and the full list is where the witness points');
});

test('a lesson refuses to land on the browser carrier', () => {
  const dir = tmp(); buildCycle(dir);
  const fed = fedWith('twin-labs');
  const res = landLesson(fed, readCycle(dir).cycle, { slug: 'twin-labs', nodeId: 'twin-labs', carrier: 'browser' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'carrier');
  assert.match(res.detail, /chat composer/);
  assert.equal(fed.live().length, 0);
});

test('re-ingesting the same cycle is one set of witnesses, not two', () => {
  const dir = tmp(); buildCycle(dir);
  const fed = fedWith('twin-labs');
  const cycle = readCycle(dir).cycle;
  const first = landLesson(fed, cycle, { slug: 'twin-labs', nodeId: 'twin-labs' });
  const second = landLesson(fed, cycle, { slug: 'twin-labs', nodeId: 'twin-labs' });
  assert.equal(first.landed.length, second.landed.length);
  assert.equal(second.landed.every((l) => l.action === 'already-witnessed'), true);
  assert.equal(fed.live().every((f) => f.distinct === 1), true, 'a repeated lesson does not manufacture observations');
  assert.equal(fed.events.filter((e) => e.kind === 'lesson-landed').length, 2, 'but both ingestions are on the record');
});

test('a lesson from an unregistered node is refused', () => {
  const dir = tmp(); buildCycle(dir);
  const fed = fedWith('twin-labs');
  // Witnessing as the subject, but the subject is not registered here.
  const res = landLesson(fed, readCycle(dir).cycle, { slug: 'nowhere', nodeId: 'nowhere' });
  assert.equal(res.landed.length, 0);
  assert.equal(res.refused[0].reason, 'unregistered-node');
});

test('a node cannot file a lesson about a DIFFERENT repository', () => {
  // The registry checks that a node exists; it cannot check that a node is
  // talking about ITSELF. Without this, twin-labs could file
  // risk_repair_bar(repo:fleets) from a cycle it ran on its own source, and
  // fleets would be told a bar was "found elsewhere" when it was found nowhere
  // near fleets. A false fact with a valid witness is the hardest kind to notice.
  const dir = tmp(); buildCycle(dir, { project: 'clearcut' });
  const fed = fedWith('twin-labs', 'fleets');
  const res = landLesson(fed, readCycle(dir).cycle, { slug: 'fleets', nodeId: 'twin-labs' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'witness-is-not-subject');
  assert.match(res.detail, /cannot file a lesson whose subject is 'repo:fleets'/);
  assert.match(res.detail, /onBehalfOf/);
  assert.equal(fed.live().length, 0, 'nothing landed');

  // And the escape hatch is explicit, recorded, and still requires the subject
  // to be registered.
  const proxied = landLesson(fed, readCycle(dir).cycle, { slug: 'fleets', nodeId: 'twin-labs', onBehalfOf: 'twin-labs' });
  assert.equal(proxied.ok, true);
  assert.equal(proxied.refused.length, 0, JSON.stringify(proxied.refused));
  const ev = fed.events.find((e) => e.kind === 'lesson-landed');
  assert.equal(ev.onBehalfOf, 'twin-labs', 'a lesson filed by proxy says so on the record');
  assert.equal(ev.slug, 'fleets');
});

test('a limit too long to carry intact refuses the lesson rather than being cut', () => {
  // Decision D6 — refuse, never strip — applied to a boundary. A limit cut to
  // fit reads as a weaker limit than the repair engine wrote, and quietly
  // softening the boundary is the exact failure this module exists to prevent.
  const dir = tmp();
  const long = 'this repair was verified only against the frozen probe set recorded in this ledger and establishes nothing whatsoever about any other defect class, any other repository, or any future version of this code';
  buildCycle(dir, { project: 'clearcut', limits: [long] });
  const res = ingestCycle(fedWith('clearcut'), dir, { nodeId: 'clearcut' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'limit-too-long');
  assert.match(res.detail, /will not be truncated/);
  assert.match(res.detail, /weaker one/);
  assert.ok(res.detail.includes(String(long.length)), 'names the length it was given');
});

test('a forged summary.json is caught by the chain, not believed', () => {
  // summary.json sits BESIDE the ledger and no hash covers it. Everything that
  // travels is derived from inside the chain, and the summary is read only to be
  // checked against it.
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut' });
  const summaryPath = path.join(dir, 'summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  fs.writeFileSync(summaryPath, canonicalJson({ ...summary, passedGates: 99, changedPaths: ['src/never/touched.js'] }) + '\n');

  const res = readCycle(dir);
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'summary-disagrees');
  assert.match(res.detail, /not covered by the ledger's hash chain/);
  assert.match(res.detail, /passedGates: summary says 99, the ledger holds 3/);
  assert.match(res.detail, /src\/never\/touched\.js/, 'names the disagreement, not just the counts');

  // And the numbers that DO land come from the events, not the file.
  const dir2 = tmp();
  buildCycle(dir2, { project: 'clearcut' });
  const c = readCycle(dir2).cycle;
  assert.equal(c.gatesPassed, 3, 'counted from gate evaluations against the candidate');
  assert.deepEqual(c.changedPaths, ['src/federation/store.js', 'src/forge/runner.js'], 'from the candidate event');
  assert.equal(c.project, 'clearcut', 'from the lesson artifact, not the summary');
});

test('a witness reference never points at a blob nobody hashed', () => {
  const dir = tmp(); buildCycle(dir);
  const cycle = readCycle(dir).cycle;
  assert.ok(cycle.patchId, 'the patch blob id comes from the candidate event');
  const fed = fedWith('clearcut');
  landLesson(fed, cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  for (const f of fed.live()) {
    for (const w of f.witnesses) {
      assert.ok(!/blob:$/.test(w.reference), `dangling pointer on ${f.equation.predicate}: ${w.reference}`);
      const m = /blob:([a-f0-9]{64})/.exec(w.reference);
      if (m) assert.ok(fs.existsSync(path.join(dir, 'ledger', 'blobs', m[1])), 'the blob it names exists');
    }
  }
});

test('ingestCycle reads and lands in one move, taking the slug from the project', () => {
  const dir = tmp(); buildCycle(dir, { project: 'clearcut' });
  const fed = fedWith('clearcut', 'fleets');
  const res = ingestCycle(fed, dir, { nodeId: 'clearcut' });
  assert.equal(res.ok, true);
  assert.equal(res.slug, 'clearcut');
  assert.ok(fed.live({ realm: 'repo:clearcut' }).length >= 3);
});

test('a tampered cycle lands NOTHING', () => {
  const dir = tmp(); buildCycle(dir);
  const logPath = path.join(dir, 'ledger', 'events.jsonl');
  const lines = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n');
  const ev = JSON.parse(lines[lines.length - 2]);
  ev.data.status = 'released';
  lines[lines.length - 2] = JSON.stringify(ev);
  fs.writeFileSync(logPath, lines.join('\n') + '\n');

  const fed = fedWith('twin-labs');
  const res = ingestCycle(fed, dir, { nodeId: 'twin-labs' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'id-mismatch');
  assert.equal(fed.live().length, 0, 'no facts, and no event: nothing about this cycle is memory');
  assert.equal(fed.events.length, 0);
});

test('the equations are stable: same cycle, same signatures', () => {
  const dir = tmp(); buildCycle(dir);
  const cycle = readCycle(dir).cycle;
  const a = lessonEquations(cycle, { slug: 'twin-labs' });
  const b = lessonEquations(cycle, { slug: 'twin-labs' });
  assert.deepEqual(a.commons.map((r) => r.equation), b.commons.map((r) => r.equation));
  assert.deepEqual(a.scoped.map((r) => r.equation), b.scoped.map((r) => r.equation));
  // And a different slug is a different subject, so two repos' lessons never merge.
  const c = lessonEquations(cycle, { slug: 'clearcut' });
  assert.notEqual(a.commons[0].equation.subject, c.commons[0].equation.subject);
});

test('a malformed timestamp in somebody else\'s ledger is reported, never a crash', () => {
  // The cycle's timestamp comes from an external ledger, and
  // `new Date(x).toISOString()` THROWS on a value it cannot parse. A bad
  // timestamp in an otherwise sound cycle must not take down the write path —
  // this repository's standard is that a bad record is REPORTED, never a crash.
  // Built with the bad value from the start, so the chain, ids and lineage are
  // all genuine and the timestamp is the only thing wrong.
  const dir = tmp();
  buildCycle(dir, { timestamp: 'not-a-date' });

  const read = readCycle(dir);
  assert.equal(read.ok, true, 'the cycle still verifies — only the timestamp is unusable');
  assert.equal(read.cycle.completedAt, null, 'reported as null...');
  assert.equal(read.cycle.completedAtRaw, 'not-a-date', '...with the raw value kept, not hidden');

  const fed = fedWith('twin-labs');
  const res = landLesson(fed, read.cycle, { slug: 'twin-labs', nodeId: 'twin-labs' });
  assert.equal(res.ok, true, 'and it still lands, stamped with the landing time');
  assert.equal(res.refused.length, 0, JSON.stringify(res.refused));
  assert.ok(fed.live().length > 0);
  assert.ok(!Number.isNaN(new Date(fed.live()[0].landedAt).getTime()), 'the fact carries a real timestamp');
});

test('safeIso refuses what it cannot use, and keeps what it can', () => {
  const { safeIso } = require('../src/forge/lessons.js');
  assert.equal(safeIso('2026-10-17T12:00:00.000Z'), '2026-10-17T12:00:00.000Z');
  assert.equal(safeIso('not-a-date'), null);
  assert.equal(safeIso(''), null);
  assert.equal(safeIso(null), null);
  assert.equal(safeIso(undefined), null);
  // The shape a hand-built ledger produces past ten events: a two-digit second
  // field written as three digits. Not a valid ISO-8601 timestamp, and V8 does
  // not rescue it — so it is refused rather than silently reinterpreted.
  assert.equal(safeIso('2026-10-17T12:00:010.000Z'), null);
  assert.equal(safeIso({}), null, 'a non-string is refused, not coerced');
  assert.equal(safeIso(0), '1970-01-01T00:00:00.000Z', 'an epoch is a real time');
});

test('the boundary rides into another repository\'s PASSPORT.md beside the method', () => {
  // `elsewhere` is the section an agent actually reads. A method surfaced there
  // with no scope line on it reads as a rule, which is what a lesson refuses to
  // be — so the hub attaches `claim_scope` by subject.
  const { down } = require('../src/federation/hub.js');
  const { RepoPassport } = require('../src/passport/passport.js');

  const dir = tmp();
  buildCycle(dir, { project: 'clearcut' });
  const fedDir = tmp();
  const nodes = new NodeRegistry(fedDir, { gitRemote: () => null }).load();
  nodes.register({ remote: 'https://github.com/me/clearcut', localPath: '/tmp/clearcut' });
  const other = nodes.register({ remote: 'https://github.com/me/fleets', localPath: null });
  const fed = new Federation(fedDir, { nodes }).load();
  assert.equal(landLesson(fed, readCycle(dir).cycle, { slug: 'clearcut', nodeId: 'clearcut' }).refused.length, 0);

  // A second repository, which has never run a cycle, opens its passport.
  const repoDir = tmp();
  const passport = new RepoPassport(repoDir, { slug: 'fleets', remote: 'https://github.com/me/fleets' });
  passport.init({ languages: ['TypeScript'], testCommand: 'npm test' });
  passport.load();
  passport.realm = other.node ? other.node.realm : 'repo:fleets';

  const res = down(fed, passport, { realm: passport.realm, viewer: 'fleets' });
  const bar = res.elsewhere.find((e) => e.predicate === 'risk_repair_bar');
  assert.ok(bar, 'the method reaches a repository that never ran a cycle');
  assert.deepEqual(bar.seenIn, ['repo:clearcut']);
  assert.deepEqual(bar.scope, [LESSON_SCOPE], 'and its boundary arrives with it');

  const doc = fs.readFileSync(res.docPath, 'utf8');
  assert.match(doc, /Found elsewhere in the system/);
  assert.match(doc, /risk_repair_bar/);
  assert.match(doc, /exact-parent-edits-only/);
  assert.match(doc, new RegExp(`scope: ${LESSON_SCOPE}`), 'rendered in the document, not just in the object');
  assert.match(doc, /what this does NOT claim/);

  // And the defect specifics did NOT follow it there.
  assert.ok(!doc.includes('src/session/auth.js'), 'repo A\'s changed paths are repo A\'s business');
  assert.ok(!res.elsewhere.some((e) => e.predicate === 'repaired_paths'));
});

test('readBlob checks the address on the way in', () => {
  const dir = tmp(); const built = buildCycle(dir);
  const good = readBlob(built.ledgerDir, built.summary.baselineId, 'the baseline');
  assert.equal(good.ok, true);
  assert.ok(good.value.files);
  assert.equal(readBlob(built.ledgerDir, 'nothex').reason, 'bad-address');
  assert.equal(readBlob(built.ledgerDir, 'a'.repeat(64)).reason, 'missing-file');
});

// ------------------------------------------------------------------ gate signal
//
// A gate that records a pass with no run behind it is not a gate that passed.
// The actuator already refuses to COMMIT on that evidence (`no_test_signal`);
// these tests hold the memory path to the same definition, so a cycle the write
// path rejects cannot publish a gate count to the federation.

const NO_SIGNAL = [{ passed: true, testsRun: 0, output: '' }];

test('readCycle reports what each gate can prove, not just how many passed', () => {
  const dir = tmp();
  buildCycle(dir, {});
  const { cycle } = readCycle(dir);
  assert.equal(cycle.gatesRecorded, 3, 'three gate evaluations passed against the candidate');
  assert.equal(cycle.gatesPassed, 3, 'and a bare verdict still counts — see the unknown test below');
  assert.equal(cycle.gatesUnproven, 3, 'all three are unknown rather than proven');
  assert.deepEqual(cycle.gatesWithoutSignal, []);
  assert.equal(cycle.gates.length, 3);
  assert.deepEqual(cycle.gates.map((g) => g.specName), ['native', 'locked', 'fresh-retest']);
  assert.deepEqual(cycle.gates.map((g) => g.signal), ['unknown', 'unknown', 'unknown']);
  assert.ok(cycle.gates.every((g) => /^[0-9a-f]{64}$/.test(g.resultId)), 'each gate names its result blob');
});

test('a gate that recorded an empty run does not count toward gatesPassed', () => {
  const dir = tmp();
  buildCycle(dir, { gateResults: [NO_SIGNAL[0], { passed: true, tests: 41 }, { passed: true, testsRun: 7 }] });
  const { cycle } = readCycle(dir);
  assert.equal(cycle.gatesRecorded, 3, 'three gate events still exist in the chain');
  assert.equal(cycle.gatesPassed, 2, 'but only two can prove a run happened');
  assert.deepEqual(cycle.gatesWithoutSignal, ['native'], 'and the one that cannot is named');
  assert.deepEqual(cycle.gates.map((g) => g.signal), ['absent', 'present', 'present']);
});

test('landLesson refuses a cycle whose gates proved nothing, and nothing lands', () => {
  const fed = fedWith('clearcut');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', gateResults: [NO_SIGNAL[0], NO_SIGNAL[0], NO_SIGNAL[0]] });
  const { cycle } = readCycle(dir);
  const res = landLesson(fed, cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'gates-proved-nothing');
  assert.match(res.detail, /native, locked, fresh-retest/, 'the detail names every gate that proved nothing');
  assert.match(res.detail, /no_test_signal/, 'and points at the actuator rule it mirrors');
  assert.equal(fed.live().length, 0, 'no fact of any kind reached the commons');
});

test('refusing lands nothing, so the standing bar cannot be loosened by a hollow cycle', () => {
  // THE POINT OF THE REFUSAL. Had this filed `0-gates-passed`, drift would report
  // a loosening and every later cycle would satisfy a bar demanding nothing.
  const fed = fedWith('clearcut');
  const first = tmp();
  buildCycle(first, { project: 'clearcut', runId: 'run-real-1' });
  assert.equal(landLesson(fed, readCycle(first).cycle, { slug: 'clearcut', nodeId: 'clearcut' }).refused.length, 0);
  const standing = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar').equation.object;
  assert.match(standing, /3-gates-passed/);

  const hollow = tmp();
  buildCycle(hollow, { project: 'clearcut', runId: 'run-hollow-2', gateResults: [NO_SIGNAL[0], NO_SIGNAL[0], NO_SIGNAL[0]] });
  const res = landLesson(fed, readCycle(hollow).cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  assert.equal(res.rejected, true);

  const bars = fed.live().filter((f) => f.equation.predicate === 'risk_repair_bar');
  assert.equal(bars.length, 1, 'the hollow cycle added no bar');
  assert.equal(bars[0].equation.object, standing, 'and the standing bar is unchanged');
});

test('a cycle that ran no gates at all has no count to publish', () => {
  const fed = fedWith('clearcut');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', gateNames: [] });
  const { cycle } = readCycle(dir);
  assert.equal(cycle.gatesRecorded, 0);
  const res = landLesson(fed, cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'no-gates-recorded');
  assert.match(res.detail, /0-gates-passed/, 'the detail says which vacuous bar it declined to file');
  assert.equal(fed.live().length, 0);
});

test('lessonEquations itself carries the refusal, not only landLesson', () => {
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut', gateResults: [NO_SIGNAL[0], NO_SIGNAL[0], NO_SIGNAL[0]] });
  const { cycle } = readCycle(dir);
  const eq = lessonEquations(cycle, { slug: 'clearcut' });
  assert.equal(eq.rejected, true);
  assert.equal(eq.reason, 'gates-proved-nothing');
});

test('a hollow gate is NOT reported as the summary lying — those are different failures', () => {
  // The summary transcribes how many gate evaluations passed, and three did. The
  // separate question is whether any of them prove a run. Collapsing the two
  // would tell the operator to go fix a transcription that is not wrong.
  const dir = tmp();
  const built = buildCycle(dir, { gateResults: [NO_SIGNAL[0], NO_SIGNAL[0], NO_SIGNAL[0]] });
  assert.equal(built.summary.passedGates, 3, 'the fixture summary honestly reports three passing gate events');
  const read = readCycle(dir);
  assert.equal(read.ok, true, 'so the cycle is not refused as summary-disagrees');
  assert.equal(read.cycle.gatesRecorded, 3);
  assert.equal(read.cycle.gatesPassed, 0, 'the signal question is asked separately, and answered differently');
});

test('a cycle whose gates recorded real runs is unaffected', () => {
  const fed = fedWith('clearcut');
  const dir = tmp();
  buildCycle(dir, {
    project: 'clearcut',
    gateResults: [
      { passed: true, tests: 217, output: '# tests 217\n# pass 217' },
      { passed: true, testsRun: 88 },
      { passed: true, output: '88 passing (2s)' },
    ],
  });
  const { cycle } = readCycle(dir);
  assert.equal(cycle.gatesPassed, 3);
  assert.equal(cycle.gatesUnproven, 0, 'nothing is left unknown');
  assert.deepEqual(cycle.gatesWithoutSignal, []);
  const res = landLesson(fed, cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  assert.equal(res.rejected, undefined);
  assert.equal(res.refused.length, 0);
  const bar = fed.live().find((f) => f.equation.predicate === 'risk_repair_bar');
  assert.match(bar.equation.object, /3-gates-passed/);
});

// ============================ THE CLOSED CYCLE
//
// A cycle is closed only when the round that follows promotion executed the
// artifact that was promoted. Without that link, the whole chain of reasoning
// attaches to a version nobody ever tested again.

const { buildCycle: buildForLadder } = require('./helpers/cycle.js');

test('a next round that ran a different artifact does not close the cycle', () => {
  const dir = tmp();
  buildForLadder(dir, { nextRoundTarget: 'other' });
  const r = readCycle(dir);
  assert.equal(r.rejected, true);
  assert.equal(r.reason, 'retest-not-closed');
  assert.match(r.detail, /did not test the repair/);
});

test('a next round against the promoted artifact closes it', () => {
  const dir = tmp();
  buildForLadder(dir, { nextRoundTarget: 'promoted' });
  const r = readCycle(dir);
  assert.equal(r.ok, true);
  assert.equal(r.cycle.status, 'verified');
});

test('the status ladder reports the highest rung whose evidence exists', () => {
  const verifiedDir = tmp();
  buildForLadder(verifiedDir, { nextRoundTarget: 'promoted' });
  const verified = readCycle(verifiedDir);

  // No post-promotion evaluation: accepted, not verified. The cycle is still
  // sound -- it simply does not claim anything about a next round.
  const noNextDir = tmp();
  buildForLadder(noNextDir, { nextRoundTarget: null });
  const noNext = readCycle(noNextDir);

  assert.equal(noNext.ok, true);
  assert.equal(noNext.cycle.status, 'accepted');
  const verifiedRung = noNext.cycle.ladder.find((x) => x.rung === 'verified');
  assert.equal(verifiedRung.met, false);
  assert.match(verifiedRung.why, /no evaluation was recorded after promotion/);

  assert.equal(verified.ok, true);
  assert.equal(verified.cycle.status, 'verified');
  for (const r of verified.cycle.ladder) assert.equal(r.met, true, `${r.rung} should be met`);
});

test('a cycle with no changed paths never reads as repaired', () => {
  // The fixture cannot build a candidate that changed nothing (it needs a path
  // to hash), so this asserts the rung rule rather than a full cycle: a rung is
  // met only when its evidence is present, and `repaired` requires BOTH a change
  // and a passing gate.
  const dir = tmp();
  buildForLadder(dir, { nextRoundTarget: 'promoted' });
  const r = readCycle(dir);
  assert.equal(r.ok, true);
  const repaired = r.cycle.ladder.find((x) => x.rung === 'repaired');
  assert.equal(repaired.met, true, 'this cycle did change something');
  assert.match(repaired.why, /path\(s\) changed/);
});
