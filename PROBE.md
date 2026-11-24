# THE PROBE — the Down seam, made executable

`docs/ARCHITECTURE.md` claims the thing the hub exists for:

> a class of defect found in Fleets is written into TWLD's passport **before it
> happens there**

It was not true, in two separate ways, and both were in `hub.js` — 260 lines that
had never had a test.

---

## 1. The class name never travelled

`bin/ingest.js` scans a repository against a closed vocabulary and files one
evidence row per class, with the class id as the row's **subject**:

```
category: 'risk'   subject: 'hardcoded-identity'   detail: { summary: '3 site(s) — …', count: 3, example: 'src/a.js:7' }
```

`hub.upEvidence` then landed `predicate: row.category` — the literal string
`risk` — with the row's summary as the object. So the commons held:

```
risk(repo:fleets) = 3 site(s) — a name trusted as an identity is a standing backdoor
risk(repo:fleets) = 1 site(s) — executing strings built from content
```

Another repository's briefing could see that *somebody* had *some* risks. Which
class, it could not tell — and because the objects differed by count and prose,
the same class in two repositories never collapsed into one `elsewhere` entry
naming both. The grouping that makes the hub worth having did not happen. `hub.down()`
even had the right filter for it, `predicate.startsWith('risk')`, waiting on
predicates that were all just `risk`.

Now:

```
risk_hardcoded-identity(repo:fleets) = a name trusted as an identity is a standing backdoor
risk_dynamic-execution(repo:striper) = executing strings built from content
```

**The class is the predicate; the object is the class's own `why`, verbatim from
the vocabulary.** That is the same split the lesson seam uses: the CLASS travels,
the site count and the example are specifics and stay in the passport that found
them. Two repositories with one class now produce one equation each with an
identical object, so `down()` groups them into a single line with
`seenIn: [both]` — and `crossRepo`, which groups by predicate, can finally answer
"on this class, how many of us differ".

`why` is not decoration. It is the boundary on the class: a pattern match is not
a defect, it is a place where this particular thing could go wrong. A probe that
reported hits without the reason would arrive looking like a rule.

### The store lowercases every field, including the predicate

`normalizeField` is deliberate — *"The France." and "france" are the same field* —
but it means `risk_innerHTML-assignment` is stored as
`risk_innerhtml-assignment`. Looking a class up by its own spelling misses, and a
miss is not neutral: the class falls through to *unknown* and the probe reports a
defect it knows perfectly well how to find as something it has never heard of.
The vocabulary is indexed lowercased, `riskPredicate` emits the form the store
keeps, and the three places this could bite (the predicate lookup, the `only`
filter, and the hit grouping) are all case-normalised. Red Queen **C7** pins it.

---

## 2. Nothing ran

A class arriving in a passport arrived as a line of markdown. An agent read it
and might look, might not, and nothing would ever find out. Same shape as the
repair bar: a guide with nothing behind it.

```
fed probe --slug forge-federation
```

```
probe repo:forge-federation  [repair]  270 source file(s) under /home/user/Forge-Federation
  selection: classes found elsewhere and not filed here

  FOUND HERE  hardcoded-identity — 19 site(s)
    why: a name trusted as an identity is a standing backdoor
    found in 1 other(s): repo:fleets
    · omnibox/src/federation/bridge.js:73  nodeId: 'local-cockpit',
    · omnibox/src/main/main.js:1056  passport.boundary.adjudicate(id, { actor: 'human' });
    · +17 more

  UNKNOWN CLASS  risk_untrusted-deserialization — no pattern here, so it was NOT looked for
    arrived as: decoder that builds objects from content
    filed by: repo:fleets

  2 class(es) found elsewhere are present here too: hardcoded-identity (19), dynamic-execution (7)
  vocabulary: 6 classes · wrote: false
```

**The selection is the point.** Scanning everything and printing everything is a
linter, and a repository already has one. What no single repository can produce
is the list of classes *found somewhere else and absent from its own evidence* —
that list only exists because the hub can see the others. `probe()` takes exactly
that list and runs exactly those patterns. `--all` scans the whole vocabulary
instead, and says so, because a lint of this tree is not a cross-repository read
and blurring the two would make the second one look cheaper than it is.

Like the bar's guard, **it writes nothing**.

### Three verdicts, and `indeterminate` is not `clean`

A class comes back `found`, `clean`, or `indeterminate`. A tree with no source
files in it produces `nothing-scanned` and calls nothing clean — "0 files
scanned, class X not present" reads as a pass over a tree nobody looked at, which
is the same false all-clear as an unknown class folded into `clean`. Red Queen
**C2** landed on exactly that.

### An unknown class is reported, never dropped

A repository ingested by a newer scanner can file a seventh class. A reader that
does not know it must not report `clean`: that is a false all-clear about a
defect somebody else actually found. It comes back as `unknownClass` with the
`why` it arrived with and the repositories that filed it, the command exits
non-zero, and it says plainly that it cannot look for something it has no pattern
for. Same posture as the bar's unrecognized obligation.

### `risk_repair_bar` is not a defect class

It starts with `risk` — deliberately, because that is what makes `hub.down()`
surface the bar beside the classes with no hub change at all. A probe that
treated it as a class would go looking for a bar as though it were a defect, and
would tell every repository that has one to go and scan itself for it. There is a
closed set of `risk_*` predicates that are not classes, and adding a new one
means adding it there in the same commit. **C6** pins it.

---

## The vocabulary

Six classes, closed. `why` travels with every hit.

| id | why |
|---|---|
| `hardcoded-identity` | a name trusted as an identity is a standing backdoor |
| `dynamic-execution` | executing strings built from content |
| `innerHTML-assignment` | unescaped content into the DOM |
| `record-truncation` | a chained log rewritten instead of appended can be erased |
| `unchecked-secret` | a literal credential in source |
| `shell-interpolation` | user content reaching a shell |

