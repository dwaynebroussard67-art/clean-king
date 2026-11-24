# REPAIR MEMORY — a lesson becomes a guide, without becoming a rule

**One sentence:** a completed repair cycle in one repository is re-verified from
its own ledger and lands in the commons as *the method and its boundary*, so an
agent opening a different repository reads what verification looked like
somewhere that actually ran it — and never reads another repository's defects as
its own.

---

## The problem

Twin Labs runs a real repair cycle: freeze a probe, reproduce a failure twice on
unmodified source, apply exact-parent edits, gate the candidate against native
regressions and a locked randomized retest, promote it, retain a
content-addressed ledger of every step. Then it stamps the result

```js
status: 'bounded-historical-observation-not-universal-rule'
```

and **refuses to generalize**. Its own docs say the quiet part out loud:

> The recorded lessons are retained evidence, not automatic cross-project
> learning.

That refusal is not a missing feature. It is a soundness stance, and it is
correct — generalizing from one repository is how an agent ends up confidently
patching the wrong thing somewhere else.

The Federation is what makes generalizing **honest**, not what makes it possible.
A lesson stops being a bounded local observation and becomes a fact with a named
target, a witness kind, a realm and a promotion rule — and it carries its own
boundary with it.

---

## What may travel, and what may not

This is a judgment about scope, not about plumbing, and it is the whole design.

| | Where it lands | Why |
|---|---|---|
| **the method and its bar** | the commons | That a repair cleared exact-parent-only edits with native tests unchanged across N gates is *guidance* for an agent about to repair somewhere else. It says what "verified" looked like where it was actually run. |
| **the scope line** | the commons | Travels with the claim, every time. A lesson that arrives without its boundary is a rule. |
| **the promotion status** | the commons | `local-exact-source-promotion-not-release`, verbatim. Rewording that as "released" is exactly the quiet upgrade this must never do. |
| **the defect specifics** | `repo:<slug>` only | Repo A's probe failures are defined by repo A's probe contract. Telling repo B "you have this risk" because repo A's probe found it is precisely the over-reach the lesson refuses — a lie dressed as collective learning. |
| **every stated limit** | `repo:<slug>` only | One fact per limit. A limit that gets summarised away is a limit nobody will read. |

The predicates are `repair_verified`, `risk_repair_bar`, `claim_scope`,
`promotion` in the commons; `repaired_paths`, `reproduced_failures`, `limit_N`
scoped to the repository.

`risk_repair_bar` starts with `risk` **on purpose**: the hub's `down()` already
surfaces `risk*` predicates as "found elsewhere", so a repair lesson reaches
another repository's passport with no change to the hub. The naming did the work.

---

## Why the witness is `structural`, not `outcome`

A `structural` witness means *re-derivable from the artifact by anyone, on
demand*. If the Federation verified a cycle by calling the repair engine's own
verifier, the witness would mean "Twin Labs said it passed" — which is an
`outcome`, self-reported, and the store refuses to let a single node's outcome
travel at all.

So `src/forge/ledger.js` **reimplements the canonicalisation and the chain
check** from the published format. The repair engine's verdict is not an input.

```
the receipt      status `completed`, `failed` false, event count and head
                 matching the log actually on disk
the event chain  every id === sha256(canonical(body-minus-id)); every `previous`
                 links to the prior id; `sequence` 1..n with no gaps; one runId;
                 schemaVersion 1
the lineage      every `parents` entry names an EARLIER event, no duplicates
the artifacts    every blob at blobs/<id>, sha256(bytes) === id, recorded length
                 matches — including blobs no event references, because a crash
                 can leave them and an unchecked file in the evidence directory
                 is an unchecked claim
the head         the last event's id equals the receipt's head
```

`canonicalJson` is not `JSON.stringify`. It throws on a proxy, a symbol key, an
accessor, a sparse array, a cycle, `NaN`, `Infinity`, `-0` and a class instance —
each one a way for bytes on disk to stop meaning what the record says. Agreeing
on the encoding byte for byte is what makes independent verification possible at
all, since the event ids are digests of it.

### `summary.json` is a claim, not a source

