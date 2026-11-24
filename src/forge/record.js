'use strict';

/**
 * record.js — write a cycle from a repair that actually happened.
 *
 * Every cycle in this repository was, until now, built by `test/helpers/cycle.js`
 * — a faithful emitter of the published format, but a model of the world. That
 * is the binding limitation recorded in docs/RED-QUEEN.md: the verifier is
 * cross-checked against itself.
 *
 * This module records a cycle the other way round. It:
 *
 *   1. hashes the source it finds (a real baseline manifest)
 *   2. runs the repository's real test command and reads the real failures
 *   3. reproduces them, unchanged
 *   4. lets a repair function edit the real files
 *   5. hashes what is there now (a real candidate manifest)
 *   6. runs the real test command again
 *   7. writes the real changed paths as the event's `changedPaths`
 *
 * and then writes that as the ledger format, so `readCycle` verifies it from
 * scratch without knowing where it came from.
 *
 * WHAT IT WILL NOT DO. It will not write a cycle whose tests still fail. A
 * recorder that accepts a failure "for the record" manufactures exactly the
 * claim this system exists to check, and it would do so with a hash chain
 * behind it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { canonicalJson, sha256Bytes, ZERO } = require('./ledger.js');
const { LOCAL_PROMOTION, LESSON_SCOPE } = require('./lessons.js');
const { gateSignal, hasTestSignal } = require('./referee.js');

/** Directories that are never source: build output, dependencies, the cycle itself. */
const NOT_SOURCE = /(^|\/)(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo|vendor|__pycache__|ledger)(\/|$)/;

/** Hash every real file under `root`, skipping the exclusions. Sorted, so the
 *  manifest is a function of content and paths and nothing else. */
function manifest(root, { skipUnder = null } = {}) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (skipUnder && (abs === skipUnder || abs.startsWith(skipUnder + path.sep))) continue;
      if (NOT_SOURCE.test(rel)) continue;
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      let buf;
      try {
        buf = fs.readFileSync(abs);
      } catch {
        continue;
      }
      files.push({ path: rel, sha256: sha256Bytes(buf), bytes: buf.length });
    }
  };
  walk(root);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files };
}

/** Paths whose content differs between two manifests. */
function changedBetween(from, to) {
  const a = new Map((from.files || []).map((f) => [f.path, f.sha256]));
  const b = new Map((to.files || []).map((f) => [f.path, f.sha256]));
  const out = [];
  for (const [p, s] of b) if (a.get(p) !== s) out.push(p);
  for (const [p] of a) if (!b.has(p)) out.push(p);
  return out.sort();
}

/** Run a command in a directory. Never throws on a non-zero exit: a failing
 *  test run is the *input* to a repair, not an error. */
