'use strict';

/**
 * heldout.js — run attacks the fixer was never allowed to read.
 *
 * THE PROBLEM. The same agent writes the attacks, writes the fixes, and runs the
 * audit that says HARDENED. That is self-grading, and no amount of care fixes
 * it: the holes that survive are the ones the author cannot think of.
 *
 * THE MECHANISM. Held-out attacks live OUTSIDE this repository, at a path this
 * checkout does not contain and this session never reads before the first run:
 *
 *   FORGE_HELDOUT_DIR=/somewhere/else node bin/heldout.js
 *
 * THE FORMAT IS DECLARATIVE ON PURPOSE. The first version expected JavaScript
 * modules exporting `{ id, name, fn }`, which meant the person holding the
 * attacks had to write code against an API they were not allowed to read in
 * order to test it. That is a spec nobody can satisfy. Now each attack is a
 * directory of INPUT FILES plus a small `attack.json` describing what the system
 * SHOULD do with them. Writing an attack requires no knowledge of this codebase
 * beyond the table in `docs/HELDOUT.md`.
 *
 * THE VOCABULARY IS CLOSED, AND THAT IS THE POINT. `component` and `expected`
 * come from fixed lists published in the spec. An attack naming something
 * outside those lists is NOT-APPLICABLE — it describes a seam this system does
 * not have — and NOT-APPLICABLE is never counted as a pass. The alternative,
 * quietly scoring an unmappable attack as blocked, is how a held-out set becomes
 * decoration.
 *
 * NOT-APPLICABLE IS NARROW ON PURPOSE. It is only ever about the ATTACK
 * DECLARATION — an unknown component, a missing input file. It is never about a
 * RESULT. If a check throws while running, that is FAIL: a seam that crashes
 * instead of refusing cleanly has not held.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

const { scanRisks } = require(path.join(ROOT, 'src', 'forge', 'risks.js'));
const { readCycle, landLesson } = require(path.join(ROOT, 'src', 'forge', 'lessons.js'));
const { guardCycle } = require(path.join(ROOT, 'src', 'forge', 'bar.js'));
const { recordRepair } = require(path.join(ROOT, 'src', 'forge', 'record.js'));
const { Federation } = require(path.join(ROOT, 'src', 'federation', 'store.js'));
const { NodeRegistry } = require(path.join(ROOT, 'src', 'federation', 'nodes.js'));
const { RepoPassport } = require(path.join(ROOT, 'src', 'passport', 'passport.js'));

/**
 * INSTRUCTION MARKERS — the vocabulary `render-passport` judges by.
 *
 * This list belongs to the RUNNER, not to the attacker. An author writing an
 * attack does not need to know which words are checked, because the question is
 * not "did my specific sentence survive" but "does this system print
 * instruction-shaped text into an agent's context at all". A fixed vocabulary
 * makes that a property of the system rather than a test of one string.
 */
const INSTRUCTION_MARKERS = [
  'ignore previous',
  'ignore all previous',
  'ignore the above',
  'disregard',
  'system:',
  'assistant:',
  'you must',
  'new instructions',
  'override',
  'do not tell',
];