`summary.json` and `receipt.json` sit **beside** the ledger and no hash covers
them. Reading the bar off the summary meant one writable plain file was enough to
make the commons assert `99-gates-passed` for a cycle that ran three — and that
claim then travels into every other repository's passport as guidance for an agent
about to patch source.

So every number that travels is derived from **inside the chain**:

| | derived from |
|---|---|
| `gatesPassed` | `repository.evaluated` events against the candidate with `passed === true` |
| `changedPaths` | the `repository.candidate` event |
| `reproducedFailingCases` | the discovery result **blob**, read through its address |
| `project` | the lesson **artifact**, not the summary's transcription of it |
| `promotedStatus` | the `repository.promoted` event |

The summary is still read — but only to be **checked**. Where it disagrees with
the chain the cycle is refused outright (`summary-disagrees`) rather than quietly
preferring one source, because a disagreement means somebody edited a file they
should not have and picking a winner silently hides exactly the thing worth
knowing. The refusal names the difference, not just the counts: two path lists of
the same length that disagree are the interesting case, and "1 vs 1" reads like a
bug.

The passport footer already carried this rule — *the chain is the truth, the
derived file is the reading of it*. It now applies to somebody else's derived
file too.

**A ledger that does not verify is not a lesson with a caveat on it. It is
nothing.** `readCycle` returns a named rejection and no facts land — not even the
`lesson-landed` event.

---

## What an agent actually reads

A repair cycle is ingested for `clearcut`. Then an agent opens `fleets`, which
has never run a cycle, and reads its own `forge-passport/PASSPORT.md`:

```
### Found elsewhere in the system — not yet here

_Every one of these was found in another repository. No repository can see_
_another, so this list only exists because the hub does._

- **risk_repair_bar** → exact-parent-edits-only;native-tests-unchanged;3-gates-passed;promoted-not-released
  - seen in 1 other(s): repo:clearcut
  - scope: bounded-historical-observation-not-universal-rule — what this does NOT claim
```

That is the whole mission in one rendering: **a class of practice found in one
place, named in another before it happens there**, with the boundary attached.

The scope line is attached by `hub.down()` from the same subject's `claim_scope`
fact. Without it, a method surfaced in the section an agent actually reads would
arrive looking like a rule — and the two must not be separable by the read that
matters most.

`clearcut`'s changed paths do **not** appear in `fleets`' passport. Verified by
test, not by intention.

---

## Using it

```bash
fed lessons <cycle-dir> --slug <slug> --node <nodeId> [--cycle] [--carrier repair]
```

```js
const { readCycle, landLesson, ingestCycle } = require('./src/forge/lessons.js');

const read = readCycle('/path/to/evidence/runs/my-cycle');
if (read.rejected) return read;            // named refusal, nothing landed
landLesson(federation, read.cycle, { slug: 'clearcut', nodeId: 'clearcut' });
```

`ingestCycle(federation, dir, { nodeId })` does both, taking the slug from the
cycle's `project` when none is given.

Re-ingesting the same cycle is idempotent: every fact comes back
`already-witnessed` and `distinct` stays 1. A repeated lesson does not
manufacture observations — the same rule the store already applies to a node
repeating itself.

---

## Refusals, by name