### What is scanned, and what deliberately is not

`SOURCE_EXT` covers 40-odd source extensions. It used to cover 11, and Red Queen
**C3** found that a site planted in `.jsx`, `.vue`, `.c`, `.sh` or any of eleven
others was invisible and came back reported as **clean**. Widening the list
narrows that; it does not close it, and a language nobody added is still a false
all-clear.

**Data and config files are absent on purpose** — no `.json`, `.yaml`, `.env`,
`.toml`, no lockfiles. Credentials do live there, and that is exactly why: a
probe prints the line it matched, and a report that echoes a real secret is a
report that can be pasted into a passport, a chat composer or a pull request.
Code is scanned; the places a credential is most likely to be are not. And even
in source, an `unchecked-secret` hit has the literal replaced with `<redacted>`
while keeping the file and line, so the finding is actionable and the credential
is not in the output.

### A comment is not a site, but code sharing a line with one is

Patterns are tested against `codePartOf(line)` — the line with its comments
stripped — and the line **reported** is the original, so a reader sees what is
actually there. This replaced a line-prefix test, and the reason is an attack
that landed (**C4**): a line can open a block comment, close it, and then hold
real code. A prefix test skips the whole line and hides the site. It is also
wrong in the other direction — it cannot see a trailing line comment at all.

It is a heuristic, not a parser. The interior lines of a multi-line block comment
are still scanned, and a `#` inside a string literal is treated as starting a
comment. Both errors are in the direction of reporting a site a human can look at
and dismiss, rather than hiding one: replacing text with a space can only remove a
match, never create one.

Running the probe over this repository's own tree found one more false positive,
which is now fixed: `\beval(` matches inside Playwright's `page.$$eval(`, because
`$` is not a word character. `(?<![\w$])eval` excludes it and still catches
`window.eval(`.

---

## One detector, one definition

`bin/diamond.js` audits `src/` for the same classes this vocabulary names, and
until now it carried its own copies of two of the patterns. Two copies of a
detector are two detectors that drift, and the drift shows up as an audit that
passes over a site the probe reports — or fails on one it does not.

Diamond now asks `src/forge/risks.js` for the pattern and uses the same
`codePartOf`, so the audit and the probe agree by construction about what a site
is.

That agreement cost the audit its **P** for one commit, and the reason is worth
keeping: the first version of `codePartOf`'s doc comment quoted a live
`nodeId: 'local-cockpit'` as an example. A hardcoded identity in a comment is not
a backdoor, but it is a hardcoded identity as far as any scanner is concerned —
and with the comment-stripping now shared, the honest fix was to write the
example without a live instance of the defect it documents. **Documentation that
quotes the defect is the defect**, in a tree that greps for it.

---

## Tests

`test/hub.test.js` (26) is the first coverage `hub.js` has ever had. It pins the
UP side (the class travels as the predicate, the `why` as the object, the count
does not), the DOWN side (a class found in one repository arrives in another's
briefing *named*, with its `seenIn`, and written into `PASSPORT.md`; a class this
repository already has lands in `own` and not in `elsewhere`; a repair lesson's
scope line rides with it), and the probe (found by file and line, clean,
already-filed, unknown-class, nothing-scanned, writes nothing, redacts, and does
not mistake the repair bar for a defect).

Red Queen **C1–C8**: three landed (C2 empty tree, C3 extension coverage, C4
comment opener) and all three are fixed. `npm run redqueen` is
**0 LANDED, 0 UNPROVEN, 34 blocked**.

---

## Still open

- **The probe is not wired to anything.** It is a command an agent has to decide
  to run. The natural home is the passport's `PASSPORT.md` — a `risk_*` line in
  `elsewhere` should carry the command that checks it, the way `fed brief` now
  carries the pointer to `fed bar` and `fed guard`.
- **A hit is not a defect, and the rate is now measured.** `npm run probe:rate`
  scores the scanner against `test/fixtures/probe-corpus/`: **precision 100%
  (5 true, 0 false) over 10 labelled files**. `npm run probe:rate -- --tree`
  scans this repository: **222 hits — 2 in `src/`, 214 in tests, 6 elsewhere.**
  The two `src/` hits are `actor: 'forgeflight'` and `actor: 'system'`, both
  system-actor labels in the `omnibox/` ancestor, neither a privilege grant.
  Three earlier numbers quoted in this document — 19, then 6, then 3 — were all
  counts taken before the pattern changed, and all three are removed rather than
  left to be read as current. A wrong count that survives a fix is worse than no
  count, and this document produced three of them.
- **The split by area is the finding, not the total.** 203 of those hits are
  `hardcoded-identity` and almost all are test fixtures, where a fixed identity
  is the thing being tested: constructing a witness with `nodeId: 'local-cockpit'`
  is how you prove the node check works. Flattened into one total, 203 reads as a
  codebase on fire and the honest reader concludes the scanner is broken. That is
  why the scan now prints an `src/` column beside each class.
- **Precision on ten files is not a precision.** Every labelled file was chosen
  by the same person who wrote the pattern, and five of the ten exist because a
  real false positive was found and then given a name. That is the right way to
  build the set and the wrong way to estimate a rate from it. `npm run heldout`
  is the intended check and prints **NOT RUN** until a directory of attacks the
  fixer has not read is supplied — and NOT RUN is not a pass.
- **Nothing closes the loop back.** A probe that finds a class here should be
  able to file it as this repository's own evidence, so the next reader sees it
  in `alreadyFiled` instead of being told about it again. That is an
  `ingest.js` run, not a probe write — a probe that mutated memory would stop
  being a probe.
