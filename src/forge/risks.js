/**
 * risks.js — the risk vocabulary, and the Down seam made executable.
 *
 * WHY THIS FILE EXISTS
 *
 * `docs/ARCHITECTURE.md` claims the thing the hub is for:
 *
 *     a class of defect found in Fleets is written into TWLD's passport
 *     BEFORE IT HAPPENS THERE
 *
 * It was not true, in two separate ways.
 *
 *  1. THE CLASS NAME NEVER TRAVELLED. `ingest.js` scans a repository against a
 *     closed vocabulary and files one evidence row per class, with the class id
 *     as the row's SUBJECT. `hub.upEvidence` then landed
 *     `predicate: row.category` — the literal string `risk` — with the row's
 *     summary as the object. So the commons held
 *     `risk(repo:fleets) = "3 site(s) — a name trusted as an identity is a
 *     standing backdoor"`. Another repository's briefing could see that
 *     *somebody* had *some* risks. Which class, it could not tell: every class
 *     collapsed into one predicate whose objects differed by count and prose, so
 *     the grouping that makes `elsewhere` mean anything never happened.
 *
 *     The class is now the PREDICATE — `risk_hardcoded-identity` — and the
 *     object is the class's own `why`, verbatim from the vocabulary. That is the
 *     same split the lesson seam already uses: the CLASS travels, the site count
 *     and the example are specifics and stay in the passport that found them.
 *
 *  2. NOTHING RAN. A class arriving in a passport arrived as a line of markdown.
 *     An agent read it and might look, might not, and nothing would ever find
 *     out. `probe()` is the second half: given the classes other repositories
 *     have that this one has not filed, scan this tree for exactly those and
 *     report what is there, by file and line.
 *
 * THE VOCABULARY IS CLOSED, AND AN UNKNOWN CLASS IS REPORTED, NEVER DROPPED
 *
 * Six classes. A repository ingested by a newer scanner can file a seventh, and
 * a reader that does not know it must not report `clean` — that is a false
 * all-clear about a defect somebody else actually found. So `probe()` returns it
 * as `unknown-class` with the `why` it arrived with, and says plainly that it
 * cannot look for something it has no pattern for. Same posture as the bar's
 * unrecognized obligation: refuse, never strip; report, never guess.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { SHARED_REALM } = require('../federation/realm.js');
const { DEFAULT_CARRIER } = require('../federation/carrier.js');

/**
 * The risk vocabulary. CLOSED, because an open one is how a scan rots into a
 * junk drawer of things nobody can compare across repositories — and comparison
 * is the entire reason a class travels at all.
 *
 * `why` is not decoration. It is the boundary on the class: a pattern match is
 * not a defect, it is a place where this particular thing could go wrong, and a
 * probe that reported hits without the reason would arrive looking like a rule.
 */
