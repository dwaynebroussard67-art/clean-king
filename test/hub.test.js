'use strict';

/**
 * hub.test.js — the hub, which had no tests at all.
 *
 * `hub.js` is the only part of the system that can see two repositories at once,
 * which makes it the only part that can produce the thing the whole design is
 * for: a class of defect found in one place, named in another before it happens
 * there. It was 260 lines with zero coverage, and it had a real defect in it —
 * the class name never travelled.
 *
 * These pin the UP side (what a repository contributes), the DOWN side (what a
 * reader is handed), and the probe that turns the second one from a sentence
 * into something that runs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { fedWith, tmp } = require('./helpers/fed.js');
const { RepoPassport } = require('../src/passport/passport.js');
const { upEvidence, down, link } = require('../src/federation/hub.js');
const { RISK_CLASSES, riskPredicate, classFromPredicate, scanRisks, probe, codePartOf, SOURCE_EXT } = require('../src/forge/risks.js');
const { landLesson } = require('../src/forge/lessons.js');
const { readCycle } = require('../src/forge/lessons.js');
const { buildCycle } = require('./helpers/cycle.js');
const { normalizeField } = require('../src/passport/equation.js');

/** The store lowercases and strips a leading article from every field, on
 *  purpose. Anything compared against a landed equation has to go through it. */
const norm = normalizeField;

/** A passport with risk evidence filed the way `bin/ingest.js` files it. */
function passportWith(slug, risks, opts = {}) {
  const repoDir = tmp(`ff-repo-${slug}-`);
  const p = new RepoPassport(repoDir, { realm: `repo:${slug}`, slug, remote: `https://github.com/me/${slug}` });
  p.init({ languages: ['javascript'], testCommand: opts.testCommand || 'npm test' });
  for (const r of risks) {
    p.recordEvidence({
      category: 'risk',
      subject: r.id,
      detail: { summary: `${r.count || 1} site(s) — ${r.why}`, count: r.count || 1, why: r.why, example: r.example || `src/a.js:10` },
      witness: { kind: 'structural', ref: `scan:${r.id}` },
    });
  }
  if (!risks.length) {
    p.recordEvidence({ category: 'risk', subject: 'scan', detail: 'no risk patterns matched', witness: { kind: 'structural', ref: 'scan:clean' } });
  }
  if (opts.test) {
    p.recordEvidence({ category: 'test', subject: 'command', detail: opts.test, witness: { kind: 'structural', ref: 'package.json' } });
  }
  return p;
}

const cls = (id) => RISK_CLASSES.find((c) => c.id === id);

/** A tiny tree with one planted site of `id`, or nothing planted. */
function treeWith(id, { plant = true } = {}) {
  const dir = tmp('ff-tree-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const body = plant && id === 'hardcoded-identity'
    ? "const cfg = { nodeId: 'local-cockpit' };\nmodule.exports = cfg;\n"
    : plant && id === 'dynamic-execution'
      ? "const run = (s) => eval(s);\nmodule.exports = run;\n"
      : "const ok = 1;\nmodule.exports = ok;\n";
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), body);
  fs.writeFileSync(path.join(dir, 'README.md'), 'nodeId: "local-cockpit" is in a markdown file and is not source\n');
  return dir;
}

// --------------------------------------------------------------- UP: evidence

test('a risk class travels with its CLASS in the predicate, not the bare category', () => {
  const fed = fedWith('fleets');
  const p = passportWith('fleets', [{ id: 'hardcoded-identity', why: cls('hardcoded-identity').why, count: 3 }]);
  const res = upEvidence(p, fed);
  assert.equal(res.refused.length, 0, JSON.stringify(res.refused));
  const fact = fed.live().find((f) => f.equation.predicate === riskPredicate('hardcoded-identity'));
  assert.ok(fact, 'the commons holds risk_hardcoded-identity');
  assert.equal(fact.equation.subject, 'repo:fleets');
  assert.equal(fact.equation.predicate, 'risk_hardcoded-identity');
});

