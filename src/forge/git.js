/**
 * git.js — the tree + apply adapter. Real worktrees, real branches, no native
 * modules: everything is the git CLI through child_process, which is the same
 * posture as the rest of Forge Flight (install with `npm install` and nothing
 * else).
 *
 * THE CONTRACT IT SATISFIES
 *
 * The forge passes an opaque `tree` to `referee.verdict(tree)` and to
 * `apply(tree, patch)`, and `apply` must return a NEW tree without mutating the
 * old one — the forge keeps the old tree on a regression. Git is stateful, so
 * this adapter reconciles the two: `tree` is a commit SHA, and the worktree is
 * the single checkout the loop flies in.
 *
 *   apply(sha, patch)   reset the worktree to `sha`, apply the diff, commit on
 *                       the forge branch, and return the new SHA. A patch that
 *                       does not apply returns {ok:false} with a reason. A patch
 *                       that changes nothing returns {changed:false}.
 *   checkout(sha)       reset the worktree to `sha` (used by the referee before
 *                       it runs the build).
 *   releaseToBase()     merge the forge branch into the base branch — the
 *                       human's step. Never called by the loop.
 *
 * WHY A DEDICATED WORKTREE
 *
 * The loop never writes into the user's own checkout. It flies in a worktree
 * created from the base branch, and the user's main repository is untouched
 * until the human releases a proposal. That is the git-as-proposal model made
 * physical: staged on a branch named forge/{runId}, merged only by hand.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

class GitForgeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitForgeError';
  }
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) throw new GitForgeError(`git failed to start: ${r.error.message}`);
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

class GitForgeRepo {
  constructor(opts = {}) {
    this.repoDir = opts.repoDir;
    this.base = opts.base || null; // branch or commit; defaults to the repo's current branch
    this.runId = opts.runId || `forge_${randomBytes(6).toString('hex')}`;
    this.branch = opts.branch || `forge/${this.runId}`;
    this.worktreeDir = opts.worktreeDir || path.join(os.tmpdir(), `forge-wt-${this.runId}`);
    this.baseBranch = null;
    this.trunkSha = null;
    this.ready = false;
  }

  _ready() {
    if (!this.ready) throw new GitForgeError('GitForgeRepo is not set up; call setup() first.');
  }

  /** Create the forge branch and its dedicated worktree. Idempotent. */
  setup() {
    if (this.ready) return this;
    if (!this.repoDir || !fs.existsSync(path.join(this.repoDir, '.git'))) {
      throw new GitForgeError(`not a git repository: ${this.repoDir || '(none)'}`);
    }
    const base = this.base || git(this.repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
    if (!base || base === 'HEAD') throw new GitForgeError(`could not resolve a base branch in ${this.repoDir}`);

    const exists = git(this.repoDir, ['rev-parse', '--verify', '--quiet', this.branch]).code === 0;
    if (exists) throw new GitForgeError(`branch ${this.branch} already exists; choose a fresh runId`);

    const r = git(this.repoDir, ['worktree', 'add', '-b', this.branch, this.worktreeDir, base]);
    if (r.code !== 0) throw new GitForgeError(`worktree add failed: ${r.err || r.out}`);

    this.baseBranch = base;
    this.trunkSha = git(this.repoDir, ['rev-parse', base]).out;
    this.ready = true;
    return this;
  }

  trunk() {
    this._ready();
    return this.trunkSha;
  }

  /** Reset the worktree to `sha`. The referee calls this before running. */
  checkout(sha) {
    this._ready();
    const r = git(this.worktreeDir, ['reset', '--hard', String(sha)]);
    if (r.code !== 0) throw new GitForgeError(`checkout ${sha} failed: ${r.err || r.out}`);
  }

  /** Apply a unified diff on top of `sha`, commit, return the new SHA. */
  apply(sha, patch) {
    this._ready();
    this.checkout(sha);

    const patchFile = path.join(os.tmpdir(), `forge-patch-${randomBytes(6).toString('hex')}.diff`);
    fs.writeFileSync(patchFile, String(patch || ''), 'utf8');
    try {
      const check = git(this.worktreeDir, ['apply', '--check', patchFile]);
      if (check.code !== 0) {
        return { ok: false, changed: false, tree: sha, reason: check.err || check.out || 'patch did not apply' };
      }
      const applied = git(this.worktreeDir, ['apply', patchFile]);
      if (applied.code !== 0) {
        return { ok: false, changed: false, tree: sha, reason: applied.err || applied.out || 'patch did not apply' };
      }
      const add = git(this.worktreeDir, ['add', '-A']);
      if (add.code !== 0) {
        return { ok: false, changed: false, tree: sha, reason: add.err || add.out };
      }
      const diff = git(this.worktreeDir, ['diff', '--cached', '--quiet']);
      if (diff.code === 0) {
        git(this.worktreeDir, ['reset', '-q']);
        return { ok: true, changed: false, tree: sha };
      }
      const commit = git(this.worktreeDir, [
        '-c', 'user.name=Forge Flight',
        '-c', 'user.email=forge@localhost',
        'commit', '-q', '-m', `forge: apply patch ${sha256(patch).slice(0, 12)}`,
      ]);
      if (commit.code !== 0) {
        return { ok: false, changed: false, tree: sha, reason: commit.err || commit.out };
      }
      const newSha = git(this.worktreeDir, ['rev-parse', 'HEAD']).out;
      return { ok: true, changed: true, tree: newSha };
    } finally {
      try {
        fs.unlinkSync(patchFile);
      } catch {
        /* already gone */
      }
    }
  }

  /** The human's step: merge the forge branch into the base branch. The loop
   *  never calls this — a run only ever stages a proposal. */
  releaseToBase(branch = this.branch, message = 'Forge Flight: accept proposal') {
    this._ready();
    const r = git(this.repoDir, [
      '-c', 'user.name=Forge Flight',
      '-c', 'user.email=forge@localhost',
      'merge', '--no-ff', '-m', message, branch,
    ]);
    if (r.code !== 0) throw new GitForgeError(`merge failed: ${r.err || r.out}`);
    return { ok: true, branch, base: this.baseBranch, detail: r.out || r.err };
  }

  /** Remove the worktree and delete the forge branch. For abandoning a run. */
  dispose() {
    if (!this.ready) return;
    try {
      git(this.repoDir, ['worktree', 'remove', '--force', this.worktreeDir]);
    } catch {
      /* worktree already gone */
    }
    try {
      git(this.repoDir, ['branch', '-D', this.branch]);
    } catch {
      /* branch already gone */
    }
    this.ready = false;
  }
}

module.exports = { GitForgeRepo, GitForgeError, git };