| | |
|---|---|
| `no-directory`, `missing-file`, `not-a-file`, `symlink` | the cycle is not there, or is not a regular file. Evidence that can be a link can be swapped. |
| `receipt-unparseable`, `summary-unparseable` | not JSON |
| `incomplete` | the receipt says anything other than `completed` |
| `failed-run` | the receipt records a failure. A failure is evidence, not a lesson. |
| `no-head`, `head-mismatch` | nothing to verify against, or the log was truncated or replaced |
| `event-count`, `run-id` | the receipt and the log disagree |
| `missing-event` | a completed cycle records `repository.promoted`, `.lesson` and `.completed` |
| `id-mismatch` | an event does not hash to its own id — edited, or written by a different canonicaliser |
| `chain-break`, `sequence-gap`, `lineage` | the log is not one ordered run over itself |
| `not-lossless` | an event cannot be canonicalised |
| `artifact-integrity`, `artifact-length`, `blob-integrity`, `stray-blob` | the content-addressed store does not hold together |
| `no-lesson-artifact`, `bad-address`, `blob-not-json` | the lesson is not readable through its address |
| `slug`, `nodeId`, `unregistered-node` | identity is a registered fact, not a string |
| `witness-is-not-subject` | a node filing a lesson about a *different* repository. The registry checks that a node exists; it cannot check that a node is talking about itself. `onBehalfOf` is the explicit proxy path and it is recorded on the event. |
| `summary-disagrees` | the unhashed summary does not match what the chain holds |
| `limit-too-long` | a stated limit will not fit one field, so the lesson is refused whole rather than the boundary being cut |
| `promotion-is-not-local` | the cycle's own promotion event does not read `local-exact-source-promotion-not-release`. The bar asserts `promoted-not-released`, so landing a **release** would put that token into the commons beside a `promotion` fact saying the opposite — and the pair travels. Found by Red Queen **B7**: the token was hardcoded whatever the status said. |
| `carrier` | a repair lesson lands on `repair`, never on the browser carrier |
| `gates-proved-nothing` | a gate recorded a pass with **no test run behind it** — a run-size count of zero, or an output field present but empty. The actuator refuses to commit on the same evidence (`no_test_signal`), so a cycle it would reject cannot publish a gate count here. Found by Red Queen **D1**. |
| `no-gates-recorded` | the cycle records no passing gate evaluation at all, so there is no count to publish, and `0-gates-passed` would be a bar no cycle could ever fail. Found by Red Queen **D2**. |

`limit-too-long` is decision **D6 — refuse, never strip** applied to a boundary. A
limit truncated to fit reads as a weaker limit than the repair engine wrote, and
quietly softening the boundary is the exact failure this module exists to prevent.
So the operator decides, not the field width.

That last one is a decision stated out loud rather than a limitation: source-level
detail on the browser carrier reaches a surface that types into third-party chat
composers, and it would tell a repair agent nothing it could not read in its own
carrier.

---

## The gate question, asked the same way twice

This system is two halves that were written on two branches and merged into one
`main` separately:

- the **write path** — `gate.js` → `actuator.js` → `referee.js` — which decides
  what may be committed;
- the **memory path** — `lessons.js` → `bar.js` → `hub.js` — which decides what
  may be filed and read by other repositories.

