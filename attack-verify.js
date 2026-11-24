'use strict';

/**
 * attack-verify.js — a new attack must land against the PARENT commit.
 *
 * The failure mode this exists to stop: an attacker who writes attacks that
 * cannot fail reports green, and green reads as a defended system. The red
 * queen's own doc says the author's blind spots are correlated with the author's
 * — this closes the cheaper half of that, the half that is mechanical.
 *
 * THE RULE. An attack that passes `HEAD` and also passes `HEAD~1` was never
 * testing the newest change. It is a regression test wearing an attack's name.
 * Either aim it at something that changed, or move it into the suite as a test
 * where it belongs.
 *
 * HOW. The harness runs each attack in two checkouts of the repository — the
 * working tree, and a `git worktree` of the parent commit — and compares. A new
 * attack is one whose id does not appear in the parent commit's harness. Named
 * old attacks are exempt: they are kept on purpose, because knowing which doors
 * are locked is half the value.
 *
 *   node bin/attack-verify.js           # verify new attacks against HEAD~1
 *   node bin/attack-verify.js --base X  # against a named commit
 *   node bin/attack-verify.js --list    # just show what would be checked
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const HARNESS = 'test/redqueen.js';

function git(args, cwd = ROOT) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** ids declared by an attack harness at a given revision, or in a file on disk. */
function attackIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/^attack\(\s*'([^']+)'/gm)) ids.add(m[1]);
  return ids;
}

function readAt(rev) {
  const r = git(['show', `${rev}:${HARNESS}`]);
  if (!r.ok) return null;
  return r.out;
}

function main(argv) {
  const baseArg = argv.indexOf('--base');
  // DEFAULT IS THE MERGE-BASE, NOT HEAD~1.
  //
  // "Did this attack test the change" is a question about the pull request, and
  // the comparison that answers it is against where the branch left main. HEAD~1
  // answers a different question and gives a wrong answer for any attack that
  // arrived in an earlier commit on the same branch.
  const mergeBase = git(['merge-base', 'HEAD', 'origin/main']);
  const base = baseArg >= 0 ? argv[baseArg + 1] : (mergeBase.ok ? mergeBase.out : 'HEAD~1');
  const listOnly = argv.includes('--list');

  if (!fs.existsSync(path.join(ROOT, HARNESS))) {
    console.error(`no harness at ${HARNESS}`);
    return 2;
  }

  let resolved = git(['rev-parse', '--verify', `${base}^{commit}`]);
  if (!resolved.ok) {
    // SHALLOW CLONES HAVE NO PARENT. This sandbox is checked out at depth 1, so
    // `HEAD~1` genuinely does not exist until it is fetched. Deepen and retry;
    // if the history still cannot be reached, say so and fail — a check that
    // could not run is not a passing check.
    git(['fetch', '--quiet', '--deepen=50', 'origin']);
    resolved = git(['rev-parse', '--verify', `${base}^{commit}`]);
  }
  if (!resolved.ok) {
    console.error(`cannot resolve base '${base}': ${resolved.err}`);
    console.error('attack-verify: NOT COMPARED. A comparison that did not happen is not a pass.');
    return 2;
  }

  const current = fs.readFileSync(path.join(ROOT, HARNESS), 'utf8');
  const now = attackIds(current);
  const beforeText = readAt(base);
  if (beforeText === null) {
    console.error(`${HARNESS} does not exist at ${base} — nothing to compare against.`);
    return 2;
  }
  const before = attackIds(beforeText);

  const added = [...now].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !now.has(id));

  console.log(`\nATTACK VERIFY — base ${base} (${resolved.out.slice(0, 12)})`);
  console.log(`  attacks now: ${now.size}   at base: ${before.size}   new: ${added.length}\n`);

  if (removed.length) {
    console.log(`  note: ${removed.length} attack(s) at the base no longer present: ${removed.join(', ')}`);
    console.log('        an attack that is blocked is not deleted — removing one needs a reason in the message\n');
  }

  if (!added.length) {
    console.log('  no new attacks; nothing to verify.');
    return 0;
  }

  if (listOnly) {
    console.log(`  would verify: ${added.join(', ')}`);
    return 0;
  }

  // Build a worktree at the base and run the CURRENT harness there. That is the
  // only honest comparison: same attacks, older code. If an attack still lands
  // on the older code, it is not testing the change under review.
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-attack-'));
  const add = git(['worktree', 'add', '--detach', wt, resolved.out]);
  if (!add.ok) {
    console.error(`  could not create a worktree: ${add.err}`);
    return 2;
  }

  let failed = 0;
  let inconclusive = 0;
  try {
    const target = path.join(wt, HARNESS);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, current, 'utf8');

    const run = spawnSync(process.execPath, [HARNESS], {
      cwd: wt,
      encoding: 'utf8',
      env: { ...process.env, FORGE_REDQUEEN_JSON: '1' },
    });
    const output = `${run.stdout || ''}\n${run.stderr || ''}`;

    // One JSON line, emitted by the harness itself. No scanning the human output:
    // the first version of this file did that, matched nothing, and reported six
    // attacks as "blocked" while four of them were landing on the parent.
    const line = output.split('\n').find((l) => l.includes('__REDQUEEN_JSON__'));
    if (!line) {
      console.log(`    FAIL  the harness produced no verdicts at ${base} — the comparison did not happen`);
      console.log('          (a crate that may not build is not a locked crate)');
      return 1;
    }
    const parsed = JSON.parse(line.slice(line.indexOf('__REDQUEEN_JSON__') + '__REDQUEEN_JSON__'.length));
    const landedAtBase = new Set(parsed.landed || []);
    const unprovenAtBase = new Set(parsed.unproven || []);

    console.log('  each new attack, replayed against the parent commit:');
    for (const id of added) {
      if (landedAtBase.has(id)) {
        failed++;
        console.log(`    FAIL  ${id}  lands on the parent too — it is not testing the newest change`);
        console.log('          (aim it at something the change altered, or move it into the suite as a test)');
      } else if (unprovenAtBase.has(id)) {
        // Not a pass, not a failure. An attack that names a function the parent
        // commit did not have cannot be replayed there at all, so its ability to
        // test the change is unproven — and saying "blocked" would be a green
        // nobody earned.
        console.log(`    ????  ${id}  inconclusive at the parent (it names something that commit lacked)`);
        inconclusive++;
      } else {
        console.log(`    ok    ${id}  blocked on the parent; it is aimed at the change`);
      }
    }
  } finally {
    git(['worktree', 'remove', '--force', wt]);
    fs.rmSync(wt, { recursive: true, force: true });
  }

  console.log('');
  if (failed) {
    console.log(`ATTACK VERIFY: ${failed} of ${added.length} new attack(s) do not test the change.\n`);
    return 1;
  }
  if (inconclusive) {
    console.log(`ATTACK VERIFY: ${added.length - inconclusive} aimed at the change, ${inconclusive} inconclusive at the base.`);
    console.log('  Inconclusive is not blocked. Check those against HEAD by hand.\n');
    return 0;
  }
  console.log(`ATTACK VERIFY: all ${added.length} new attack(s) are aimed at the change.\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
