'use strict';

/**
 * stats.js — the counts, produced rather than remembered.
 *
 * Docs used to hardcode "242 tests, 40 attacks, 6 classes". Each is a fact that
 * changes, and a document asserting a stale number teaches a reader to distrust
 * the numbers that matter.
 *
 * WHY THIS RUNS NO CHILD PROCESS. The first version ran `node --test` to get a
 * live test total, and it recursed: `stats --write` ran the suite, one of those
 * tests ran `stats --write`, which ran the suite again. It took the sandbox down.
 * A counter that is safe to call from inside the thing it counts reads static
 * facts only. The authoritative test total is printed by `npm test` itself.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { RISK_CLASSES } = require(path.join(ROOT, 'src', 'forge', 'risks.js'));
const { OBLIGATIONS } = require(path.join(ROOT, 'src', 'forge', 'bar.js'));

/** `test(` at the start of a line, in every test/*.test.js file. */
function testDeclarations() {
  const dir = path.join(ROOT, 'test');
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.test.js')) continue;
    n += (fs.readFileSync(path.join(dir, f), 'utf8').match(/^test\(/gm) || []).length;
  }
  return n;
}

/** Attack ids declared in the red queen harness. */
function attackCount() {
  const src = fs.readFileSync(path.join(ROOT, 'test', 'redqueen.js'), 'utf8');
  return new Set([...src.matchAll(/^attack\(\s*'([^']+)'/gm)].map((m) => m[1])).size;
}

function walkSource(dir, visit) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSource(p, visit);
    else if (e.name.endsWith('.js')) visit(p);
  }
}

/** Distinct `reason: '<slug>'` values across src/ — the named refusals. */
function refusalCount() {
  const all = new Set();
  walkSource(path.join(ROOT, 'src'), (p) => {
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/reason: '([a-z0-9-]+)'/g)) all.add(m[1]);
  });
  return all.size;
}

function sourceFiles() {
  let n = 0;
  walkSource(path.join(ROOT, 'src'), () => n++);
  return n;
}

const stats = {
  testDeclarations: testDeclarations(),
  attacks: attackCount(),
  riskClasses: RISK_CLASSES.length,
  obligations: OBLIGATIONS.length,
  refusalReasons: refusalCount(),
  sourceFiles: sourceFiles(),
};

if (process.argv.includes('--write')) {
  const md = [
    '# COUNTS — generated, do not edit',
    '',
    'Produced by `npm run stats -- --write`. `npm test` fails when this file is out',
    'of date, so a number here is either current or reported.',
    '',
    '| | |',
    '|---|---|',
    `| test declarations | ${stats.testDeclarations} |`,
    `| attacks | ${stats.attacks} |`,
    `| risk classes | ${stats.riskClasses} |`,
    `| bar obligations | ${stats.obligations} |`,
    `| named refusal reasons | ${stats.refusalReasons} |`,
    `| source files | ${stats.sourceFiles} |`,
    '',
    'Two things are deliberately absent. The live test total comes from `npm test`;',
    'generating it here would mean running the suite from inside the suite, which',
    'recurses. The audit grade comes from `npm run audit`, and it is a heuristic',
    'score, not a count.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'docs', 'COUNTS.md'), md);
  console.log(`wrote docs/COUNTS.md — ${stats.testDeclarations} test declarations, ${stats.attacks} attacks, ${stats.riskClasses} risk classes`);
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify(stats, null, 2));
} else {
  console.log('\nLIVE COUNTS — produced from the repository, not remembered\n');
  console.log(`  test declarations  ${stats.testDeclarations}   (npm test prints the live totals)`);
  console.log(`  attacks            ${stats.attacks}`);
  console.log(`  risk classes       ${stats.riskClasses}`);
  console.log(`  bar obligations    ${stats.obligations}`);
  console.log(`  named refusals     ${stats.refusalReasons}`);
  console.log(`  source files       ${stats.sourceFiles}`);
  console.log('');
  console.log('  A doc quoting a different number is a doc to fix. npm test checks.');
  console.log('');
}
process.exitCode = 0;