function run(command, args, dir, timeout = 120000) {
  // A NESTED `node --test` SKIPS ITSELF AND EXITS ZERO.
  //
  // The runner marks child processes with NODE_TEST_CONTEXT; a `node --test`
  // that inherits it prints "run() is being called recursively... skipping
  // running" and SUCCEEDS WITHOUT RUNNING ANYTHING. Recording inside a test
  // harness — which is exactly how this module is tested — would then read a
  // red suite as green and write a cycle claiming a repair that was never
  // checked. The same trap is documented in src/federation/actuator.js; the
  // recorder has to strip it for the same reason.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(command, args, { cwd: dir, encoding: 'utf8', timeout, shell: false, env });
  return {
    code: r.status === null ? -1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    signal: r.signal || null,
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

/**
 * Extract failing case names from a node --test / TAP run.
 * Deliberately narrow: it names what it saw and nothing else. A parser that
 * guessed would put invented failures into a hash-chained record.
 */
function failingCases(output) {
  const out = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.match(/^\s*not ok\s+\d+\s*-\s*(.+?)\s*$/);
    if (m && !/#\s*(SKIP|TODO)/i.test(line)) out.push({ caseId: m[1].trim(), expected: 'pass', got: 'fail' });
  }
  return out;
}

/**
 * Record one real repair.
 *
 * @param {object} o
 * @param {string} o.repoDir      the working copy the repair is performed in
 * @param {string} o.outDir       where receipt.json / summary.json / ledger go
 * @param {string} o.project      the project name the lesson artifact records
 * @param {string} [o.runId]
 * @param {{command:string,args:string[]}} o.test  the real test command
 * @param {(dir:string)=>void} o.repair            applies the repair, in place
 * @param {string[]} [o.gateNames]                 names for the post-repair gates
 * @param {boolean} [o.reproduce=true]
 * @returns {{ok:true, head:string, receiptPath:string, changedPaths:string[]} |
 *           {rejected:true, reason:string, detail:string}}
 */
function recordRepair(o) {
  const {
    repoDir,
    outDir,
    project,
    runId = `run-${Date.now()}`,
    test,
    repair,
    gateNames = ['native'],
    reproduce = true,
    now = () => new Date().toISOString(),
  } = o || {};

  if (!repoDir || !fs.existsSync(repoDir)) return { rejected: true, reason: 'no-repo', detail: 'A repository to repair is required.' };
  if (!outDir) return { rejected: true, reason: 'no-output', detail: 'A directory for the cycle is required and must be outside the repository.' };
  if (!project) return { rejected: true, reason: 'no-project', detail: 'The cycle must name the project it is about.' };
  if (typeof repair !== 'function') return { rejected: true, reason: 'no-repair', detail: 'A repair function is required; this records repairs, it does not invent them.' };
  if (!test || !test.command) return { rejected: true, reason: 'no-test-command', detail: 'Progress that cannot be verified is not progress.' };

  // The cycle must not be inside the tree it is hashing, or every manifest
  // includes the record of itself.
  const absRepo = path.resolve(repoDir);
  const absOut = path.resolve(outDir);
  if (absOut === absRepo || absOut.startsWith(absRepo + path.sep)) {
    return { rejected: true, reason: 'cycle-inside-repo', detail: 'The cycle directory must be outside the repository it describes.' };
  }

  const ledgerDir = path.join(absOut, 'ledger');
  const blobDir = path.join(ledgerDir, 'blobs');
  fs.mkdirSync(blobDir, { recursive: true });

  const lines = [];
  let previous = ZERO;
  const append = (type, data, { parents = [], artifacts = [] } = {}) => {
    const body = {
      schemaVersion: 1,
      runId,
      sequence: lines.length + 1,
      previous,
      type,
      timestamp: now(),
      elapsedNs: '0',
      parents,
      artifacts,
      rationale: null,
      data,
    };
    const id = sha256Bytes(Buffer.from(canonicalJson(body), 'utf8'));
    lines.push(canonicalJson({ ...body, id }));
    previous = id;
    return id;
  };
  const blob = (value) => {
    const bytes = Buffer.from(canonicalJson(value), 'utf8');
    const id = sha256Bytes(bytes);
    // Content-addressed: the same id always has the same bytes, so this is
    // idempotent rather than an overwrite of anything that differs.
    fs.writeFileSync(path.join(blobDir, id), bytes);
    return { id, bytes: bytes.length, mediaType: 'application/json' };
  };

  const contract = append('repository.contract', { specs: ['discovery', 'reproduction', ...gateNames] });

  // 1. the real baseline
  const before = manifest(absRepo);
  const baselineManifest = blob({ files: before.files });
  const baseline = append('repository.baseline', { manifestId: baselineManifest.id }, { parents: [contract], artifacts: [baselineManifest] });

  // 2. the real failure
  const first = run(test.command, test.args || [], absRepo);
  const failures = failingCases(`${first.stdout}\n${first.stderr}`);
  if (first.code === 0 && failures.length === 0) {
    return { rejected: true, reason: 'nothing-to-repair', detail: 'The suite passes before any repair. There is no cycle here, and recording one would be recording a change nobody needed.' };
  }
  if (failures.length === 0) {
    return {
      rejected: true,
      reason: 'no-named-failing-case',
      detail: `The test command exited ${first.code} without naming a failing case. A broken harness is not a repair target, and a cycle that cannot say what was broken cannot say what was fixed.`,
    };
  }

  const discoveryProc = blob({ exitCode: first.code, stdout: first.stdout.slice(0, 20000), stderr: first.stderr.slice(0, 20000) });
  const discoveryResult = blob({ failures });
  const discovery = append(
    'repository.evaluated',
    { targetId: baselineManifest.id, specName: 'discovery', passed: false, processId: discoveryProc.id, resultId: discoveryResult.id },
    { parents: [baseline, contract], artifacts: [discoveryProc, discoveryResult] }
  );

  // 3. reproduce, unchanged
  let beforeCandidate = discovery;
  if (reproduce) {
    const again = run(test.command, test.args || [], absRepo);
    const reproFailures = failingCases(`${again.stdout}\n${again.stderr}`);
    if (again.code === 0) {
      return { rejected: true, reason: 'not-reproducible', detail: 'The suite passed on a second run of unmodified source. A failure that is not reproducible is not a repair target.' };
    }
    const reproResult = blob({ failures: reproFailures });
    beforeCandidate = append(
      'repository.evaluated',
      { targetId: baselineManifest.id, specName: 'reproduction', passed: false, resultId: reproResult.id },
      { parents: [discovery], artifacts: [reproResult] }
    );
  }

  // 4. the repair itself
  const applied = repair(absRepo);
  if (applied && applied.rejected) return applied;

  // 5. the real candidate
  const after = manifest(absRepo);
  if (canonicalJson(after.files) === canonicalJson(before.files)) {
    return { rejected: true, reason: 'repair-changed-nothing', detail: 'The repair left every hashed file identical. Nothing changed is not a repair.' };
  }
  const changedPaths = changedBetween(before, after);
  const candidateManifest = blob({ files: after.files });
  const patch = blob({ parentId: baselineManifest.id, edits: changedPaths.map((p) => ({ path: p })) });
  const candidate = append(
    'repository.candidate',
    { parentId: baselineManifest.id, manifestId: candidateManifest.id, patchId: patch.id, changedPaths },
    { parents: [beforeCandidate, contract], artifacts: [candidateManifest, patch] }
  );

  // 6. the real gates
  const gateIds = [];
  for (const name of gateNames) {
    const r = run(test.command, test.args || [], absRepo);
    const text = `${r.stdout}\n${r.stderr}`;
    const passed = r.code === 0;
    // The result blob records what the run PRODUCED, so the bar's classifier can
    // tell a gate that proved something from a gate that happened to exit zero.
    const result = blob({
      passed,
      exitCode: r.code,
      output: text.slice(0, 20000),
      signal: hasTestSignal(text) ? 'present' : 'absent',
      failing: failingCases(text),
    });
    gateIds.push(
      append('repository.evaluated', { targetId: candidateManifest.id, specName: name, passed, resultId: result.id }, { parents: [candidate], artifacts: [result] })
    );
    if (!passed) {
      return {
        rejected: true,
        reason: 'repair-did-not-pass',
        detail: `Gate '${name}' exited ${r.code} after the repair. This recorder will not write a cycle whose own tests fail — that is the claim the whole system exists to check.`,
        changedPaths,
      };
    }
    if (gateSignal({ passed, output: text }) === 'absent') {
      return {
        rejected: true,
        reason: 'gate-ran-nothing',
        detail: `Gate '${name}' exited 0 but produced no test signal. A command that proves nothing cannot record a repair.`,
        changedPaths,
      };
    }
  }

  const promoted = append('repository.promoted', { targetId: candidateManifest.id, gateIds, status: LOCAL_PROMOTION }, { parents: gateIds });

  const lessonValue = {
    status: LESSON_SCOPE,
    project,
    failures,
    patchId: patch.id,
    baselineId: baselineManifest.id,
    candidateId: candidateManifest.id,
    evidence: [discovery, ...(beforeCandidate === discovery ? [] : [beforeCandidate]), ...gateIds],
    // Stated, not inferred: this cycle repaired this repository at this commit
    // with these gates. It is not a claim about any other repository.
    limits: ['this cycle is not a claim about any repository but this one'],
  };
  const lessonArtifact = blob(lessonValue);
  const lessonEvent = append('repository.lesson', { lessonId: lessonArtifact.id }, { parents: [promoted], artifacts: [lessonArtifact] });

  const summary = {
    schemaVersion: 1,
    project,
    baselineId: baselineManifest.id,
    promotedId: candidateManifest.id,
    reproducedFailingCases: failures.length,
    registeredCases: null,
    changedPaths,
    passedGates: gateIds.length,
    nextTargetId: candidateManifest.id,
    lessonId: lessonEvent,
    claim: 'recorded by src/forge/record.js from a repair that ran; the chain is the source and this file is a claim about it',
  };
  const summaryArtifact = blob(summary);
  append('repository.completed', summary, { parents: [promoted, lessonEvent], artifacts: [summaryArtifact] });

  // EXCLUSIVE CREATE: A RECORDING CANNOT ERASE A RECORDING.
  //
  // `writeFileSync(path, ...)` would silently replace an existing cycle if the
  // output directory were reused, which is a record-erasure path inside the very
  // tool that writes records. Opening with 'wx' fails instead — and writing
  // through the descriptor rather than the path means there is no path-shaped
  // rewrite of an accumulating file anywhere in this module.
  const exclusive = (file, data) => {
    let fd;
    try {
      fd = fs.openSync(file, 'wx');
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        const err = new Error(`refusing to overwrite an existing cycle file: ${path.basename(file)}`);
        err.code = 'FORGE_CYCLE_EXISTS';
        throw err;
      }
      throw e;
    }
    try {
      fs.writeFileSync(fd, data);
    } finally {
      fs.closeSync(fd);
    }
  };

  exclusive(path.join(ledgerDir, 'events.jsonl'), lines.join('\n') + '\n');
  const receipt = { runId, events: lines.length, head: previous, failed: false, status: 'completed' };
  const receiptPath = path.join(absOut, 'receipt.json');
  exclusive(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  exclusive(path.join(absOut, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  return { ok: true, head: previous, receiptPath, summaryPath: path.join(absOut, 'summary.json'), changedPaths, failures };
}

module.exports = { recordRepair, manifest, changedBefore: changedBetween, changedBetween, failingCases, NOT_SOURCE };