test('the object is the class\'s own `why`, so two repositories with one class collapse into one line downstream', () => {
  const fed = fedWith('fleets', 'striper', 'twld');
  upEvidence(passportWith('fleets', [{ id: 'dynamic-execution', why: cls('dynamic-execution').why, count: 3 }]), fed);
  upEvidence(passportWith('striper', [{ id: 'dynamic-execution', why: cls('dynamic-execution').why, count: 1 }]), fed);

  // Two facts, because the SUBJECT is the repository and a fact about fleets is
  // not a fact about striper. What has to collapse is the read: same predicate,
  // same object, so `down()` groups them into ONE entry naming both.
  const facts = fed.live().filter((f) => f.equation.predicate === riskPredicate('dynamic-execution'));
  assert.equal(facts.length, 2);
  for (const f of facts) assert.equal(f.equation.object, norm(cls('dynamic-execution').why), 'the count does not reach the object, so the objects agree');

  const brief = down(fed, passportWith('twld', []), { realm: 'repo:twld', viewer: 'twld' });
  const entries = brief.elsewhere.filter((e) => e.predicate === riskPredicate('dynamic-execution'));
  assert.equal(entries.length, 1, 'one class, one line — not two rows differing by count');
  assert.deepEqual(entries[0].seenIn, ['repo:fleets', 'repo:striper']);
});

test('a mixed-case class id survives the store lowercasing every field', () => {
  // REGRESSION. `normalizeField` lowercases the predicate too, so
  // `risk_innerHTML-assignment` is stored as `risk_innerhtml-assignment`. A
  // lookup by the vocabulary's own spelling misses, and a miss is not neutral:
  // the class falls through to `unknownClass` and the probe reports a defect it
  // knows how to find as something it has never heard of.
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [{ id: 'innerHTML-assignment', why: cls('innerHTML-assignment').why }]), fed);
  const fact = fed.live().find((f) => String(f.equation.predicate).startsWith('risk_'));
  assert.equal(fact.equation.predicate, 'risk_innerhtml-assignment');
  assert.equal(classFromPredicate(fact.equation.predicate).id, 'innerHTML-assignment');
  assert.equal(riskPredicate('innerHTML-assignment'), fact.equation.predicate, 'the emitted form is the stored form');

  const clean = probe(fed, { slug: 'twld', dir: treeWith(null) });
  assert.deepEqual(clean.unknownClass, [], 'a known class is not reported as an unknown one');
  assert.equal(clean.classes.length, 1);
  assert.equal(clean.classes[0].id, 'innerHTML-assignment', 'reported in the vocabulary\'s own spelling');

  // And the scan itself must not miss on case: `only` is matched against the
  // vocabulary while the ids that select it came back lowercased.
  const dir = tmp('ff-inner-');
  fs.writeFileSync(path.join(dir, 'a.js'), "const el = document.querySelector('#x');\nel.innerHTML = body;\n");
  const hit = probe(fed, { slug: 'twld', dir });
  assert.equal(hit.found.length, 1, JSON.stringify(hit.classes));
  assert.equal(hit.found[0].id, 'innerHTML-assignment');
  assert.equal(hit.found[0].here, 1);
});

test('the site count and the example do NOT travel — they are specifics', () => {
  const fed = fedWith('fleets');
  upEvidence(passportWith('fleets', [{ id: 'unchecked-secret', why: cls('unchecked-secret').why, count: 7, example: 'src/keys.js:44' }]), fed);
  const fact = fed.live().find((f) => f.equation.predicate === riskPredicate('unchecked-secret'));
  assert.ok(fact);
  assert.equal(fact.equation.object, norm(cls('unchecked-secret').why));
  assert.equal(/7/.test(fact.equation.object), false, 'a count is about one tree');
  assert.equal(/keys\.js/.test(fact.equation.object), false, 'and so is a file name');
  // They are still in the passport that found them.
  const rows = passportWith('fleets', [{ id: 'unchecked-secret', why: cls('unchecked-secret').why, count: 7, example: 'src/keys.js:44' }]).liveEvidence('risk');
  assert.equal(rows[0].detail.count, 7);
  assert.equal(rows[0].detail.example, 'src/keys.js:44');
});

