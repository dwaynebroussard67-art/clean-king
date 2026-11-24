/**
 * actuator.js — the thing that acts.
 *
 * WHY THIS FILE IS SEPARATE FROM THE GATE
 *
 * The gate decides. The actuator does. Keeping them apart is not tidiness —
 * it is what makes the guarantee checkable. `gate.js` contains no code that
 * can modify a repository; this file contains no code that can authorize
 * anything. To answer "can an agent change the world on its own authority"
 * you read one file that provably cannot, and this one will not run without a
 * signature from it.
 *
 * WHERE THE WORK HAPPENS
 *
 * A stable worktree per realm, created once and reused. The agent writes into
 * the worktree; the actuator commits the worktree. The person's own checkout
 * is never written to, never staged, never committed — so the worst case is
 * that the machine's scratch space is wrong, and the working branch is
 * untouched.
 *
 * THE RULES, ALL TESTED
 *
 *   1. NOTHING ABOVE `create` RUNS WITHOUT A RELEASED TICKET. The ticket
 *      carries the operator's name.
 *   2. THE GATE IS RE-CHECKED AT EXECUTION TIME, not only at request time.
 *      A signature from an hour ago, under a delegation policy that has since
 *      changed, is not a signature.
 *   3. PATHS ARE BOUNDED TO THE WORKTREE. `..` and absolute paths are refused
 *      by name. A write tool that can reach outside its box is not a write
 *      tool, it is a hole.
 *   4. THE BUILD IS THE REFEREE. Nothing commits red.
 *   5. ONLY `forge/*` IS PUSHABLE. The default branch is unreachable by
 *      construction, so no bug in this file can lose a person's trunk.
 *   6. EVERY ACTION IS CHAINED. What ran, on whose authority, against which
 *      commit, with what verdict — append-only.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { sha256 } = require('./realm.js');
const { nowIso } = require('./util.js');
const { GitForgeRepo, GitForgeError, git: rawGit } = require('../forge/git.js');
const { BuildRunnerReferee, shellRunner, RUNNER_MISSING, TEST_SIGNAL } = require('../forge/referee.js');
const { detectTestCommand } = require('../forge/runner.js');
const { AUTO_GRANT_MAX, RISK_RANK } = require('./serve.js');

const SCHEMA = 'forgeflight.actions.v1';
const GENESIS = '0'.repeat(64);
const chainHash = (prev, rec) => sha256(`${prev}|${JSON.stringify(rec)}`);

/** The only branch prefix the actuator may ever push. Rule 5. */
const FORGE_PREFIX = 'forge/';

// TEST_SIGNAL used to be defined here. It lives in the referee now, because the
// bar needs the same answer to the same question -- did a test actually run --
// and two definitions of "passed" is how the write path and the memory path
// came to disagree about it. See `src/forge/referee.js`.

/**
 * A runner that cannot be quietly disabled by its surroundings.
 *
 * Node's test runner marks child processes with NODE_TEST_CONTEXT. A nested
 * `node --test` sees it, prints "run() is being called recursively... skipping
 * running", and EXITS ZERO. So a suite that never executed reports green, and
 * a referee running inside any test harness becomes a rubber stamp.
 *
 * Stripping the marker means the subprocess actually runs. The signal guard
 * below stays as the second line of defence, because there are other ways for
 * a command to exit 0 without proving anything (`"test": "true"`, a glob that
 * stopped matching, a suite that was deleted).
 */
function cleanRunner(command, args = [], opts = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return function run(dir) {
    const r = spawnSync(command, args, {
      cwd: dir,
      encoding: 'utf8',
      timeout: opts.timeout || 0,
      shell: opts.shell === true,
      env,
    });
    if (r.error) {
      if (r.error.code === 'ENOENT') {
        const e = new Error(`runner not found: ${command}`);
        e.code = RUNNER_MISSING;
        throw e;
      }
      throw r.error;
    }
    return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', signal: r.signal };
  };
}

/**
 * Rule 3. Resolve a path inside a root, or refuse. Never silently clamps —
 * a path that escapes is an attack, and clamping it into something else is
 * how an attack becomes a confusing bug.
 */
