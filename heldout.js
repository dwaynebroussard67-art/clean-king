'use strict';

/**
 * heldout.js — the command CI runs.
 *
 *   FORGE_HELDOUT_DIR=/somewhere/else node bin/heldout.js
 *
 * With no directory set it reports that nothing was checked. It does NOT report
 * a pass: an unrun check is not a passing check, which is the same rule the bar
 * applies to a gate that ran no tests.
 *
 * THE REPORT IS NUMBERS ONLY BY DEFAULT. Whoever holds the attacks is entitled
 * to know which of theirs failed; they are not entitled to a transcript that
 * somebody could read backwards into a fix. `--details` prints the operator's
 * log and is for the attack holder to run, not for the agent under test.
 */

const fs = require('node:fs');
const path = require('node:path');

const { run, components } = require('../src/forge/heldout.js');

const dir = process.env.FORGE_HELDOUT_DIR;
const details = process.argv.includes('--details');
const list = process.argv.includes('--components');

if (list) {
  const c = components();
  console.log('\nHELD-OUT COMPONENTS\n');
  for (const [name, spec] of Object.entries(c)) {
    console.log(`  ${name.padEnd(10)} check: ${spec.check.padEnd(16)} expected: ${spec.expected.join(' | ')}`);
    console.log(`  ${''.padEnd(10)} needs: ${spec.needs}`);
  }
  console.log('');
  process.exitCode = 0;
} else if (!dir) {
  console.log('');
  console.log('HELD-OUT ATTACKS — NOT RUN');
  console.log('  FORGE_HELDOUT_DIR is not set, so no held-out attacks were executed.');
  console.log('  This is not a pass. The audit grade says nothing about attacks this');
  console.log('  agent has not seen, which is the entire point of holding them out.');
  console.log('');
  process.exitCode = 0;
} else if (!fs.existsSync(dir)) {
  console.log(`\nHELD-OUT ATTACKS — NOT RUN\n  ${dir} does not exist.\n`);
  process.exitCode = 1;
} else {
  const results = run(dir);
  if (!results.length) {
    console.log(`\nHELD-OUT ATTACKS — NOT RUN\n  ${dir} contains no attacks.\n`);
    process.exitCode = 1;
  } else {
    const tally = { PASS: 0, FAIL: 0, 'NOT-APPLICABLE': 0 };
    for (const r of results) tally[r.verdict]++;

    // THE REPORT. Number and verdict, nothing else.
    for (const r of results) console.log(`${r.id}\t${r.verdict}`);

    console.log(
      `\n${results.length} run — ${tally.PASS} PASS, ${tally.FAIL} FAIL, ${tally['NOT-APPLICABLE']} NOT-APPLICABLE`
    );
    if (tally['NOT-APPLICABLE']) {
      console.log('NOT-APPLICABLE is not a pass: those attacks named a seam this system does not have.');
    }
    if (details) {
      console.log('\nOPERATOR LOG (do not show the agent under test)');
      for (const r of results) console.log(`  ${r.id}\t${r.verdict}\t${r.detail}`);
    }
    console.log('');

    // A run counts only if something was actually applicable, and nothing landed.
    process.exitCode = tally.FAIL > 0 ? 1 : tally.PASS === 0 ? 1 : 0;
  }
}