test('every other category keeps its own name as the predicate', () => {
  const fed = fedWith('fleets');
  upEvidence(passportWith('fleets', [], { test: 'npm test' }), fed);
  const test_ = fed.live().find((f) => f.equation.predicate === 'test');
  assert.ok(test_, 'a test command is one question, so the category is the predicate');
  assert.equal(test_.equation.object, norm('npm test'));
});

test('a clean scan is not promoted into a warning', () => {
  const fed = fedWith('fleets');
  upEvidence(passportWith('fleets', []), fed);
  const facts = fed.live().filter((f) => String(f.equation.predicate).startsWith('risk'));
  assert.equal(facts.some((f) => classFromPredicate(f.equation.predicate)), false, 'no class was found, so no class travels');
});

// -------------------------------------------------------------------- DOWN

test('a class found in one repository arrives in another\'s briefing, NAMED', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [{ id: 'hardcoded-identity', why: cls('hardcoded-identity').why }]), fed);
  const twld = passportWith('twld', []);
  const brief = down(fed, twld, { realm: 'repo:twld', viewer: 'twld' });

  const found = brief.elsewhere.find((e) => e.predicate === riskPredicate('hardcoded-identity'));
  assert.ok(found, `the class is in elsewhere: ${JSON.stringify(brief.elsewhere)}`);
  assert.equal(found.object, norm(cls('hardcoded-identity').why));
  assert.deepEqual(found.seenIn, ['repo:fleets']);
  assert.ok(fs.existsSync(brief.docPath), 'and it was written into the passport');
  const doc = fs.readFileSync(brief.docPath, 'utf8');
  assert.match(doc, /risk_hardcoded-identity/);
  assert.match(doc, /standing backdoor/);
});

test('a class this repository already has is in `own`, not `elsewhere`', () => {
  const fed = fedWith('fleets', 'twld');
  const why = cls('innerHTML-assignment').why;
  upEvidence(passportWith('fleets', [{ id: 'innerHTML-assignment', why }]), fed);
  upEvidence(passportWith('twld', [{ id: 'innerHTML-assignment', why }]), fed);
  const twld = passportWith('twld', [{ id: 'innerHTML-assignment', why }]);
  const brief = down(fed, twld, { realm: 'repo:twld', viewer: 'twld' });
  assert.ok(brief.own.some((f) => f.equation.predicate === riskPredicate('innerHTML-assignment')));
  assert.equal(brief.elsewhere.some((e) => e.predicate === riskPredicate('innerHTML-assignment')), false);
});

test('a scope line rides with a repair lesson, so the method cannot arrive as a rule', () => {
  const fed = fedWith('clearcut', 'twld');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut' });
  const read = readCycle(dir);
  assert.equal(read.ok, true);
  const landed = landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  assert.equal(landed.refused.length, 0, JSON.stringify(landed.refused));

  const twld = passportWith('twld', []);
  const brief = down(fed, twld, { realm: 'repo:twld', viewer: 'twld' });
  const bar = brief.elsewhere.find((e) => e.predicate === 'risk_repair_bar');
  assert.ok(bar, 'the repair bar reaches another repository');
  assert.deepEqual(bar.scope, ['bounded-historical-observation-not-universal-rule']);
});

test('crossRepo groups by predicate, which is the read no member could produce alone', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [], { test: 'npm test' }), fed);
  upEvidence(passportWith('twld', [], { test: 'pytest' }), fed);
  const brief = down(fed, passportWith('twld', [], { test: 'pytest' }), { realm: 'repo:twld', viewer: 'twld' });
  const onTest = brief.crossRepo.find((d) => d.predicate === 'test');
  assert.ok(onTest, JSON.stringify(brief.crossRepo));
  assert.equal(onTest.answers.length, 2);
});

