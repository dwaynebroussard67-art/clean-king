'use strict';

/**
 * measure.js — turn "the probe seems noisy" into a number.
 *
 * A false-positive rate that is remembered is a rumour. This measures it against
 * a hand-labeled corpus, so the rate is a tracked quantity that has to hold as
 * the patterns change. The rule it enforces is the one from docs/PROBE.md: a
 * report nobody believes is a report nobody reads.
 *
 * LABELS, NOT EXPECTATIONS. Each entry says what a human decided, not what the
 * code does. A file that is genuinely a defect is `true` even if the scanner is
 * currently missing it — that is a false NEGATIVE, and counting it as "the
 * scanner is right" would be the same self-grading the red queen exists to
 * refuse.
 */

const fs = require('node:fs');
const path = require('node:path');

const { scanRisks } = require('./risks.js');

/**
 * @param {string} dir   a directory holding labelled source files + labels.json
 * @returns {{scanned:number, labeled:number, tp:number, fp:number, fn:number,
 *            precision:number|null, recall:number|null, misses:string[], noise:string[],
 *            hitsByFile:Record<string, number>}}
 *
 * `precision` is null when the scanner reported nothing: 0/0 is not a perfect
 * score, it is an absence of evidence, and reporting it as 1 would be a green
 * nobody earned. Same three-valued posture as the bar.
 */
function measureProbe(dir) {
  const labelsPath = path.join(dir, 'labels.json');
  const raw = fs.readFileSync(labelsPath, 'utf8');
  let labels;
  try {
    labels = JSON.parse(raw);
  } catch {
    return { rejected: true, reason: 'labels-unparseable', detail: 'labels.json is not JSON.' };
  }

  const entries = Object.entries(labels).filter(([, v]) => v && typeof v === 'object' && typeof v.label === 'boolean');
  if (!entries.length) {
    return { rejected: true, reason: 'nothing-labeled', detail: 'labels.json holds no labelled file.' };
  }

  // Every labelled file must actually be on disk, or the corpus has drifted from
  // its labels and the rate is computed over a set nobody can see.
  const missing = entries.filter(([file]) => !fs.existsSync(path.join(dir, file))).map(([file]) => file);
  if (missing.length) {
    return { rejected: true, reason: 'labeled-file-absent', detail: `labelled but not on disk: ${missing.join(', ')}` };
  }

  // Scan only the corpus, and only for the classes the labels name.
  const hits = scanRisks(dir).filter((h) => path.resolve(h.file) !== path.resolve(labelsPath));
  const hitsByFile = Object.create(null);
  for (const h of hits) {
    const name = path.basename(h.file);
    hitsByFile[name] = (hitsByFile[name] || 0) + 1;
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  const misses = [];
  const noise = [];
  const unlabeled = [];

  for (const [file, spec] of entries) {
    const found = hitsByFile[file] || 0;
    if (spec.label === true && found > 0) tp++;
    else if (spec.label === true && found === 0) {
      fn++;
      misses.push(file);
    } else if (spec.label === false && found > 0) {
      fp++;
      noise.push(file);
    }
  }
  for (const [file, found] of Object.entries(hitsByFile)) {
    if (!labels[file] && found > 0) unlabeled.push(file);
  }

  const reported = tp + fp;
  return {
    scanned: hits.length,
    labeled: entries.length,
    tp,
    fp,
    fn,
    // null, not 1: nothing reported is not the same as everything reported well.
    precision: reported === 0 ? null : tp / reported,
    recall: tp + fn === 0 ? null : tp / (tp + fn),
    misses,
    noise,
    unlabeled,
    hitsByFile,
  };
}

/** One-line rendering, used by the CLI and by the test's failure message. */
function describe(result) {
  if (result.rejected) return `not measured: ${result.reason} — ${result.detail}`;
  if (result.precision === null) {
    return `nothing reported over ${result.labeled} labelled file(s) (${result.fn} known defect(s) missed) — precision is undefined, not perfect`;
  }
  return (
    `precision ${(result.precision * 100).toFixed(0)}% (${result.tp} true, ${result.fp} false) ` +
    `over ${result.labeled} labelled file(s)` +
    (result.fn ? `; MISSED ${result.fn}: ${result.misses.join(', ')}` : '')
  );
}

module.exports = { measureProbe, describe };
