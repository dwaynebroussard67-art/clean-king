# THE REPAIR BAR — a guide with something behind it

A completed repair cycle lands this in the commons:

```
risk_repair_bar(repo:clearcut) = exact-parent-edits-only;native-tests-unchanged;3-gates-passed;promoted-not-released
claim_scope(repo:clearcut)     = bounded-historical-observation-not-universal-rule
```

Another repository's passport picks it up through `hub.down()` and prints it
under *"Found elsewhere in the system — not yet here"*, with the scope line
beside it. That is the guide arriving.

**And then nothing happens.** An agent reads the sentence, does whatever it was
going to do anyway, and no part of the system ever finds out. A memory that can
be ignored without consequence is a suggestion, and this repository's whole
posture is that conventions do not hold — enforcement lives in the identity, not
in the file path, and not in the prose either.

`src/forge/bar.js` is the answer to that. It is also the place where the answer
nearly became the exact mistake the rest of the system was built to avoid.

---

## Why the obvious fix is wrong

The obvious fix is to make the bar a rule: refuse work that does not clear it.

That breaks the design in the place the design is most careful. Every lesson
carries `claim_scope = bounded-historical-observation-not-universal-rule`.
Making repository B refuse a repair because repository A once cleared three gates
is precisely *a method that arrived looking like a rule* — the failure
`lessons.js` splits commons from scoped to prevent, reintroduced one layer up,
with a CLI in front of it.

## The resolution: the bar is the condition of comparison

`exact-parent-edits-only;3-gates-passed` is not a claim about how repairs ought
to be done. It is the set of conditions under which the promotion this
repository already recorded **meant what it says**. So the question the bar can
honestly answer is not *"are you allowed to do this?"* but:

> can this cycle be measured against what this repository already knows?

If the new cycle clears two gates where the recorded bar is three, the two cycles
are not comparable, and any claim of continuity between them — *we repaired it
again, the same way* — is unsupported. That is a statement about **evidence**,
not about permission. It refuses to *witness*, not to *act*. The agent is still
free to promote whatever it likes; it just cannot file it beside the earlier work
as though the two were the same kind of thing.

Hence the vocabulary of the verdict:

| | |
|---|---|
| `COMPARABLE` | this cycle can be filed beside what the repository already knows |
| `NOT COMPARABLE` | it cannot, and the reason is named obligation by obligation |
| `REFUSED` | the guard could not run at all — wrong subject, tampered receipt, unverified ledger |

`ALLOWED` and `FORBIDDEN` do not appear anywhere, on purpose.

---

## The flow

```
BEFORE the repair      fed bar --slug clearcut --issue .forge/bar.json
                       └─ reads the commons, freezes what it read, hashes it

       the agent repairs; the engine writes its cycle directory

AFTER the repair       fed guard <cycle-dir> --slug clearcut --bar .forge/bar.json
                       └─ comparable / not comparable / refused. Writes nothing.
```

`fed brief` ends with that pointer whenever the repository has a bar, so the
executable path is discoverable from the read that precedes it.

---

## Four properties that are load-bearing

### 1. Three-valued verdicts, and `indeterminate` never counts as met

An obligation comes back `met`, `unmet`, or `indeterminate`. A two-valued check
turns *"I could not tell"* into *"fine"*, which is the same silent upgrade as
reading a bar off an unhashed summary. `comparable` requires **every** obligation
`met`.

```
[met          ] exact-parent-edits-only
[UNMET        ] native-tests-unchanged
                   the cycle edited 1 test path(s): test/auth.test.js. A gate
                   count from tests the cycle itself rewrote is not a gate count.
[met          ] 3-gates-passed
[met          ] promoted-not-released
```

### 2. A closed vocabulary, and an unknown token poisons the whole bar

If the bar string contains a token this reader has no check for, the bar is
`unverifiable` and **no cycle is comparable to it**. Checking the three tokens it
recognises and reporting a pass would be reporting a pass over a bar it never
fully read. Decision D6 — refuse, never strip — applied to an obligation list.

The same rule catches a bar that contradicts itself (`3-gates-passed;5-gates-
passed`), one that repeats an obligation, and one that is empty.

#### A minimum of zero is not an obligation

`0-gates-passed` parses cleanly, is not an unknown token, and is satisfied by every
cycle that will ever exist. A bar containing it is `unverifiable` for the same
reason a bar containing an unknown token is: it cannot serve as a standard.

This is not hypothetical. Found by Red Queen **D2**: a cycle built with no gate
evaluations at all filed `0-gates-passed` into the commons, and that became the
repository's standing standard — every later cycle satisfied it forever. Drift
even *reported* the change correctly (`3-gates-passed -> 0-gates-passed`, a
loosening), but reporting is not preventing. A standard that asks for nothing
reads exactly like a standard.