// ------------------------------------------------------------------- PROBE

test('probe finds here what was filed elsewhere, by file and line', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [{ id: 'hardcoded-identity', why: cls('hardcoded-identity').why }]), fed);

  const tree = treeWith('hardcoded-identity');
  const res = probe(fed, { slug: 'twld', dir: tree });
  assert.equal(res.ok, true);
  assert.equal(res.selection, 'classes found elsewhere and not filed here');
  assert.equal(res.found.length, 1);
  assert.equal(res.found[0].id, 'hardcoded-identity');
  assert.equal(res.found[0].here, 1);
  assert.equal(res.found[0].sites[0].file, path.join('src', 'a.js'));
  assert.equal(res.found[0].sites[0].line, 1);
  assert.deepEqual(res.found[0].seenIn, ['repo:fleets']);
  assert.equal(res.found[0].why, cls('hardcoded-identity').why, 'the reason travels with the hit');
  assert.match(res.detail, /present here too/);
});

test('probe reports a class found elsewhere and absent here as clean, not as nothing', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [{ id: 'dynamic-execution', why: cls('dynamic-execution').why }]), fed);
  const tree = treeWith('hardcoded-identity'); // no eval in it
  const res = probe(fed, { slug: 'twld', dir: tree });
  assert.equal(res.found.length, 0);
  assert.equal(res.clean.length, 1);
  assert.equal(res.clean[0].id, 'dynamic-execution');
  assert.deepEqual(res.clean[0].seenIn, ['repo:fleets']);
  assert.match(res.detail, /not present in the/);
});

test('probe does not re-scan a class this repository already filed', () => {
  const fed = fedWith('fleets', 'twld');
  const why = cls('hardcoded-identity').why;
  upEvidence(passportWith('fleets', [{ id: 'hardcoded-identity', why }]), fed);
  upEvidence(passportWith('twld', [{ id: 'hardcoded-identity', why }]), fed);
  const tree = treeWith('hardcoded-identity');
  const res = probe(fed, { slug: 'twld', dir: tree });
  assert.deepEqual(res.alreadyFiled, ['hardcoded-identity']);
  assert.deepEqual(res.classes, [], 'a known finding repeated back is noise');
  assert.match(res.detail, /nothing to look for/);
});

test('a class this reader has no pattern for is reported, and never folded into clean', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [{ id: 'hardcoded-identity', why: cls('hardcoded-identity').why }]), fed);
  // Another repository runs a newer scanner and files a seventh class.
  fed.land({
    shelf: 'operational', realm: 'shared',
    equation: { subject: 'repo:fleets', predicate: 'risk_untrusted-deserialization', object: 'a decoder that builds objects from content' },
    witness: 'structural', nodeId: 'fleets', reference: 'scan:untrusted-deserialization', target: 'repo:fleets',
  });
  const tree = treeWith(null);
  const res = probe(fed, { slug: 'twld', dir: tree });
  assert.equal(res.unknownClass.length, 1);
  assert.equal(res.unknownClass[0].predicate, 'risk_untrusted-deserialization');
  assert.deepEqual(res.unknownClass[0].seenIn, ['repo:fleets']);
  assert.equal(res.clean.some((c) => c.id === 'untrusted-deserialization'), false, 'it is not reported as clean');
  assert.equal(res.found.length, 0);
});

