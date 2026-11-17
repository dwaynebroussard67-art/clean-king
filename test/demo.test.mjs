import test from 'node:test';
import assert from 'node:assert/strict';
import { eligible, simulateCoverage, coverageCrew } from '../lib/demo.mjs';

test('school skips uncleared backup and selects next eligible worker', () => {
  const result = simulateCoverage(coverageCrew, 'school');
  assert.deepEqual(result.log.map(x => x.outcome), ['skipped', 'accepted']);
  assert.equal(result.filledBy, 'Marcus Reed');
});
test('hospital requires clearance and health training', () => {
  assert.equal(eligible({ ...coverageCrew[0], health: false }, 'hospital'), false);
  assert.equal(eligible({ ...coverageCrew[0], health: false }, 'hospital', false), true);
  assert.equal(simulateCoverage(coverageCrew, 'hospital').filledBy, 'Ana Torres');
});
test('unavailable, untrained, over cap and invalid site are rejected', () => {
  const w = coverageCrew[2];
  assert.equal(eligible({ ...w, available: false }, 'school'), false);
  assert.equal(eligible({ ...w, rookie: false }, 'school'), false);
  assert.equal(eligible({ ...w, hours: 39 }, 'school'), false);
  assert.equal(eligible(w, 'unknown'), false);
  assert.equal(eligible(null, 'school'), false);
});
test('no eligible crew escalates instead of offering to uncleared workers', () => {
  assert.deepEqual(simulateCoverage([], 'school'), { log: [], filledBy: null });
  const result = simulateCoverage([{ ...coverageCrew[0], school: false }], 'school');
  assert.equal(result.filledBy, null);
  assert.equal(result.log[0].outcome, 'skipped');
});
test('malformed eligibility and hours fail closed', () => {
  const w = coverageCrew[2];
  for (const changes of [{hours: NaN}, {hours: '10'}, {shiftHours: 0}, {cap: -1}, {available: 'yes'}, {school: 'yes'}, {rookie: 1}]) {
    assert.equal(eligible({ ...w, ...changes }, 'school'), false);
  }
  assert.equal(eligible({ ...w, hours: 36 }, 'school'), true);
});