The rule is about zero, not about small numbers: `1-gates-passed` is a real
obligation and parses fine.

A vacuous bar **blocks** rather than merely declining to compare — `blocking:
true`, exit 1. That is deliberate and it is the difference from
`no-bar-recorded`, which also answers `comparable: false` but with `blocking:
false`. An absent bar means a new repository has nothing to compare against; an
illegible bar means the standard itself has to be fixed before anything can
proceed.

### 3. Your bar binds you; nobody else's does

The binding bar is the one whose subject is `repo:<the slug being guarded>`.
Every other repository's bar is reported as **advisory**, with its scope line
attached, and there is no code path from an advisory obligation to a refusal —
`guardCycle` on a repository with no bar of its own evaluates **zero**
obligations and returns `reason: 'no-bar-recorded'`, `blocking: false`.

Two more refusals sit on the same principle:

- `cycle-is-not-subject` — the cycle's lesson artifact names project `X` and the
  bar belongs to `repo:Y`. The project comes from a content-addressed blob, so
  renaming the slug does not rename the cycle.
- `receipt-is-not-subject` / `receipt-is-not-carrier` — a receipt issued for one
  repository or one carrier cannot hold a cycle guarded as another.

### 4. Only the repository, citing its own ledger, sets its own bar

`land()` validates that a node is **registered**; it never checks that the node
is talking about **itself**, because for most facts that would be wrong — five
distinct nodes witnessing one claim is the whole promotion rule.

A bar is not most facts. The Red Queen found that `fleets` could land
`risk_repair_bar(repo:clearcut) = promoted-not-released`, reduce clearcut's four
obligations to one, and sail a cycle that had edited its own tests straight
through. So `readBar` requires two things of any bar it will let bind:

| | |
|---|---|
| **the repository said it** | every witness is the subject itself, or arrived through a bridge with provenance attached |
| **it is re-derivable** | every witness points at a `ledger:<64-hex>` head, or is a named `human` ruling |

A bar that fails either is not deleted and not hidden. It is reported as
`disputed`, with the nodes and references that disqualify it, and a note that
says how to make one bind. That includes a **proxy ingest**: a hub filing
`onBehalfOf` a repository produces a bar that informs and does not bind, because
a bar the repository did not assert itself is not the repository's standard.

---

## The receipt is hashed, because the bar is what holds the agent

A bar read at the moment of checking is a bar nobody was ever shown. So
`fed bar --issue` writes a **receipt**: the obligations, the signature of every
fact they were derived from, the store head at issue time, the earlier bars they
superseded, the disputed bars that were rejected, and the pattern vocabulary the
checks will use. Then

```
id = sha256(canonical(receipt − id))
```

— the same rule as a ledger event, recomputed on the way back in.

That is not decoration. The bar is the thing that says no, so an agent that does
not like the bar **edits the receipt**. An unhashed receipt can be loosened
between issue and guard by anybody who can write one plain file: that is the M1
hole in a new place, and it is closed the same way. `writeBarReceipt` also
refuses to overwrite, for the same reason, and `readBarReceipt` refuses a
symlink, because a receipt that can be a link can be swapped.

### Drift

The receipt makes the commons' movement reportable instead of invisible.

| movement | effect |
|---|---|
| an obligation **gained** | `bar-drifted-harder` — **blocks** |
| a gate minimum **raised** | `bar-drifted-harder` — **blocks** |
| a gate minimum **lowered** | reported, does **not** block |
| an obligation **dropped** | reported, does **not** block |
| only the store head moved | reported |

The comparison is by obligation **kind**, not by token text: `3-gates-passed` →
`2-gates-passed` is a different string and an *easier* bar, and calling that a
tightening would block work for the commons getting kinder — which would teach
people to ignore the drift report.

A cycle is always held to the bar it was **shown**. When the commons has
tightened since, the answer is not "you fail the new one" but "you were never
shown the new one, so this cannot be filed against it".

The drift check runs **before** the `no-bar-recorded` return. A receipt issued
when the repository had no bar records `binding: null`; without that ordering an
agent could freeze a standing exemption by asking for the bar early and then
ignoring the day one appeared.

---

## Which bar binds when a repository has run several cycles

`land()` keys on the equation's signature and does **not** supersede, so a second
cycle whose gate count differs leaves a **second** `risk_repair_bar` fact for the
same subject rather than replacing the first.

| rule | why not |
|---|---|
| take the first | the bar freezes at whatever the oldest cycle cleared |
| take the strictest | ratchets upward forever and blocks ordinary work |
| **take the most recent** | a bar is a fact about a moving target |

Recency is `lastSeenAt`, which `landLesson` sets from the cycle's own
`completedAt` — a timestamp **inside the hash chain**, so reordering the bars
means forging a ledger. Ties break on the signature, so the choice is
deterministic rather than dependent on Map iteration order.