test('the repair bar is not mistaken for a defect class', () => {
  // `risk_repair_bar` starts with `risk`, and a probe that scanned for it would
  // be looking for a bar as though it were a defect.
  assert.equal(classFromPredicate('risk_repair_bar'), null);
  assert.equal(classFromPredicate('risk_hardcoded-identity').id, 'hardcoded-identity');

  const fed = fedWith('clearcut', 'twld');
  const dir = tmp();
  buildCycle(dir, { project: 'clearcut' });
  const read = readCycle(dir);
  landLesson(fed, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
  const res = probe(fed, { slug: 'twld', dir: treeWith(null) });
  assert.equal(res.classes.some((c) => c.id === 'repair_bar'), false);
  assert.equal(res.unknownClass.some((u) => u.predicate === 'risk_repair_bar'), false, 'a bar is neither a class nor an unknown one');
});

test('probe writes nothing', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [{ id: 'hardcoded-identity', why: cls('hardcoded-identity').why }]), fed);
  const before = { head: fed.head, bytes: fs.statSync(fed.logPath).size, facts: fed.stats().facts };
  const res = probe(fed, { slug: 'twld', dir: treeWith('hardcoded-identity') });
  assert.equal(res.wrote, false);
  assert.equal(res.found.length, 1);
  assert.deepEqual({ head: fed.head, bytes: fs.statSync(fed.logPath).size, facts: fed.stats().facts }, before);
});

test('`--all` is a lint of this tree, and says so rather than pretending to be a cross-repo read', () => {
  const fed = fedWith('twld');
  const res = probe(fed, { slug: 'twld', dir: treeWith('hardcoded-identity'), all: true });
  assert.equal(res.selection, 'every class in the vocabulary');
  assert.equal(res.classes.length, RISK_CLASSES.length);
  assert.deepEqual(res.found.map((c) => c.id), ['hardcoded-identity']);
  assert.deepEqual(res.found[0].seenIn, [], 'nothing was found elsewhere, so nothing is claimed to have been');
});

test('probe refuses to guess what to scan', () => {
  const fed = fedWith('twld');
  assert.equal(probe(fed, {}).reason, 'slug');
  const noDir = probe(fed, { slug: 'nonesuch' });
  assert.equal(noDir.reason, 'no-directory');
  const missing = probe(fed, { slug: 'twld', dir: path.join(tmp(), 'absent') });
  assert.equal(missing.reason, 'missing-directory');
});

test('probe finds a registered repository\'s own tree without being told where it is', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [{ id: 'hardcoded-identity', why: cls('hardcoded-identity').why }]), fed);
  // `fedWith` registers every slug with localPath /tmp/<slug>, which does not
  // exist — the refusal has to name that, not crash on it.
  const res = probe(fed, { slug: 'twld' });
  assert.equal(res.rejected, true);
  assert.equal(res.reason, 'missing-directory');
  assert.match(res.detail, /no directory to scan/i);
});

test('a tree with no source files in it is NOT SCANNED, and no class is called clean', () => {
  // "0 files scanned, class X not present" reads as a pass over a tree nobody
  // looked at. Same three-valued rule as the bar: indeterminate is not clean.
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [{ id: 'hardcoded-identity', why: cls('hardcoded-identity').why }]), fed);
  const res = probe(fed, { slug: 'twld', dir: tmp() });
  assert.equal(res.scanned, 0);
  assert.equal(res.reason, 'nothing-scanned');
  assert.deepEqual(res.clean, []);
  assert.equal(res.indeterminate.length, 1);
  assert.equal(res.indeterminate[0].verdict, 'indeterminate');
  assert.deepEqual(res.found, []);
  assert.match(res.detail, /Nothing was cleared/);
});

test('a class verdict is three-valued: found, clean, or indeterminate', () => {
  const fed = fedWith('fleets', 'twld');
  upEvidence(passportWith('fleets', [
    { id: 'hardcoded-identity', why: cls('hardcoded-identity').why },
    { id: 'dynamic-execution', why: cls('dynamic-execution').why },
  ]), fed);
  const res = probe(fed, { slug: 'twld', dir: treeWith('hardcoded-identity') });
  assert.equal(res.scanned, 1);
  const byIdOut = Object.fromEntries(res.classes.map((c) => [c.id, c.verdict]));
  assert.equal(byIdOut['hardcoded-identity'], 'found');
  assert.equal(byIdOut['dynamic-execution'], 'clean');
  assert.equal(res.indeterminate.length, 0);
});

