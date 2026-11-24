'use strict';

/**
 * check-remote.js — does the local pointer match the remote tip?
 *
 * WHY THIS EXISTS. For three sessions this repository "lost" work: `git status`
 * showed the whole of a pushed arc as uncommitted, and every recovery was done
 * by hand with `git reset --soft origin/<branch>`.
 *
 * The root cause was not a git bug. Each sandbox session is a FRESH CLONE that
 * checks the branch out at the commit Arena recorded for it — its creation
 * point, not the remote tip:
 *
 *   b2938fe HEAD@{22:04:05}: checkout: moving from main to arena/ee364759-...
 *   b2938fe HEAD@{22:04:04}: clone: from https://github.com/.../Forge-Federation
 *
 * and, decisively:
 *
 *   fatal: no upstream configured for branch 'arena/ee364759-forge-federation'
 *
 * With no upstream, `git status` can never report divergence — it prints a clean
 * tree and says nothing about being behind. The branch pointer is stale from the
 * moment the clone lands, and every push after that is a guess.
 *
 * So this compares local HEAD to the remote tip explicitly, and refuses to be
 * quiet about a mismatch. It is cheap enough to run in a pre-push hook.
 *
 *   node bin/check-remote.js            # warn only
 *   node bin/check-remote.js --strict   # exit 1 when local is behind or diverged
 */

const { spawnSync } = require('node:child_process');

const ROOT = require('node:path').resolve(__dirname, '..');

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function main(argv) {
  const strict = argv.includes('--strict');

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch.ok) {
    console.error('check-remote: cannot read the current branch');
    return 2;
  }
  if (branch.out === 'HEAD') {
    console.log('check-remote: detached HEAD; nothing to compare.');
    return 0;
  }

  const local = git(['rev-parse', 'HEAD']);
  if (!local.ok) return 2;

  // A fetch that fails is not a pass. Unreachable remote means the comparison
  // did not happen, and silence must not read as agreement.
  const fetched = git(['fetch', '--quiet', 'origin', branch.out]);
  if (!fetched.ok) {
    console.error(`check-remote: could not fetch origin/${branch.out} — ${fetched.err}`);
    console.error('check-remote: NOT COMPARED. Fix the remote before trusting a push.');
    return strict ? 1 : 0;
  }

  const remote = git(['rev-parse', `origin/${branch.out}`]);
  if (!remote.ok) {
    console.log(`check-remote: origin/${branch.out} does not exist yet (first push).`);
    return 0;
  }

  const short = (s) => s.slice(0, 12);
  const aheadOfRemote = git(['rev-list', '--count', `origin/${branch.out}..HEAD`]).out;
  const behindRemote = git(['rev-list', '--count', `HEAD..origin/${branch.out}`]).out;

  console.log(`\nCHECK REMOTE — ${branch.out}`);
  console.log(`  local   ${short(local.out)}`);
  console.log(`  remote  ${short(remote.out)}`);
  console.log(`  ahead ${aheadOfRemote}   behind ${behindRemote}`);

  const tracking = git(['rev-parse', '--abbrev-ref', '@{u}']);
  if (!tracking.ok) {
    console.log('  no upstream configured — `git status` cannot warn you about being behind');
    console.log(`  fix: git branch --set-upstream-to=origin/${branch.out}`);
  }

  if (local.out === remote.out) {
    console.log('  in sync.\n');
    return 0;
  }

  if (Number(behindRemote) > 0) {
    console.log(`\n  LOCAL IS BEHIND the remote by ${behindRemote} commit(s). The working tree is not`);
    console.log('  what the remote holds. Do NOT commit on top of this — you would replay work');
    console.log('  that is already pushed.');
    console.log(`\n  recover:  git reset --soft origin/${branch.out} && git reset HEAD`);
    console.log('  (never force-push; the remote is the source of truth)\n');
    return strict ? 1 : 0;
  }

  console.log(`\n  ahead by ${aheadOfRemote} — local work is newer. ${behindRemote === '0' ? 'Fast-forward is safe.' : ''}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