function safeRelPath(root, rel) {
  const p = String(rel || '');
  if (!p) return { rejected: true, reason: 'no-path' };
  if (path.isAbsolute(p)) return { rejected: true, reason: 'absolute-path', detail: 'A write names a path relative to the repository.' };
  const resolved = path.resolve(root, p);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return { rejected: true, reason: 'path-escape', detail: `'${p}' resolves outside the repository.` };
  }
  return { ok: true, resolved, rel: path.relative(root, resolved) };
}

class Actuator {
  constructor(dir, { gate, registry, tools } = {}) {
    this.dir = dir;
    this.gate = gate;
    this.registry = registry;
    this.tools = tools || null;
    this.worktrees = new Map(); // realm -> GitForgeRepo
    this.actions = [];
    this.logPath = path.join(dir, 'actions.jsonl');
    this.head = GENESIS;
    this.wtRoot = path.join(dir, 'worktrees');
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.logPath)) return this;
    for (const line of fs.readFileSync(this.logPath, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const rec = JSON.parse(s);
        this.actions.push(rec.data);
        this.head = rec.hash || this.head;
      } catch { /* torn line, dropped */ }
    }
    return this;
  }

  append(data) {
    const prev = this.head;
    const body = { op: 'action', data };
    const hash = chainHash(prev, body);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.logPath, `${JSON.stringify({ ...body, prev, hash })}\n`, 'utf8');
    this.head = hash;
    this.actions.push(data);
    return data;
  }

  git(cwd, args, timeout = 120000) {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout });
    return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  }

  nodeFor(realm) {
    if (!this.registry) return null;
    const n = this.registry.get(String(realm).replace(/^repo:/, ''));
    return n && n.localPath ? n : null;
  }

  /**
   * The stable worktree for a realm. Created once, reused, never the person's
   * own checkout.
   */
  worktreeFor(node) {
    const key = node.slug;
    if (this.worktrees.has(key)) return this.worktrees.get(key);

    fs.mkdirSync(this.wtRoot, { recursive: true });
    const runId = `wt-${key}`;
    const branch = `${FORGE_PREFIX}${key}`;
    let wt;
    try {
      wt = new GitForgeRepo({
        repoDir: node.localPath,
        runId,
        branch,
        worktreeDir: path.join(this.wtRoot, key),
      }).setup();
    } catch (e) {
      // The branch already exists from an earlier run — that is the normal
      // case on the second call, and the worktree is already there.
      if (fs.existsSync(path.join(this.wtRoot, key, '.git')) || fs.existsSync(path.join(this.wtRoot, key))) {
        wt = new GitForgeRepo({ repoDir: node.localPath, runId, branch, worktreeDir: path.join(this.wtRoot, key) });
        wt.ready = true;
        wt.baseBranch = this.git(node.localPath, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
        wt.trunkSha = this.git(node.localPath, ['rev-parse', wt.baseBranch]).out;
      } else if (e instanceof GitForgeError) {
        return { rejected: true, reason: 'worktree-failed', detail: e.message };
      } else {
        throw e;
      }
    }
    this.worktrees.set(key, wt);
    return wt;
  }

  // ------------------------------------------------------------------ invoke

  /**
   * Do a thing. The general entry point.
   *
   * Two ways in, and the risk rank picks which:
   *   rank <= create  -> runs, and is logged
   *   rank >  create  -> needs req.ticket, and the ticket must be released
   *
   * Every refusal is a named RESULT, never an exception, because a caller
   * that has to catch in order to be told "no" will eventually stop asking.
   */
  async invoke(req, { at } = {}) {
    const at_ = nowIso(at);
    const id = `ac_${sha256(`${JSON.stringify(req)}|${at_}`).slice(0, 12)}`;

    const tool = this.tools ? this.tools.get(req.tool) : null;
    if (!tool) return this.done(id, req, at_, { ok: false, reason: 'unknown-tool', detail: `No tool '${req.tool}'.` }, null);

    const rank = RISK_RANK[tool.risk];
    let authority = null;

    if (rank > AUTO_GRANT_MAX) {
      // Rule 1 and Rule 2, together: the ticket must be released, and the
      // operator who released it must still be signed in right now.
      const ticket = req.ticket && this.gate ? this.gate.queue.tickets.get(req.ticket) : null;
      if (!ticket) return this.done(id, req, at_, { ok: false, reason: 'needs-ticket', detail: `'${req.tool}' is ${tool.risk}. It needs a released ticket.` }, null);
      if (ticket.status !== 'released') return this.done(id, req, at_, { ok: false, reason: 'not-released', detail: `That ticket is ${ticket.status}.` }, null);
      if (ticket.name !== req.tool) return this.done(id, req, at_, { ok: false, reason: 'ticket-mismatch', detail: `That ticket is for '${ticket.name}', not '${req.tool}'.` }, null);

      const who = this.gate.operators.authorize();
      if (!who.ok) return this.done(id, req, at_, { ok: false, reason: who.reason, detail: who.detail }, null);
      authority = { operator: who.actor, ticket: ticket.id };
    }

    const node = this.nodeFor(req.from);
    if (!node) return this.done(id, req, at_, { ok: false, reason: 'no-checkout', detail: `No local checkout registered for '${req.from}'.` }, authority);
    if (!fs.existsSync(path.join(node.localPath, '.git'))) {
      return this.done(id, req, at_, { ok: false, reason: 'not-a-repository', detail: `${node.localPath} is not a git repository.` }, authority);
    }

    let out;
    try {
      switch (req.tool) {
        case 'repo.read_file': out = this.readFile(node, req.arg); break;
        case 'repo.list_files': out = this.listFiles(node, req.arg); break;
        case 'repo.write_file': out = this.writeFile(node, req.arg); break;
        case 'repo.run_tests': out = await this.runTests(node); break;
        case 'git.commit': out = await this.commit(node, authority, at_); break;
        case 'git.push': out = this.push(node, req.arg); break;
        default: out = { ok: false, reason: 'not-executable', detail: `'${req.tool}' has no implementation.` };
      }
    } catch (e) {
      out = { ok: false, reason: 'execution-failed', detail: String((e && e.message) || e) };
    }

    return this.done(id, req, at_, out, authority);
  }

  done(id, req, at, out, authority) {
    const rec = { id, at, from: req.from, tool: req.tool, arg: req.arg || null, ...out, ...(authority || {}) };
    this.append(rec);
    return { ...out, id, ...(authority || {}) };
  }

  // ------------------------------------------------------------------- tools

  wt(node) {
    const w = this.worktreeFor(node);
    return w && w.rejected ? w : { ok: true, wt: w };
  }

  readFile(node, arg) {
    const w = this.wt(node);
    if (!w.ok) return w;
    const p = safeRelPath(w.wt.worktreeDir, arg && arg.path);
    if (p.rejected) return { ok: false, reason: p.reason, detail: p.detail };
    if (!fs.existsSync(p.resolved)) return { ok: false, reason: 'not-found', detail: `${p.rel} does not exist in the worktree.` };
    return { ok: true, path: p.rel, content: fs.readFileSync(p.resolved, 'utf8') };
  }

  listFiles(node) {
    const w = this.wt(node);
    if (!w.ok) return w;
    const files = [];
    const walk = (d, prefix) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), rel);
        else files.push(rel);
      }
    };
    walk(w.wt.worktreeDir, '');
    return { ok: true, files, worktree: w.wt.worktreeDir };
  }

  writeFile(node, arg) {
    const w = this.wt(node);
    if (!w.ok) return w;
    const p = safeRelPath(w.wt.worktreeDir, arg && arg.path);
    if (p.rejected) return { ok: false, reason: p.reason, detail: p.detail };
    if (typeof arg.content !== 'string') return { ok: false, reason: 'no-content', detail: 'A write supplies content.' };
    fs.mkdirSync(path.dirname(p.resolved), { recursive: true });
    fs.writeFileSync(p.resolved, arg.content, 'utf8');
    return { ok: true, path: p.rel, bytes: Buffer.byteLength(arg.content), worktree: w.wt.worktreeDir };
  }

  /**
   * Rule 4 — the build is the referee.
   */
  async runTests(node) {
    const tc = detectTestCommand(node.localPath);
    if (!tc) return { ok: false, reason: 'no_test_command', detail: 'No recognisable test command. Progress that cannot be verified is not progress.' };
    const w = this.wt(node);
    if (!w.ok) return w;

    // The run is captured so the verdict and the signal come from the SAME
    // execution. Two runs could disagree, and the second one is the one that
    // would not be in the record.
    let captured = null;
    const run = (dir) => {
      captured = cleanRunner(tc.command, tc.args, { timeout: 600000 })(dir);
      return captured;
    };
    const referee = new BuildRunnerReferee({ dir: w.wt.worktreeDir, run });

    try {
      const verdict = await referee.verdict(w.wt.trunkSha);
      if (verdict.status === 'green') {
        const text = `${captured && captured.stdout ? captured.stdout : ''}\n${captured && captured.stderr ? captured.stderr : ''}`;
        if (!TEST_SIGNAL.some((re) => re.test(text))) {
          return {
            ok: false,
            reason: 'no_test_signal',
            detail: `\`${tc.note}\` exited 0 but ran no tests. A command that proves nothing cannot referee a commit — a repo whose test script is a no-op would otherwise be green forever.`,
            command: tc.note,
          };
        }
      }
      return { ok: verdict.status === 'green', verdict, command: tc.note };
    } catch (e) {
      return { ok: false, reason: 'referee-failed', detail: String((e && e.message) || e) };
    }
  }

  /**
   * Commit the worktree. Green or refused.
   *
   * A red verdict leaves the worktree standing so a person can look at it.
   * A reverted failure is a failure nobody learns from.
   */
  async commit(node, authority, at) {
    const tc = detectTestCommand(node.localPath);
    if (!tc) return { ok: false, reason: 'no_test_command', detail: 'This repository has no recognisable test command. Nothing commits unverified.' };

    const w = this.wt(node);
    if (!w.ok) return w;

    const verdict = await this.runTests(node);
    if (!verdict.ok) {
      // A specific refusal must stay specific. Collapsing "your test script
      // proves nothing" into "the build is red" tells the caller the wrong
      // thing to fix — the tests are not failing, they are not happening.
      const specific = ['no_test_command', 'no_test_signal', 'unrunnable', 'referee-failed'];
      return {
        ok: false,
        reason: specific.includes(verdict.reason) ? verdict.reason : 'tests-red',
        detail: specific.includes(verdict.reason)
          ? verdict.detail
          : `The build is red. Nothing commits red.${verdict.verdict && verdict.verdict.failing && verdict.verdict.failing.length ? ` Failing: ${verdict.verdict.failing.slice(0, 5).join(', ')}` : ''}`,
        verdict: verdict.verdict,
        worktree: w.wt.worktreeDir,
        branch: w.wt.branch,
      };
    }

    const add = this.git(w.wt.worktreeDir, ['add', '-A']);
    if (add.code !== 0) return { ok: false, reason: 'stage-failed', detail: add.err || add.out };

    const staged = this.git(w.wt.worktreeDir, ['diff', '--cached', '--name-only']);
    const files = (staged.out || '').split('\n').filter(Boolean);
    if (!files.length) return { ok: false, reason: 'nothing-to-commit', detail: 'The worktree is clean. Nothing to commit.', branch: w.wt.branch };

    const actor = (authority && authority.operator) || 'unknown';
    const ticketId = (authority && authority.ticket) || 'none';
    const msg = `Forge Federation: commit\n\nReleased by ${actor} (ticket ${ticketId}).\nReferee: ${tc.note} — green.`;
    const cm = this.git(w.wt.worktreeDir, ['commit', '-m', msg]);
    if (cm.code !== 0) return { ok: false, reason: 'commit-failed', detail: cm.err || cm.out };

    const sha = this.git(w.wt.worktreeDir, ['rev-parse', 'HEAD']).out;
    return { ok: true, sha, branch: w.wt.branch, worktree: w.wt.worktreeDir, files, verdict: verdict.verdict, at };
  }

  /**
   * Rule 5 — `forge/*` only.
   */
  push(node, arg) {
    const branch = arg && arg.branch ? String(arg.branch) : null;
    if (!branch) return { ok: false, reason: 'no-branch', detail: 'A push names the branch.' };
    if (!branch.startsWith(FORGE_PREFIX)) {
      return { ok: false, reason: 'branch-forbidden', detail: `The actuator pushes '${FORGE_PREFIX}*' only. '${branch}' is not its to push.` };
    }
    const base = this.git(node.localPath, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
    if (branch === base) return { ok: false, reason: 'branch-forbidden', detail: 'That is the default branch. The actuator will not touch it.' };

    const r = this.git(node.localPath, ['push', '-u', 'origin', branch]);
    if (r.code !== 0) return { ok: false, reason: 'push-failed', detail: r.err || r.out, branch };
    return { ok: true, branch, remote: 'origin' };
  }
}

module.exports = { Actuator, safeRelPath, FORGE_PREFIX, SCHEMA };