/** A private Federation, built the same way the tests build one. */
function fedWith(slugs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-heldout-fed-'));
  const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();
  for (const slug of slugs) {
    const res = nodes.register({ remote: `https://github.com/me/${slug}`, localPath: `/tmp/${slug}` });
    if (!res || res.rejected || !res.node) throw new Error(`could not register '${slug}'`);
  }
  return new Federation(dir, { nodes }).load();
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * THE CLOSED VOCABULARY.
 *
 * `run` returns `true` when the system did what `expected` says it should.
 * `detail` is for the operator's log only and is never part of the report.
 */
const CHECKS = {
  scan: {
    component: 'probe',
    expected: ['clean', 'flagged'],
    needs: 'files/',
    run: ({ filesDir, expected }) => {
      const hits = scanRisks(filesDir);
      return {
        met: expected === 'clean' ? hits.length === 0 : hits.length > 0,
        detail: `${hits.length} hit(s)${hits.length ? `: ${[...new Set(hits.map((h) => h.class || h.id))].join(', ')}` : ''}`,
      };
    },
  },

  'read-cycle': {
    component: 'ledger',
    expected: ['accepted', 'refused'],
    needs: 'files/ (a cycle directory)',
    run: ({ filesDir, expected }) => {
      const r = readCycle(filesDir);
      return {
        met: expected === 'accepted' ? r.ok === true : r.rejected === true,
        detail: r.rejected ? `refused: ${r.reason}` : `accepted (${r.cycle.eventCount} events)`,
      };
    },
  },

  'land-lesson': {
    component: 'lesson',
    expected: ['landed', 'refused'],
    needs: 'files/ (a cycle directory), optional `slug`',
    run: ({ filesDir, expected, attack }) => {
      const read = readCycle(filesDir);
      const slug = attack.slug || 'heldout';
      const fed = fedWith([slug]);
      const r = read.rejected ? read : landLesson(fed, read.cycle, { slug, nodeId: slug });
      return {
        met: expected === 'landed' ? r.ok === true : r.rejected === true,
        detail: r.rejected ? `refused: ${r.reason}` : 'landed',
      };
    },
  },

  guard: {
    component: 'bar',
    expected: ['passed', 'refused'],
    needs: 'files/ (a cycle directory), optional `bar` (a bar receipt path inside the attack)',
    run: ({ dir, filesDir, expected, attack }) => {
      const slug = attack.slug || 'heldout';
      const fed = fedWith([slug]);
      const barPath = attack.bar ? path.join(dir, attack.bar) : null;
      const r = guardCycle(fed, { cycleDir: filesDir, slug, barPath });
      return {
        met: expected === 'passed' ? r.ok === true : r.rejected === true,
        detail: r.rejected ? `refused: ${r.reason}` : 'passed',
      };
    },
  },

  'land-fact': {
    component: 'store',
    expected: ['landed', 'refused'],
    needs: '`fact.json` (the land() spec)',
    run: ({ dir, expected }) => {
      const spec = readJson(path.join(dir, 'fact.json'));
      const fed = fedWith([]);
      const r = fed.land(spec);
      return {
        met: expected === 'landed' ? !r.rejected : r.rejected === true,
        detail: r.rejected ? `refused: ${r.reason}` : `landed as ${r.status || 'fact'}`,
      };
    },
  },

  'render-passport': {
    component: 'passport',
    expected: ['sanitised', 'prints'],
    needs: '`briefing.json` (the briefing object handed to render)',
    run: ({ dir, expected }) => {
      const briefing = readJson(path.join(dir, 'briefing.json'));
      const p = new RepoPassport(dir, { realm: 'repo:heldout', slug: 'heldout' });
      const md = String(p.render({ briefing }) || '');
      const lower = md.toLowerCase();
      const found = INSTRUCTION_MARKERS.filter((m) => lower.includes(m));
      return {
        met: expected === 'sanitised' ? found.length === 0 : found.length > 0,
        detail: found.length ? `printed: ${found.join(', ')}` : 'no instruction marker in the rendered text',
      };
    },
  },

  'record-repair': {
    component: 'record',
    expected: ['recorded', 'refused'],
    needs: 'files/ (a repository), `test.json` ({command,args})',
    run: ({ dir, filesDir, expected }) => {
      const t = readJson(path.join(dir, 'test.json'));
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-heldout-cycle-'));
      const repair = attack_repair(dir);
      const r = recordRepair({
        repoDir: filesDir,
        outDir: out,
        project: 'heldout',
        test: { command: t.command, args: t.args || [] },
        repair,
      });
      return {
        met: expected === 'recorded' ? r.ok === true : r.rejected === true,
        detail: r.rejected ? `refused: ${r.reason}` : `recorded (${r.changedPaths.join(', ')})`,
      };
    },
  },
};

/** `repair.js` in the attack directory, if present. Default: change nothing. */
function attack_repair(dir) {
  const file = path.join(dir, 'repair.js');
  if (!fs.existsSync(file)) return () => ({ ok: false, reason: 'heldout attack supplies no repair' });
  const mod = require(file);
  return typeof mod === 'function' ? mod : mod.repair;
}

/** Components in the published vocabulary, for the spec and for the report. */
function components() {
  const out = {};
  for (const [check, spec] of Object.entries(CHECKS)) {
    out[spec.component] = { check, expected: spec.expected, needs: spec.needs };
  }
  return out;
}

/** Every attack directory under `dir`, in id order. */
function discover(dir) {
  const attacksDir = path.join(dir, 'attacks');
  const base = fs.existsSync(attacksDir) ? attacksDir : dir;
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(base, e.name))
    .sort();
}

/**
 * Run one attack. Returns `{ id, verdict, detail }` where verdict is exactly one
 * of PASS / FAIL / NOT-APPLICABLE.
 */
function runOne(dir) {
  let attack;
  try {
    attack = readJson(path.join(dir, 'attack.json'));
  } catch (e) {
    return { id: path.basename(dir), verdict: 'NOT-APPLICABLE', detail: 'bad-attack: no readable attack.json' };
  }

  const id = attack.id != null ? attack.id : path.basename(dir);
  const check = CHECKS[attack.check];

  if (!check) return { id, verdict: 'NOT-APPLICABLE', detail: `no-seam: no check named '${attack.check}'` };
  if (attack.component && attack.component !== check.component) {
    return {
      id,
      verdict: 'NOT-APPLICABLE',
      detail: `no-seam: check '${attack.check}' belongs to component '${check.component}', not '${attack.component}'`,
    };
  }
  if (!check.expected.includes(attack.expected)) {
    return {
      id,
      verdict: 'NOT-APPLICABLE',
      detail: `no-seam: '${attack.expected}' is not an expected value for '${attack.check}' (${check.expected.join(' or ')})`,
    };
  }

  const filesDir = path.join(dir, 'files');
  const needsFiles = check.needs.startsWith('files/');
  if (needsFiles && !fs.existsSync(filesDir)) {
    return { id, verdict: 'NOT-APPLICABLE', detail: 'bad-attack: this check needs a files/ directory' };
  }

  try {
    const { met, detail } = check.run({ dir, filesDir, expected: attack.expected, attack });
    return { id, verdict: met ? 'PASS' : 'FAIL', detail };
  } catch (e) {
    // A seam that throws instead of refusing has not held.
    return { id, verdict: 'FAIL', detail: `threw: ${String((e && e.message) || e).slice(0, 200)}` };
  }
}

/** Run every attack in `dir`. */
function run(dir) {
  return discover(dir).map(runOne);
}

module.exports = { run, runOne, discover, components, CHECKS, INSTRUCTION_MARKERS };