test('the scanner reads the languages it claims to, and says which it does not', () => {
  for (const ext of ['js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'c', 'cpp', 'cs', 'kt', 'swift', 'sh', 'lua', 'scala', 'exs', 'py', 'rb', 'go', 'rs', 'java', 'php']) {
    assert.ok(SOURCE_EXT.test(`Component.${ext}`), `.${ext} is not scanned, so a site in it is a false all-clear`);
  }
  // Data and config files are absent ON PURPOSE: a probe prints the line it
  // matched, and a report echoing a real credential is a report that can be
  // pasted somewhere it should not go.
  for (const ext of ['json', 'yaml', 'yml', 'env', 'toml', 'lock', 'md']) {
    assert.equal(SOURCE_EXT.test(`secrets.${ext}`), false, `.${ext} must not be scanned`);
  }
});

test('a credential is redacted from the line a probe reports', () => {
  const dir = tmp('ff-secret-');
  fs.writeFileSync(path.join(dir, 'a.js'), "const cfg = { api_key: 'sk_live_0123456789abcdef' };\n");
  const hits = scanRisks(dir);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'unchecked-secret');
  assert.match(hits[0].text, /<redacted>/);
  assert.equal(/sk_live_0123456789abcdef/.test(hits[0].text), false, 'the literal must not reach a report that could travel');
  assert.equal(hits[0].line, 1, 'the location still does');
});

test('a comment is not a site, but code sharing a line with one is', () => {
  const dir = tmp('ff-comment-');
  fs.writeFileSync(
    path.join(dir, 'a.js'),
    [
      "// const cfg = { nodeId: 'local-cockpit' };",
      '/* eval(s) */',
      '# eval(s)',
      'const clean = 1;',
    ].join('\n') + '\n'
  );
  assert.deepEqual(scanRisks(dir), [], 'a pattern match inside a comment is not a place the thing can go wrong');

  // The evasion that landed: a block-comment OPENER on a line that also holds
  // real code. A prefix test skips the whole line and hides the site.
  const dir2 = tmp('ff-comment2-');
  fs.writeFileSync(path.join(dir2, 'a.js'), "/* istanbul ignore next */ const cfg = { nodeId: 'local-cockpit' };\n");
  const hits = scanRisks(dir2);
  assert.equal(hits.length, 1, 'the pattern is tested against the code left on the line, not against its prefix');
  assert.equal(hits[0].line, 1);
  assert.match(hits[0].text, /istanbul/, 'and the line reported is the original, so a reader can see what is there');

  // A trailing comment must not hide the code before it either.
  assert.equal(codePartOf("el.innerHTML = body; // safe, apparently"), 'el.innerHTML = body;  ');
  assert.equal(codePartOf('/* nothing */ eval(x) /* more */').trim(), 'eval(x)');
});

test('a selector evaluator is not dynamic execution, but window.eval is', () => {
  // Found by running the probe over this repository's own tree: Playwright's
  // `page.$$eval(` matched `\beval(` because `$` is not a word character.
  const dir = tmp('ff-eval-');
  fs.writeFileSync(
    path.join(dir, 'a.js'),
    [
      "const n = await page.$$eval('#rail .seat', (nodes) => nodes.length);",
      'const rows = await page.$eval(".row", (el) => el.id);',
      'window.eval(payload);',
      'eval(other);',
      'const f = new Function(body);',
      'const out = execSync(cmd);',
    ].join('\n') + '\n'
  );
  const hits = scanRisks(dir);
  const lines = hits.map((h) => h.line).sort();
  assert.deepEqual(lines, [3, 4, 5, 6], `lines 1 and 2 are Playwright evaluators: ${JSON.stringify(hits)}`);
});

test('markdown is not source, so a hit in a README is not a finding', () => {
  const dir = treeWith('hardcoded-identity');
  const hits = scanRisks(dir);
  assert.equal(hits.length, 1);
  assert.equal(hits.some((h) => h.file.endsWith('.md')), false);
});
