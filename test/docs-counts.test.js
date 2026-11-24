'use strict';

/**
 * docs-counts.test.js — a document that quotes a count is checked.
 *
 * Every number this project publishes used to be typed by hand: "242 tests, 40
 * attacks, 6 risk classes". Each of those is a fact that changes, and a stale
 * number in a document teaches a reader to distrust the numbers that matter.
 * docs/COUNTS.md is generated; this fails when it is out of date.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const COUNTS = path.join(ROOT, 'docs', 'COUNTS.md');

test('docs/COUNTS.md matches the repository it describes', () => {
  assert.ok(fs.existsSync(COUNTS), 'docs/COUNTS.md is missing — run `npm run stats -- --write`');
  const before = fs.readFileSync(COUNTS, 'utf8');

  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'stats.js'), '--write'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);

  const after = fs.readFileSync(COUNTS, 'utf8');
  const changed = before !== after;
  assert.equal(changed, false, 'docs/COUNTS.md was stale — run `npm run stats -- --write` and commit the result');
});

test('the generated counts are read from the code, not from the document', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'stats.js'), '--json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const stats = JSON.parse(r.stdout);
  assert.ok(stats.testDeclarations > 0);
  assert.equal(stats.attacks, new Set([...fs.readFileSync(path.join(ROOT, 'test', 'redqueen.js'), 'utf8').matchAll(/^attack\(\s*'([^']+)'/gm)].map((m) => m[1])).size);
  const doc = fs.readFileSync(COUNTS, 'utf8');
  assert.match(doc, new RegExp(`\\| attacks \\| ${stats.attacks} \\|`));
  assert.match(doc, new RegExp(`\\| risk classes \\| ${stats.riskClasses} \\|`));
});
