'use strict';

/**
 * probe-rate.js — print the probe's measured false-positive rate.
 *
 *   node bin/probe-rate.js                 # the labelled corpus
 *   node bin/probe-rate.js --tree .        # the live tree, hits by class
 *
 * The number has to be produced, not remembered. This repository quoted a stale
 * count for three sessions after another branch had made it false.
 */

const path = require('node:path');
const { measureProbe, describe } = require('../src/forge/measure.js');
const { scanRisks, RISK_CLASSES } = require('../src/forge/risks.js');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);

if (argv.includes('--tree')) {
  const dir = argv[argv.indexOf('--tree') + 1] || ROOT;
  const hits = scanRisks(dir);
  const by = Object.create(null);
  for (const h of hits) {
    const c = h.class || h.id;
    by[c] = (by[c] || 0) + 1;
  }
  // HITS ARE SPLIT BY AREA, AND THAT SPLIT IS THE POINT.
  //
  // `hardcoded-identity` reports 203 places in this tree and 0 of them are in
  // src/. They are test fixtures, where a fixed identity is the thing being
  // tested -- constructing a witness with `nodeId: 'local-cockpit'` is how you
  // prove the node check works. Flattened into one total, 203 reads as a
  // codebase on fire, and the honest reader concludes the scanner is broken
  // rather than that they are looking at the fixtures. A class whose hits are
  // all fixtures is not the same finding as a class whose hits are all source.
  const area = (f) => {
    const rel = path.relative(path.resolve(dir), path.resolve(dir, f)).replace(/^\.\//, '');
    if (/(^|\/)src\//.test(rel)) return 'src';
    if (/(^|\/)(test|tests|__tests__|spec|fixtures)\//.test(rel) || /\.(test|spec)\.[cm]?js$/.test(rel)) return 'test';
    return 'other';
  };
  const areas = { src: 0, test: 0, other: 0 };
  const srcByClass = Object.create(null);
  for (const h of hits) {
    const a = area(h.file);
    areas[a]++;
    if (a === 'src') {
      const c = h.class || h.id;
      srcByClass[c] = (srcByClass[c] || 0) + 1;
    }
  }
  console.log(`\nPROBE — live scan of ${path.relative(ROOT, path.resolve(dir)) || '.'}`);
  console.log(`  classes in the vocabulary: ${RISK_CLASSES.length}`);
  console.log(`  hits: ${hits.length}  (src ${areas.src}, test ${areas.test}, other ${areas.other})`);
  for (const c of RISK_CLASSES) {
    const n = by[c.id] || 0;
    if (n) console.log(`    ${String(n).padStart(3)}  ${c.id}${srcByClass[c.id] ? `   ${srcByClass[c.id]} in src/` : '   none in src/'}`);
  }
  for (const [c, n] of Object.entries(by)) {
    if (!RISK_CLASSES.some((x) => x.id === c)) console.log(`    ${String(n).padStart(3)}  ${c}  (not in the vocabulary)`);
  }
  console.log('');
  console.log('  A hit is not a defect. It is a place this class could go wrong.');
  console.log(`  ${areas.test} of ${hits.length} are in tests, where a fixed identity is usually the point.`);
  console.log('  Read the src/ column first; a class that only fires in fixtures is reporting the fixtures.\n');
  process.exitCode = 0;
} else {
  const r = measureProbe(path.join(ROOT, 'test', 'fixtures', 'probe-corpus'));
  console.log(`\nPROBE FALSE-POSITIVE RATE\n  ${describe(r)}\n`);
  process.exitCode = r.rejected || r.fp > 0 || r.fn > 0 ? 1 : 0;
}