They disagreed about what "passed" means. The actuator refuses to commit a green
run that produced no test signal (`no_test_signal`: *"a command that proves nothing
cannot referee a commit"*). The memory path counted `passed === true` on every gate
evaluation and published the number. So a cycle the write path would reject could
still file `3-gates-passed` in the commons, where every other repository reads it
as a peer observation — and, once a cycle with no gates at all could file
`0-gates-passed`, could *lower* that repository's standing bar to nothing.

Red Queen **D1** demonstrated both ends of it, and **D2** found that the first fix
made the lowering easier rather than harder.

The correction is one definition, in `referee.js`, imported by both:

| signal | meaning |
|---|---|
| `present` | positively records a run: a run-size count above zero, or output matching `TEST_SIGNAL` |
| `absent` | positively records that nothing ran: a run-size count of exactly zero, or an output field present but empty |
| `unknown` | records only a verdict, `{passed: true}`, and says nothing either way |

`absent` gates do not count and refuse the lesson. `unknown` gates still count,
and that is the load-bearing decision: **the ledger format belongs to Twin Labs,
not to this repository.** A field this reader has never seen must not be read as
evidence of absence, or every unfamiliar cycle becomes a refusal nobody can act
on. `failed: 0` — what a green run reports — is `unknown`, not `absent`; treating
any zero as "nothing ran" would have refused every passing cycle in the
federation. Red Queen **D5** and **D6** attack exactly that over-correction.

The summary cross-check is deliberately left alone. `summary.passedGates` is
compared against the number of gate events that passed, which is what the summary
transcribes; whether those gates *prove* a run is a different question, asked
separately. Collapsing the two would report a hollow gate as `summary-disagrees`
and send the operator to fix a transcription that is not wrong.

---

## Reported, never a crash

The cycle's timestamps come from somebody else's ledger, and
`new Date(x).toISOString()` **throws** on a value it cannot parse. Letting that
reach `land()` would take down the write path over one bad field, which is
against this repository's standard that a bad record is *reported*.

So `safeIso()` checks it. An unparseable timestamp becomes `null`, the raw value
is kept beside it as `completedAtRaw` rather than hidden, and the fact is stamped
with the landing time — which is honest, because the ledger head in the reference
still dates the cycle.

Worth knowing: `2026-10-17T12:00:010.000Z` — the shape a hand-built ledger
produces past ten events — is **not** rescued by V8. It is refused, not silently
reinterpreted.

---

## What is still open

- **Nothing calls this from a repair cycle yet.** `fed lessons` and
  `ingestCycle` are the door; wiring Twin Labs' `run-repository-cycle.js` to walk
  through it on completion is the next step, and it needs a decision about where
  cycle directories live and who is allowed to point at one.
- **The method is now checkable, and deliberately not a gate.**
  `src/forge/bar.js` issues `risk_repair_bar` as a hashed receipt *before* a
  repair and holds the finished cycle to it *after*: `fed bar --slug S --issue`
  and `fed guard <cycle-dir> --slug S --bar <receipt>`. The verdict is
  **COMPARABLE**, not ALLOWED — it refuses to *witness* a cycle that cannot be
  measured against what the repository already knows, and it refuses to *act* on
  the agent's behalf, because a bounded historical observation is not a rule.
  **[`docs/REPAIR-BAR.md`](REPAIR-BAR.md)**.
  Still deliberately unwired: making the bar gate a `serve.js` **request**. That
  stays a decision to make out loud — a hub that refuses has started listening,
  and the oracle's power is that it doesn't.
- **`verifyLedger` reads each blob whole** rather than streaming the hash. A 64
  MiB unreferenced blob verified in ~110 ms, which is fine, but a cycle holding a
  full source snapshot across many blobs is unmeasured and there is no bound on
  the total bytes a cycle may present.
- **One cycle is one witness.** A bar seen in one repository is `provisional` and
  stays that way until other repositories' cycles corroborate it. That is correct
  behaviour and it means the value compounds slowly, on purpose.
- **TAMPER is still `X` in the diamond audit**, on `no-erasure`: `gate.js` writes
  `delegation.json` and `passport.js` writes `link.json` with `writeFileSync`.
  Both are current-state derived files, not chained records, so the finding is a
  heuristic misfire rather than an erasure path — but it is pre-existing, it is
  recorded here rather than quietly left, and resolving it means teaching
  `bin/diamond.js` the difference between a record and a derived file.

---

## Tests

`test/lessons.test.js` (31) — `canonicalJson` sorts keys, preserves array order,
and refuses everything JSON would silently lose; a well-formed ledger verifies;
an **edited event**, a **swapped blob**, a **truncated log**, a **broken chain**,
a **moved head**, a **stray file** and a **symlinked ledger** are each refused by
name; a completed cycle reads and carries its refusal verbatim; an incomplete or
failed cycle is not a lesson; the scope lands **in the commons**; the method
travels and the defect does not; a long path list becomes a count and never half a
path; a lesson refuses the browser carrier; re-ingesting is idempotent; an
unregistered node is refused; a tampered cycle lands **nothing** — no facts and no
event; a malformed timestamp is reported, never a crash; and the boundary rides
into another repository's `PASSPORT.md` beside the method.

177 checks total, `npm test`, all passing — 31 here, 50 in `test/bar.test.js`,
and the rest across the carrier, bridge, write-lock and store suites.

Diamond audit of `src/`: HACK **P** 5/5 (named refusals 103), ROT **X → D**
(`regression-reverts` now present), verdict EXPOSED → **FRAGILE**. The one
remaining exposure is the pre-existing `no-erasure` heuristic, described above.

**This module was then attacked.** `npm run redqueen` runs a Hornet against it;
five attacks landed on the first run and all five are fixed above, each with a
regression test. **[`docs/RED-QUEEN.md`](RED-QUEEN.md)** records what landed, what
held, and — the part worth reading — what the run does *not* prove.
