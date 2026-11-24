#!/usr/bin/env node
/**
 * diamond.js — audit a source tree against the DIAMOND standard.
 *
 *   node bin/diamond.js <target-dir> [--json] [--run-tests]
 *
 * Reads the source and reports, for each of the three diffusions, which
 * posture the code is actually in: Prevent / Detect / Recover / Exposed.
 * Every finding carries the file and line it came from, because a scorecard
 * you cannot check is a claim, not evidence.
 *
 * WHAT THIS IS NOT: passing this audit does not prove code is unbreakable.
 * It proves the defenses that make breakage visible and recoverable are
 * present and wired. See docs/DIAMOND.md.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { codePartOf, classPattern: riskClassPattern } = require('../src/forge/risks.js');

const SRC_EXT = /\.(js|mjs|cjs|ts|tsx)$/;
const SKIP = /(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo)/;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) out.push(...walk(p));
    else if (SRC_EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** Every match, with its line number, so a finding is checkable. */
function find(files, re) {
  const hits = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push({ file: f, line: i + 1, text: line.trim().slice(0, 160) });
    });
  }
  return hits;
}

const count = (files, re) => find(files, re).length;

/**
 * Matches against the CODE on a line, with comments stripped, using the same
 * stripper the probe uses. A hardcoded identity in a comment is not a backdoor,
 * and an audit that disagrees with the probe about what a site is will pass over
 * things the probe reports or fail on things it does not.
 */
function findCode(files, re) {
  return find(files, re).filter((h) => re.test(codePartOf(h.text)));
}

/** One detector, one definition: the risk vocabulary is shared with the probe. */
const classPattern = (id) => {
  const re = riskClassPattern(id);
  if (!re) throw new Error(`bin/diamond.js asked for a risk class that does not exist: ${id}`);
  return re;
};

// ---------------------------------------------------------------- the checks

