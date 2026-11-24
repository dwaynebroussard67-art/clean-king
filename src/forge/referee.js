/**
 * referee.js — the build/test adapter. Turns a test run into a verdict the
 * forge can act on: green, red with named failing tests, or a broken build.
 *
 * THE VERDICT CONTRACT
 *
 *   { status: 'green' }                      exit 0
 *   { status: 'red', failing: [...] }        exit non-zero, named failing tests
 *   { status: 'red', failing: [], brokenBuild: true }
 *                                            exit non-zero, NO named failing
 *                                            test — the build/test harness
 *                                            itself broke (compile error,
 *                                            crash, missing runner).
 *   { status: 'unrunnable', reason }         the runner is not present at all
 *   { status: 'empty_response', reason }     passed, but produced no test signal
 *                                            (only when requireSignal is set)
 *
 * THE BROKEN-BUILD DISTINCTION, AND WHY IT MATTERS
 *
 * A compile error looks like "no tests failed", which — taken literally — looks
 * like progress. The forge's regression rule compares failing sets, so a broken
 * build with an empty failing set would otherwise advance the tree. The referee
 * therefore marks a non-zero exit with no named failing tests as `brokenBuild`,
 * and the forge refuses it as a regression instead of accepting it. A patch
 * that breaks the build is not a patch that fixes the bug.
 */

'use strict';

const { spawnSync } = require('node:child_process');

const RUNNER_MISSING = 'RUNNER_MISSING';

/**
 * THE SHAPE OF A RUN THAT PROVES SOMETHING.
 *
 * One definition, and it is used by both halves of the system: the actuator,
 * which refuses to COMMIT without it (`no_test_signal`), and the bar, which
 * refuses to COUNT a gate without it. They were written independently and they
 * disagreed -- the actuator knew a green with no signal is not a pass, and the
 * memory path counted `passed === true` and called it a gate. A cycle whose
 * tests ran nothing could not be committed, but its lesson still travelled.
 *
 * This is why the vocabulary lives here and not in either caller.
 *
 * Without it, a repository whose test script is `"test": "true"` -- or one whose
 * suite silently stopped being discovered -- is green forever, and the referee is
 * a rubber stamp. A green with no signal is not a passing build, it is an absence
 * of information, and it must not authorize a commit.
 *
 * Counts, not words: a loose pattern like "N test" matches the npm banner
 * (`demo@1.0.0 test`), which would make every no-op script look like a run.
 */
const TEST_SIGNAL = [
  /#\s*(?:tests|suites|pass|fail|skipped|todo)\s+\d+/i, // node --test, TAP
  /\b\d+\s+(?:passing|passed|failing|failed)\b/i, // mocha, jest, pytest
  /\b(?:test files?|tests?)\s*:?\s*\d+\s*(?:passed|failed|total)\b/i, // vitest, jest summary
];

/** Does this text show that a test runner actually ran tests? */
function hasTestSignal(text) {
  const t = String(text == null ? '' : text);
  return TEST_SIGNAL.some((re) => re.test(t));
}

/** Fields that measure the SIZE of a run. `passed`/`failed` are deliberately
 *  absent: `failed: 0` is what a healthy run looks like, and reading it as
 *  "nothing ran" would refuse every green cycle in the federation. */
const RUN_COUNT_FIELDS = ['testsRun', 'tests', 'total', 'suites', 'assertions', 'cases'];
/** Fields that would hold a runner's own output. */
const OUTPUT_FIELDS = ['output', 'stdout', 'stderr', 'text', 'log', 'summary'];

/**
 * What does a gate's recorded result say about whether anything RAN?
 *
 *   'present'  positively records a run: a run-size count above zero, or output
 *              matching TEST_SIGNAL
 *   'absent'   positively records that nothing ran: a run-size count of exactly
 *              zero, or an output field present but empty
 *   'unknown'  records only a verdict -- `{passed: true}` -- and says nothing
 *              either way
 *
 * `unknown` is the common case and is NOT a failure. The ledger format belongs
 * to somebody else; a field this classifier has never seen must not be read as
 * evidence of absence, or every unfamiliar cycle becomes a refusal nobody can
 * act on. Only an explicit zero, or an explicitly empty output, is `absent`.
 */
function gateSignal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';

  let sawZeroCount = false;
  for (const f of RUN_COUNT_FIELDS) {
    const v = value[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v > 0) return 'present';
    if (v === 0) sawZeroCount = true;
  }

  let sawEmptyOutput = false;
  for (const f of OUTPUT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, f)) continue;
    const v = value[f];
    if (typeof v !== 'string') continue;
    if (hasTestSignal(v)) return 'present';
    if (v.trim() === '') sawEmptyOutput = true;
  }

  if (sawZeroCount || sawEmptyOutput) return 'absent';
  return 'unknown';
}