const RISK_CLASSES = [
  // `(?:...)` and nothing else inside the quotes, so a detector DEFINITION that
  // lists the names as an alternation is not itself reported as a site. A real
  // hardcoded identity is a quoted literal holding one name.
  // IDENTITY MATTERS WHERE IT IS *DECIDED ON*, NOT WHERE IT IS NAMED.
  //
  // The first version of this pattern matched any assignment of a name to an
  // identity-ish field, which included ordinary default parameters -- every
  // `function f(actor = 'human')` in a codebase was reported as a standing
  // backdoor. That is a false positive on correct code, and a class that cries
  // wolf is worse than no class: it teaches a reader to skip the report.
  //
  // Two shapes are left, and both are a decision:
  //
  //   A. a COMPARISON against a privileged name -- `if (actor === 'human')`.
  //      This is the backdoor: the branch is taken on a literal, so every caller
  //      that can write the string is privileged.
  //   B. an authority-bearing FIELD, as an object property, set to a privileged
  //      name -- `approvedBy: 'human'`. The colon is required, which is what
  //      excludes a default parameter: `actor = 'human'` uses `=`.
  //
  // Deliberately NOT matched, with the reason:
  //   · `nodeId` IS matched, but only as an OBJECT PROPERTY. A node naming itself
  //     in config is a fixed identity, and in this system `nodeId` is what
  //     authorizes a witness -- two seats sharing one makes distinct-witness
  //     arithmetic meaningless. The colon is what separates that from a default
  //     parameter: `nodeId: 'x'` fixes an identity, `function f(nodeId = 'x')`
  //     only supplies one when the caller says nothing.
  //   · `default` and `me` -- never a privilege check. `me` is a display name
  //     and `default` is a fallback; neither grants anything.
  //   · `witness === 'human'`, `source === 'human'`, `kind === 'human'` -- a
  //     CLASSIFICATION, not a decision. The field on the left has to be one that
  //     denotes authority, which is why the field is part of the pattern. Before
  //     that, six correct comparisons in this very tree were reported as a
  //     standing backdoor.
  //   · `actor: 'delegation:earned'` and `onBehalfOf: '${nodeId}'` -- a namespace
  //     and an interpolation, not a person. The value has to be a bare name: no
  //     `$` (not a template) and no `:` (not a qualified system actor). An
  //     earlier attempt whitelisted a handful of literal values instead, which
  //     silently blinded the scanner on two of its own labelled defects -- the
  //     suite caught it, and the lesson is that a detector narrowed by
  //     enumeration starts lying the moment the enumeration stops being current.
  { id: 'hardcoded-identity', re: /(?:actor|user|who|authorizedBy|approvedBy|onBehalfOf|principal|operator|role|owner|signer)\s*(?:===|!==|==|!=)\s*['"](?:human|operator|admin|root|superuser)['"]|(?:nodeId|harnessId|actor|operator|principal|signer|authorizedBy|approvedBy|onBehalfOf)\s*:\s*['"](?![^'"]*\$)(?![^'"]*:)[\w.-]+['"]/i, why: 'a name trusted as an identity is a standing backdoor' },
  // `(?<![\w$])` rather than `\b`: `$` is not a word character, so `\beval` matches
  // inside Playwright's `page.$$eval(`, which is a selector evaluator and not
  // dynamic execution. Running the probe over this repository's own tree is what
  // found that — 17 hits, most of them `$$eval`. `window.eval(` still matches,
  // because a `.` before it is a real call.
  { id: 'dynamic-execution', re: /(?<![\w$])eval\s*\(|new Function\s*\(|execSync\s*\(/, why: 'executing strings built from content' },
  { id: 'innerHTML-assignment', re: /\.innerHTML\s*=/, why: 'unescaped content into the DOM' },
  { id: 'record-truncation', re: /writeFileSync\([^)]*(jsonl|recorderPath)/, why: 'a chained log rewritten instead of appended can be erased' },
  { id: 'unchecked-secret', re: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i, why: 'a literal credential in source' },
  { id: 'shell-interpolation', re: /execSync\([^)]*\$\{|spawn\([^)]*\$\{/, why: 'user content reaching a shell' },
];

const RISK_PREFIX = 'risk_';

/**
 * `risk_*` predicates that are NOT defect classes.
 *
 * CLOSED, and it has to be kept by hand: the repair bar is `risk_repair_bar`,
 * because starting with `risk` is what makes `hub.down()` surface it beside the
 * classes with no hub change at all. A probe that treated it as a class would go
 * looking for a bar as though it were a defect, and would report it as an
 * unknown class in every repository that has one. Adding a new `risk_*`
 * predicate that is not a class means adding it here in the same commit.
 */
const NON_CLASS_RISK_PREDICATES = new Set(['risk_repair_bar']);

/**
 * File types a risk pattern is meaningful in. CLOSED, and stated here so a reader
 * can see what is NOT covered: the Red Queen found that a site planted in `.jsx`,
 * `.vue`, `.c`, `.sh` or any of eleven other extensions was invisible and came
 * back reported as clean. Widening the list narrows that; it does not close it,
 * and a language nobody added is still a false all-clear.
 *
 * DATA AND CONFIG FILES ARE DELIBERATELY ABSENT — no `.json`, `.yaml`, `.env`,
 * `.toml`, `.lock`. Credentials do live there, and that is exactly why: a probe
 * prints the line it matched, and a report that echoes a real secret is a report
 * that can be pasted into a passport, a chat composer or a pull request. Code is
 * scanned; the places a credential is most likely to be are not, and
 * `unchecked-secret` hits are redacted even in source.
 */
const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|vue|svelte|astro|py|pyi|rb|go|rs|java|kt|kts|swift|m|mm|c|h|cc|cpp|cxx|hpp|cs|dart|scala|sc|ex|exs|erl|hrl|pl|pm|lua|r|jl|sh|bash|zsh|fish|ps1|psm1|tf|sql|groovy|gradle|clj|cljs|hs|ml|nim|zig|sol|php)$/;

// SEGMENT-ANCHORED, NOT SUBSTRING.
//
// The first version was `/(node_modules|...|out|...)/`, which matches those
// words ANYWHERE in a path. A directory called `heldout-sample` contains "out",
// so every file under it was silently skipped and the scanner reported clean.
// Same for `about/`, `checkout/`, `output/`, `layout/`. A false all-clear is the
// worst thing a probe can produce, and this one was invisible because the report
// said `clean` rather than `nothing scanned`.
//
// A skip list names DIRECTORY NAMES. It has to match a whole segment.
const SKIP = /(^|[\\/])(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo|vendor|\.venv|__pycache__)([\\/]|$)/;

/**
 * Strip the comment off a line and test what is left.
 *
 * This replaced a line-PREFIX test, and the reason is an attack that landed: a
 * line can open a block comment — a coverage pragma, say — and then hold real
 * code after the comment closes on the same line. Skipping such a line whole hid
 * the site. A prefix test is also wrong in the other direction: it cannot see a
 * trailing line comment at all.
 *
 * The example is deliberately written WITHOUT a live instance of the defect it
 * describes. Documentation that quotes a real hardcoded identity is a hardcoded
 * identity as far as any scanner is concerned, and `bin/diamond.js` audits this
 * directory — the first version of this comment cost the audit its P.
 *
 * It is a heuristic, not a parser: the interior lines of a multi-line block
 * comment are still scanned, and a `#` inside a string literal is treated as
 * starting a comment. Both errors are in the direction of reporting a site a
 * human can look at and dismiss, rather than hiding one — replacing text with a
 * space can only remove a match, never create one.
 */
function codePartOf(line) {
  return String(line)
    .replace(/^\s*\*+\/?/, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/, ' ')
    .replace(/#.*$/, ' ');
}

/** Kept exported because a reader may want to know what the scanner ignores. */
const COMMENT = /^\s*(\*|\/\/|\/\*|#)/;

/** A credential shape is redacted from the reported line, wherever it appears. */
function redact(id, text) {
  if (id !== 'unchecked-secret') return text;
  return String(text).replace(/(['"])[A-Za-z0-9_\-]{16,}\1/g, '$1<redacted>$1');
}

const byId = new Map(RISK_CLASSES.map((c) => [c.id, c]));

// THE STORE LOWERCASES EVERY FIELD, INCLUDING THE PREDICATE.
//
// `normalizeField` is deliberate — "The France." and "france" are the same field
// — but it means `risk_innerHTML-assignment` is stored as
// `risk_innerhtml-assignment`. Looking the class up by its own spelling misses,
// and a miss is not neutral: the class falls through to `unknownClass` and the
// probe reports a defect it knows perfectly well how to find as something it has
// never heard of. So the vocabulary is indexed lowercased, and `riskPredicate`
// emits the form the store will keep.
const byLowerId = new Map(RISK_CLASSES.map((c) => [c.id.toLowerCase(), c]));

const riskPredicate = (id) => `${RISK_PREFIX}${String(id).toLowerCase()}`;

/** `risk_hardcoded-identity` -> the class, or null. `risk_repair_bar` is NOT a
 *  risk class — it is the repair bar, and it must not be scanned for. */
function classFromPredicate(predicate) {
  const p = String(predicate || '').trim().toLowerCase();
  if (!p.startsWith(RISK_PREFIX)) return null;
  return byLowerId.get(p.slice(RISK_PREFIX.length)) || null;
}

function walkSource(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p) || e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...walkSource(p));
    else if (SOURCE_EXT.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Scan a tree for one class, or for all of them.
 *
 * Every hit carries its file and line, because a finding nobody can go and look
 * at is an opinion.
 */
function scanRisks(dir, files = null, { only = null } = {}) {
  // `only` is matched case-insensitively because the ids arrive from predicates
  // the store has lowercased. Matching them exactly would silently scan nothing
  // for `innerHTML-assignment` and report a clean tree.
  const wantedKeys = only ? new Set(only.map((x) => String(x).toLowerCase())) : null;
  const wanted = wantedKeys ? RISK_CLASSES.filter((c) => wantedKeys.has(c.id.toLowerCase())) : RISK_CLASSES;
  const list = Array.isArray(files) ? files : walkSource(dir);
  const hits = [];
  for (const f of list) {
    if (!SOURCE_EXT.test(f)) continue;
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (const c of wanted) {
      for (let i = 0; i < lines.length; i++) {
        // The pattern is tested against the CODE on the line; the line reported
        // is the original, so a reader sees what is actually there.
        if (c.re.test(codePartOf(lines[i]))) {
          hits.push({ id: c.id, why: c.why, file: path.relative(dir, f), line: i + 1, text: redact(c.id, lines[i].trim().slice(0, 140)) });
        }
      }
    }
  }
  return hits;
}

/**
 * THE DOWN SEAM, EXECUTABLE.
 *
 * What other repositories have that this one has not filed, looked for HERE.
 *
 * The selection is the point. Scanning everything and printing everything is a
 * linter, and a repository already has one. What no single repository can
 * produce is the list of classes that were *found somewhere else and are absent
 * from its own evidence* — that list only exists because the hub can see the
 * others. `probe()` takes exactly that list and runs exactly those patterns.
 *
 * Writes nothing. Like the bar's guard, a probe is a read.
 *
 * @param {object} federation
 * @param {object} opts
 * @param {string} opts.slug     the repository being probed
 * @param {string} opts.dir      the tree to scan (defaults to the registry's localPath)
 * @param {string} [opts.carrier]
 * @param {boolean} [opts.all]   scan every class, not only the ones found elsewhere
 */
function probe(federation, { slug, dir = null, carrier = DEFAULT_CARRIER, all = false, limit = 6 } = {}) {
  const me = String(slug == null ? '' : slug).trim();
  if (!me) return { rejected: true, reason: 'slug', detail: 'A repository slug is required: a probe compares this repository against the others.' };

  const brief = federation.briefing({ realm: SHARED_REALM, carrier, viewer: me });
  if (brief.rejected) return brief;

  const subject = `repo:${me}`;
  const mine = new Set();
  const elsewhere = new Map();
  const unknown = new Map();

  for (const f of brief.facts) {
    const predicate = f.equation.predicate;
    if (!String(predicate).startsWith('risk')) continue;
    const cls = classFromPredicate(predicate);

    if (f.equation.subject === subject) {
      if (cls) mine.add(cls.id.toLowerCase());
      continue;
    }
    if (cls) {
      const key = cls.id.toLowerCase();
      const e = elsewhere.get(key) || { id: cls.id, key, why: cls.why, seenIn: new Set() };
      e.seenIn.add(f.equation.subject);
      elsewhere.set(key, e);
    } else if (!NON_CLASS_RISK_PREDICATES.has(predicate) && predicate !== 'risk') {
      // A class this reader has no pattern for. NOT dropped and NOT reported as
      // clean: that would be a false all-clear about a defect somebody else
      // actually found. `risk_repair_bar` is excluded — it starts with `risk`
      // but it is the repair bar, not a defect class.
      const u = unknown.get(predicate) || { predicate, object: f.equation.object, seenIn: new Set() };
      u.seenIn.add(f.equation.subject);
      unknown.set(predicate, u);
    }
  }

  // What to look for: the classes found elsewhere and not filed here. `--all`
  // scans the whole vocabulary, which is a lint and says so.
  const wanted = all ? RISK_CLASSES.map((c) => c.id) : [...elsewhere.keys()].filter((key) => !mine.has(key));

  let target = dir;
  if (!target) {
    const node = federation.nodes && federation.nodes.get ? federation.nodes.get(me) : null;
    target = node && node.localPath;
  }
  if (!target) {
    return {
      rejected: true,
      reason: 'no-directory',
      detail: `No tree to scan. Pass dir, or register repo:${me} with a localPath so the probe can find it.`,
    };
  }
  let st = null;
  try {
    st = fs.lstatSync(target);
  } catch {
    st = null;
  }
  if (!st || !st.isDirectory()) {
    return { rejected: true, reason: 'missing-directory', detail: `There is no directory to scan at ${target}.` };
  }

  const files = walkSource(target);
  const hits = wanted.length ? scanRisks(target, files, { only: wanted }) : [];
  // Keyed lowercased, for the same reason: hits carry the vocabulary's own
  // spelling and `wanted` carries the store's.
  const byClass = new Map();
  for (const h of hits) {
    const k = String(h.id).toLowerCase();
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k).push(h);
  }

  const classes = wanted.map((key) => {
    const k = String(key).toLowerCase();
    const cls = byLowerId.get(k);
    const found = byClass.get(k) || [];
    const seen = elsewhere.get(k);
    return {
      // Reported in the vocabulary's own spelling, whatever case arrived.
      id: cls ? cls.id : key,
      why: cls ? cls.why : null,
      // Where it was found elsewhere. Empty under `--all`, which is a lint of
      // this tree and not a cross-repository read — and the difference is worth
      // keeping visible rather than blurring.
      seenIn: seen ? [...seen.seenIn].sort() : [],
      here: found.length,
      sites: found.slice(0, limit).map((f) => ({ file: f.file, line: f.line, text: f.text })),
      more: found.length > limit ? found.length - limit : 0,
    };
  });

  // A TREE WITH NO SOURCE FILES IN IT HAS NOT BEEN CLEARED.
  //
  // "0 files scanned, class X not present" reads as a pass over a tree nobody
  // looked at, which is the same false all-clear as an unknown class folded into
  // `clean`. So the per-class verdict is three-valued, exactly like the bar's:
  // found, clean, or indeterminate — and indeterminate never counts as clean.
  const nothingScanned = files.length === 0 && wanted.length > 0;
  for (const c of classes) c.verdict = c.here > 0 ? 'found' : nothingScanned ? 'indeterminate' : 'clean';

  const found = classes.filter((c) => c.verdict === 'found');
  const clean = classes.filter((c) => c.verdict === 'clean');
  const indeterminate = classes.filter((c) => c.verdict === 'indeterminate');

  return {
    ok: true,
    wrote: false,
    ...(nothingScanned ? { reason: 'nothing-scanned' } : {}),
    indeterminate,
    slug: me,
    carrier,
    dir: path.resolve(target),
    scanned: files.length,
    selection: all ? 'every class in the vocabulary' : 'classes found elsewhere and not filed here',
    classes,
    found,
    clean,
    // Reported, never folded into `clean`.
    unknownClass: [...unknown.values()]
      .filter((u) => !mine.has(String(u.predicate.slice(RISK_PREFIX.length)).toLowerCase()))
      .map((u) => ({ predicate: u.predicate, object: u.object, seenIn: [...u.seenIn].sort() })),
    // Classes this repository already files for itself. Not scanned under the
    // default selection: they are known, and repeating a known finding is noise.
    alreadyFiled: [...mine].map((k) => (byLowerId.get(k) ? byLowerId.get(k).id : k)).sort(),
    withheld: brief.withheld,
    detail: found.length
      ? `${found.length} class(es) found elsewhere are present here too: ${found.map((c) => `${c.id} (${c.here})`).join(', ')}`
      : nothingScanned
        ? `${wanted.length} class(es) were selected but there is no source file under ${path.resolve(target)} to look in. Nothing was cleared.`
        : wanted.length
          ? `${wanted.length} class(es) found elsewhere are not present in the ${files.length} source file(s) scanned here`
          : 'no class found elsewhere is missing here, so there was nothing to look for',
  };
}

/**
 * One detector, one definition.
 *
 * `bin/diamond.js` audits `src/` for the same classes this vocabulary names, and
 * until it asked for them here it carried its own copies of two of the patterns.
 * Two copies of a detector are two detectors that drift, and the drift shows up
 * as an audit that passes over a site the probe reports — or, as happened, an
 * audit that fails on the file where the shared pattern lives.
 */
function classPattern(id) {
  const c = byId.get(id) || byLowerId.get(String(id).toLowerCase());
  return c ? c.re : null;
}

module.exports = { RISK_CLASSES, RISK_PREFIX, NON_CLASS_RISK_PREDICATES, byId, byLowerId, SOURCE_EXT, SKIP, COMMENT, codePartOf, redact, riskPredicate, classFromPredicate, classPattern, walkSource, scanRisks, probe };