const CHECKS = [
  // ------------------------------------------------------------ TAMPER
  {
    axis: 'TAMPER',
    id: 'chained-append-only',
    want: 'D',
    why: 'An edit to any record, or to the pointer before it, changes every hash after it.',
    run: (files) => {
      const genesis = find(files, /['"]0['"]\.repeat\(64\)|0{64}/);
      const chained = find(files, /chainHash|prev,\s*hash|prev,\s*rec/);
      const append = find(files, /appendFileSync/);
      return {
        pass: genesis.length > 0 && chained.length > 0 && append.length > 0,
        detail: `${genesis.length} genesis anchors, ${chained.length} chain links, ${append.length} append-only writes`,
        evidence: [...genesis.slice(0, 2), ...append.slice(0, 2)],
      };
    },
  },
  {
    axis: 'TAMPER',
    id: 'no-erasure',
    want: 'P',
    why: 'A store that can delete can hide that something was ever there.',
    run: (files) => {
      // Only writes to a file that ACCUMULATES are erasure. Rewriting
      // `statePath` — a snapshot of current budget counters and staged
      // proposals — is that file's job; the history lives in the recorder,
      // which is the file this rule exists to protect. Flagging the snapshot
      // teaches the reader that every finding is noise.
      const erasure = find(files, /(unlinkSync|rmSync|truncateSync|writeFileSync)\s*\(/).filter(
        (h) => /\.(jsonl|log|db)['"]/.test(h.text) || /recorderPath|logPath/.test(h.text)
      );
      const del = find(files, /^\s*(async\s+)?delete\s*\(|deleteProperty|\.remove\(/)
        .filter((h) => !/Map|Set|deletedAt|soft/i.test(h.text))
        // A DOM node going away is not a record going away.
        .filter((h) => !/classList\.remove|removeChild|removeEventListener|removeAttribute/.test(h.text))
        // Nor is bookkeeping on a widget. A record names a store.
        .filter((h) =>
          /store|ledger|record|memory|event|chain|log|entry|journal|claim|witness|row|item|file|path/i.test(h.text)
        );
      return {
        pass: erasure.length === 0 && del.length === 0,
        detail: erasure.length + del.length ? 'record erasure paths found' : 'no record erasure path exists',
        evidence: [...erasure, ...del].slice(0, 5),
      };
    },
  },
  {
    axis: 'TAMPER',
    id: 'tamper-reported-not-fatal',
    want: 'D',
    why: 'A chain that throws on tamper loses the evidence; one that reports hands you a finding.',
    run: (files) => {
      const verify = find(files, /verify\s*\(\s*\)|breaks\.push/);
      const noThrow = find(files, /Never throws|never throws|reported, never (a )?(crash|fatal)/i);
      return {
        pass: verify.length > 0 && noThrow.length > 0,
        detail: `${verify.length} verifiers, ${noThrow.length} explicit report-don't-crash contracts`,
        evidence: [...noThrow.slice(0, 2), ...verify.slice(0, 2)],
      };
    },
  },
  {
    axis: 'TAMPER',
    id: 'supersede-never-overwrite',
    want: 'R',
    why: 'A superseded record stays, marked, pointing at what replaced it — so history is recoverable.',
    run: (files) => {
      const sup = find(files, /supersededBy|closedBy/);
      return {
        pass: sup.length > 0,
        detail: `${sup.length} supersede/close pointers`,
        evidence: sup.slice(0, 3),
      };
    },
  },
  {
    axis: 'TAMPER',
    id: 'verify-on-load',
    want: 'D',
    why: 'A chain nobody recomputes is decoration. Rehydration must re-verify.',
    run: (files) => {
      const hits = find(files, /this\.chain\s*=\s*this\.verify\(\)|re-verifies its chain/);
      return {
        pass: hits.length > 0,
        detail: `${hits.length} stores re-verify as they hydrate`,
        evidence: hits.slice(0, 3),
      };
    },
  },

  // -------------------------------------------------------------- HACK
  {
    axis: 'HACK',
    id: 'refuse-by-name',
    want: 'P',
    why: 'An attack refused at a boundary never happened. A guess is not a defense.',
    run: (files) => {
      const named = find(files, /rejected:\s*true/);
      const reasons = find(files, /reason:\s*['"][a-z-]+['"]/);
      return {
        pass: named.length >= 5 && reasons.length >= 5,
        detail: `${named.length} named refusals, ${reasons.length} with a reason code`,
        evidence: named.slice(0, 4),
      };
    },
  },
  {
    axis: 'HACK',
    id: 'fail-closed',
    want: 'P',
    why: 'With nothing configured, the correct answer is no — not a default that trusts whoever asked.',
    run: (files) => {
      const closed = find(files, /fail closed|fail-closed|no-operators-configured|unsigned-release|unauthorized/);
      const emptyDeny = find(files, /if\s*\(!\w[\w.]*\)\s*return\s*\{?\s*rejected|return\s*\{?\s*rejected/);
      return {
        pass: closed.length > 0,
        detail: `${closed.length} fail-closed statements, ${emptyDeny.length} empty-input denials`,
        evidence: closed.slice(0, 4),
      };
    },
  },
  {
    axis: 'HACK',
    id: 'no-hardcoded-identity',
    want: 'P',
    why: 'A hardcoded name trusted as "the human" is a standing backdoor. Identity must be configuration.',
    run: (files) => {
      const bad = findCode(files, classPattern('hardcoded-identity'));
      return {
        pass: bad.length === 0,
        detail: bad.length ? `${bad.length} hardcoded identities` : 'no hardcoded identity',
        evidence: bad.slice(0, 6),
      };
    },
  },
  {
    axis: 'HACK',
    id: 'authority-is-server-side',
    want: 'P',
    why: 'A compromised renderer may ask. It must never authorize.',
    run: (files) => {
      const gate = find(files, /RISK_RANK|authorize\s*\(|CapabilityGate|server-side|main process/i);
      return {
        pass: gate.length > 0,
        detail: `${gate.length} authority checks`,
        evidence: gate.slice(0, 3),
      };
    },
  },
  {
    axis: 'HACK',
    id: 'no-eval-or-dynamic-exec',
    want: 'P',
    why: 'Executing strings from content is the root of most adversarial input wins.',
    run: (files) => {
      // Two of these three are the shared vocabulary's `dynamic-execution` and
      // `innerHTML-assignment`; the audit asks for them rather than restating
      // them, so the two cannot drift.
      const bad = findCode(files, new RegExp(`(?:${riskClassPattern('dynamic-execution').source}|${riskClassPattern('innerHTML-assignment').source})`));
      return {
        pass: bad.length === 0,
        detail: bad.length ? `${bad.length} dynamic execution sites` : 'no eval / new Function / execSync',
        evidence: bad.slice(0, 5),
      };
    },
  },

  // --------------------------------------------------------------- ROT
  {
    axis: 'ROT',
    id: 'staleness-detected',
    want: 'D',
    why: 'A fact nobody re-observed is drifting. The response is a recheck, never an eraser.',
    run: (files) => {
      const hits = find(files, /stale\s*\(|recheck|DEFAULT_RECHECK_DAYS|lastSeenAt/);
      return {
        pass: hits.length > 0,
        detail: `${hits.length} staleness signals`,
        evidence: hits.slice(0, 3),
      };
    },
  },
  {
    axis: 'ROT',
    id: 'expiry-is-a-clock-not-a-failure',
    want: 'D',
    why: 'Operational facts expire because targets mutate. Firing "one contradiction closes it" on every redesign empties the shelf.',
    run: (files) => {
      const hits = find(files, /operational|SHELVES|expire|expired/i);
      return {
        pass: hits.length > 0,
        detail: `${hits.length} expiry-aware references`,
        evidence: hits.slice(0, 3),
      };
    },
  },
  {
    axis: 'ROT',
    id: 'regression-reverts',
    want: 'R',
    why: 'A change that broke what was passing is undone, not argued with.',
    run: (files) => {
      const hits = find(files, /isRegression|newlyBroken|revert|regression/i);
      return {
        pass: hits.length > 0,
        detail: `${hits.length} regression guards`,
        evidence: hits.slice(0, 3),
      };
    },
  },
  {
    axis: 'ROT',
    id: 'verification-is-executable',
    want: 'D',
    why: 'Progress you cannot verify is not progress. The build is the referee; nothing self-adjudicates.',
    run: (files) => {
      const hits = find(files, /detectTestCommand|referee|verdict\s*\(|RUNNER_MISSING/);
      return {
        pass: hits.length > 0,
        detail: `${hits.length} executable-verification hooks`,
        evidence: hits.slice(0, 3),
      };
    },
  },
];

// ------------------------------------------------------------------- grading

const AXES = ['HACK', 'ROT', 'TAMPER'];
const RANK = { P: 3, D: 2, R: 1, X: 0 };

function grade(results) {
  const byAxis = {};
  for (const a of AXES) byAxis[a] = [];
  for (const r of results) byAxis[r.axis].push(r);

  const summary = {};
  for (const a of AXES) {
    const rows = byAxis[a];
    const failed = rows.filter((r) => !r.pass);
    const want = rows.map((r) => r.want);
    const have = rows.filter((r) => r.pass).map((r) => r.want);
    // The axis posture is the WEAKEST link that is unmet, else its best defense.
    let posture;
    if (failed.length) posture = 'X';
    else posture = want.sort((x, y) => RANK[y] - RANK[x])[0];
    summary[a] = {
      posture,
      met: rows.length - failed.length,
      total: rows.length,
      exposed: failed.map((f) => f.id),
      defended: have,
    };
  }

  const exposedAxes = AXES.filter((a) => summary[a].posture === 'X');
  const allPrevent = AXES.every((a) => summary[a].defended.includes('P'));
  const hasDetect = AXES.every((a) => ['P', 'D'].includes(summary[a].posture) || summary[a].defended.includes('D'));

  let verdict;
  if (exposedAxes.length > 1) verdict = 'EXPOSED';
  else if (exposedAxes.length === 1) verdict = 'FRAGILE';
  else if (allPrevent && hasDetect) verdict = 'DIAMOND';
  else verdict = 'HARDENED';

  return { summary, verdict, exposedAxes };
}

// ---------------------------------------------------------------------- main

const target = process.argv[2];
if (!target) {
  console.error('usage: node bin/diamond.js <target-dir> [--json]');
  process.exit(1);
}

const files = walk(target);
const results = CHECKS.map((c) => ({ ...c, ...c.run(files) }));
const { summary, verdict } = grade(results);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ target, files: files.length, verdict, summary, results }, null, 2));
} else {
  const bar = '='.repeat(72);
  console.log(bar);
  console.log(`DIAMOND AUDIT — ${path.resolve(target)}`);
  console.log(`${files.length} source files`);
  console.log(bar);

  for (const a of AXES) {
    const s = summary[a];
    console.log(`\n${a.padEnd(7)} [ ${s.posture} ]  ${s.met}/${s.total} defenses present`);
    if (s.exposed.length) console.log(`        EXPOSED: ${s.exposed.join(', ')}`);
    for (const r of results.filter((x) => x.axis === a)) {
      const mark = r.pass ? r.want : 'X';
      console.log(`   ${mark}  ${r.id.padEnd(30)} ${r.detail}`);
    }
  }

  console.log(`\n${bar}`);
  console.log(`VERDICT: ${verdict}`);
  console.log(bar);
  for (const a of AXES) {
    const s = summary[a];
    console.log(`  ${a.padEnd(7)} ${s.posture}  P/D/R present: ${[...new Set(s.defended)].sort().join('') || 'none'}${s.exposed.length ? `  — exposed: ${s.exposed.join(', ')}` : ''}`);
  }
  console.log('');

  // WHAT THIS GRADE DOES AND DOES NOT COVER.
  //
  // "HARDENED" is a heuristic score over grep-like structural checks. It is not
  // a claim that the code is secure, and it is not a claim about real agents --
  // every behaviour it reasons about was exercised against a test fixture. The
  // same agent wrote the checks, the code and this verdict, which is the exact
  // position the red queen exists to attack.
  const axes = ['HACK', 'ROT', 'TAMPER'];
  const structural = results.filter((r) => /^(?:P|structural)$/i.test(String(r.want || '')));
  console.log('WHAT WAS CHECKED');
  console.log(`  ${results.length} structural checks over ${axes.join(', ')} — presence of a defence (P), and, where specified, that it reports rather than crashes (D) and that a record cannot be erased (R).`);
  console.log(`  heuristic, not proven: ${structural.length} of ${results.length} are "a defence of this shape exists", found by pattern.`);
  console.log('');
  console.log('WHAT WAS NOT CHECKED');
  console.log('  · whether the code is secure — this looks for defence shapes, it does not reason about exploits');
  console.log('  · any real repair cycle — every behaviour scored here was exercised against test/helpers/cycle.js');
  console.log('  · any attack this repository has never seen (see `npm run heldout`)');
  console.log('  · timing, resource exhaustion, or cross-host concurrency');
  console.log('  · whether a bar or a risk class is GOOD GUIDANCE — that is a judgement no grep makes');
  console.log('');

  if (verdict !== 'DIAMOND') {
    const gaps = results.filter((r) => !r.pass);
    console.log('GAPS, WITH EVIDENCE:');
    for (const g of gaps) {
      console.log(`\n  [${g.axis}] ${g.id} — wanted ${g.want}, found X`);
      console.log(`  why: ${g.why}`);
      console.log(`  ${g.detail}`);
      for (const e of g.evidence) console.log(`     ${path.relative(target, e.file)}:${e.line}  ${e.text}`);
    }
    console.log('');
  }
}