/**
 * Extract failing test names from common runner output. Conservative by design:
 * it recognises TAP (`not ok N - name`), Jest (`✕/✗/×/● name`, `FAIL file › name`),
 * and Mocha's failure list (`  1) name:`). A runner it cannot parse yields
 * nothing — and an empty parse on a non-zero exit is exactly what marks a
 * broken build. Skipped and TODO'd TAP lines are deliberately excluded.
 */
function parseFailing(output) {
  const out = String(output || '');
  const names = [];
  for (const line of out.split(/\r?\n/)) {
    const tap = line.match(/^\s*not ok\s+\d+\s*-\s*(.+?)\s*$/i);
    if (tap && !/#\s*(SKIP|TODO)/i.test(line)) names.push(tap[1].trim());
    const jest = line.match(/^\s*(?:✕|✗|×|●)\s+(.+?)\s*$/u);
    if (jest) names.push(jest[1].trim());
    const mocha = line.match(/^\s+\d+\)\s+(.+?)\s*$/);
    if (mocha) names.push(mocha[1].trim().replace(/:\s*$/, ''));
  }
  for (const m of out.matchAll(/^\s*FAIL\s+(\S+)(?:\s*›.*)?$/gm)) {
    names.push(m[1]);
  }
  const seen = new Set();
  return names
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n) && (seen.add(n), true));
}

/** A runner that shells out. Maps a missing command to RUNNER_MISSING so the
 *  referee can say `unrunnable` instead of crashing the run. */
function shellRunner(command, args = [], opts = {}) {
  return function run(dir) {
    const r = spawnSync(command, args, {
      cwd: dir,
      encoding: 'utf8',
      timeout: opts.timeout || 0,
      shell: opts.shell === true,
    });
    if (r.error) {
      if (r.error.code === 'ENOENT') {
        const e = new Error(`runner not found: ${command}`);
        e.code = RUNNER_MISSING;
        throw e;
      }
      throw r.error;
    }
    return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', signal: r.signal || null };
  };
}

class BuildRunnerReferee {
  /**
   * @param {object} opts
   * @param {(dir) => {code, stdout, stderr}} opts.run  runs the build; throws
   *        { code: RUNNER_MISSING } when the harness is absent
   * @param {(output) => string[]} [opts.parse]          failing-name parser
   * @param {boolean} [opts.requireSignal]               a green with no test
   *        signal becomes empty_response instead of green
   * @param {(sha) => void} [opts.checkout]              called with the sha
   *        before running — wire this to GitForgeRepo#checkout
   */
  constructor(opts = {}) {
    if (typeof opts.run !== 'function') {
      throw new Error('BuildRunnerReferee needs a run function.');
    }
    this.run = opts.run;
    this.dir = opts.dir || null; // the checkout the build runs in (e.g. the worktree)
    this.parse = opts.parse || parseFailing;
    this.requireSignal = opts.requireSignal === true;
    this.checkout = opts.checkout || null;
  }

  async verdict(sha) {
    if (this.checkout) {
      try {
        this.checkout(sha);
      } catch (e) {
        return { status: 'unrunnable', reason: String((e && e.message) || e) };
      }
    }
    let out;
    try {
      out = this.run(this.dir);
    } catch (e) {
      if (e && e.code === RUNNER_MISSING) return { status: 'unrunnable', reason: e.message };
      throw e;
    }

    if (out.signal) {
      return { status: 'red', failing: [], brokenBuild: true, reason: `the runner was killed by ${out.signal}` };
    }

    const failing = this.parse(`${out.stdout}\n${out.stderr}`);

    if (out.code === 0) {
      if (this.requireSignal && failing.length === 0) {
        return { status: 'empty_response', reason: 'the runner passed but produced no test signal' };
      }
      return { status: 'green' };
    }

    if (failing.length === 0) {
      return {
        status: 'red',
        failing: [],
        brokenBuild: true,
        reason: String(out.stderr || out.stdout || '').trim().slice(0, 400) || 'the build failed with no named failing test',
      };
    }
    return { status: 'red', failing };
  }
}

module.exports = {
  BuildRunnerReferee,
  shellRunner,
  parseFailing,
  gateSignal,
  hasTestSignal,
  RUN_COUNT_FIELDS,
  TEST_SIGNAL,
  RUNNER_MISSING,
};
