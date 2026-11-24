'use strict';

/**
 * passport-probe.test.js — the passport names the command that checks the lead.
 *
 * THE GAP THIS CLOSES
 *
 * `fed probe` has existed since the Down seam, and no passport ever mentioned it.
 * The passport tells an agent "this class was found in another repository" and
 * then gives it no way to find out whether the class is HERE. The honest
 * behaviour -- go and check -- depended on the agent thinking of a command
 * nobody had told it about.
 *
 * A capability an agent has to remember is a capability it will skip. The fix is
 * not more documentation; it is putting the command where the lead is, in the
 * file the agent already reads.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { RepoPassport } = require(path.join(ROOT, 'src', 'passport', 'passport.js'));

function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-passport-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'module.exports = 1;\n');
  return dir;
}

const elsewhere = (predicates) =>
  predicates.map((p, i) => ({
    predicate: p,
    object: 'seen somewhere',
    seenIn: [`repo:other${i}`],
    scope: ['bounded-historical-observation-not-universal-rule'],
  }));

test('a risk lead in the passport carries the command that checks it here', (t) => {
  const dir = repo(t);
  const p = new RepoPassport(dir, { realm: 'repo:clearcut', slug: 'clearcut' });
  p.init({ name: 'clearcut' });

  const md = p.render({ briefing: { own: [], elsewhere: elsewhere(['risk_hardcoded-identity']) } });

  assert.match(md, /npx fed probe --slug clearcut --dir \./, 'the passport names the probe command');
  assert.match(md, /hardcoded-identity/, 'and names the class it will report');
});

test('leads are described as leads, never as findings in this repository', (t) => {
  const dir = repo(t);
  const p = new RepoPassport(dir, { realm: 'repo:clearcut', slug: 'clearcut' });
  p.init({ name: 'clearcut' });

  const md = p.render({ briefing: { own: [], elsewhere: elsewhere(['risk_hardcoded-identity']) } });
  assert.match(md, /leads from other repositories, not findings in this one/i);
});

test('the command is stated once, and covers every class present', (t) => {
  const dir = repo(t);
  const p = new RepoPassport(dir, { realm: 'repo:clearcut', slug: 'clearcut' });
  p.init({ name: 'clearcut' });

  const md = p.render({
    briefing: {
      own: [],
      elsewhere: elsewhere(['risk_hardcoded-identity', 'risk_dynamic-execution', 'risk_innerHTML-assignment']),
    },
  });

  const occurrences = (md.match(/npx fed probe --slug/g) || []).length;
  assert.equal(occurrences, 1, 'six identical command lines is noise an agent skims');
  assert.match(md, /these 3 classes/);
  assert.match(md, /dynamic-execution/);
});

test('a predicate that is not a probe class does not get a probe command', (t) => {
  const dir = repo(t);
  const p = new RepoPassport(dir, { realm: 'repo:clearcut', slug: 'clearcut' });
  p.init({ name: 'clearcut' });

  // `risk_repair_bar` is a risk-shaped predicate with no scanner behind it.
  const md = p.render({ briefing: { own: [], elsewhere: elsewhere(['risk_repair_bar']) } });
  assert.equal((md.match(/npx fed probe/g) || []).length, 0);
});

test('no risk leads means no probe command at all', (t) => {
  const dir = repo(t);
  const p = new RepoPassport(dir, { realm: 'repo:clearcut', slug: 'clearcut' });
  p.init({ name: 'clearcut' });

  const md = p.render({ briefing: { own: [], elsewhere: elsewhere(['test_command']) } });
  assert.equal((md.match(/npx fed probe/g) || []).length, 0);
});