The older bars are kept as `prior` and printed, and when one of them was
**stricter** than the bar that binds now, that becomes a note:

> `NOTE: this repository once recorded a stricter bar (…4-gates-passed…) than the one that binds now`

Guidance, not a refusal. The note travels; the ratchet does not.

---

## What each obligation actually checks

| token | checked against | `unmet` when |
|---|---|---|
| `exact-parent-edits-only` | the candidate event's **source** parent, the patch blob's copy of it, and the walked event ancestry | the patch was applied to something that is not the baseline manifest; the two in-chain copies disagree; the candidate does not descend from the baseline at all |
| `native-tests-unchanged` | `changedPaths`, from the hashed candidate event | any changed path matches the recorded test-path vocabulary |
| `<n>-gates-passed` | `repository.evaluated` events against the candidate with `passed === true` | fewer than *n* passed |
| `promoted-not-released` | the hashed `repository.promoted` event's `status` | the status is not `local-exact-source-promotion-not-release`; if it reads as a release, the detail says so harder |

**Two different parents live in a cycle and conflating them is the easy
mistake.** The candidate's *event* parents are the reproduction evaluation and
the contract — not the baseline. The parent the bar means is the **source**
parent, `candidate.data.parentId`: the manifest the patch was applied to. It is
recorded twice, in the event and inside the content-addressed patch blob, and
both are hashed, so the two are compared with each other as well as with the
baseline.

### The weakest check, stated plainly

`native-tests-unchanged` classifies paths against a closed vocabulary:

```
/(^|\/)(tests?|__tests__|spec|specs)\//i
/\.(test|spec|tests|specs)\.[a-z0-9]+$/i
/(^|\/)test_[^/]+$/i
```

A repository whose tests live in `checks/` or `probes/` will not match, and a
miss reports `met` when the truth is `unmet` — the unsafe direction. Two things
hold it up: the **input** is tamper-evident (`changedPaths` comes from a hashed
event, so hiding a path means breaking the ledger), and the **vocabulary** is
recorded in the receipt and echoed in the verdict, so any reader can see which
patterns decided it and object. What it cannot do is decide the question for a
layout it has never been told about, which is why an empty path list is
`indeterminate` rather than `met`.

Teaching the guard a repository's own test layout is an open item: the passport's
`test` evidence already names the test command, and nothing currently reads it
here.

---

## Guard writes nothing

`guardCycle()` reads the cycle, reads the bar, compares, returns. It lands no
fact and appends no event. The result carries `wrote: false` and
`headUnchanged: true` so a caller cannot assume otherwise, and the Red Queen
checks the store's head, byte length, fact count and event count across two
guards — one passing, one failing. A check that mutates memory is not a check;
it is a witness filing itself.

## Exit codes

| | |
|---|---|
| `0` | comparable, **or** no bar recorded |
| `1` | a blocking verdict against the cycle, or a refusal |

Exit `0` on `no-bar-recorded` is deliberate and worth arguing with. A repository
that has never had a cycle ingested has nothing to be compared against, and a
hook that aborted on it would block every repository the first time anybody tried
to repair it. The result still says `comparable: false` — nothing was cleared —
and `blocking: false` — the guard reached no verdict against the work. The two
are told apart by `reason`, never collapsed into one exit code.

---

## Where this leaves the loop

```
7. repair   a cycle runs, its ledger is re-verified from scratch, and the lesson
            lands — the method in the commons, the defect in its own realm
8. guard    the next cycle is issued the bar before it starts and held to it
            afterwards — comparable, not allowed
```

Still open, in rough order of how much they matter:

- **The bar does not reach the mutator.** The guard checks a finished cycle, not
  the search that produced it. The other half of the Down seam is now executable
  — `fed probe` looks for the risk classes other repositories filed, in this
  tree, by file and line — but a probe finding is still not a Hornet mutator or a
  frozen probe, and nothing turns one into either.
  **[`docs/PROBE.md`](PROBE.md)**
- **`promoted/` is a local promotion, not a release.** The Federation `Gate`
  (deferred → ticket → named human → released) should be that release path, and
  is not wired to it. `promoted-not-released` is the obligation that says the gap
  exists; it does not close it.
- **Nothing checks whether the bar is *good* guidance.** Integrity is provable;
  whether `exact-parent-edits-only` is the right thing to ask for is a harder
  question and not a Hornet question.

See **[`docs/RED-QUEEN.md`](RED-QUEEN.md)** for the ten attacks on this file
(B1–B10), three of which landed and were fixed, and
**[`docs/REPAIR-MEMORY.md`](REPAIR-MEMORY.md)** for the lesson seam the bar is
read out of.
