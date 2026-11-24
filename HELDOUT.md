# Held-out attacks — the format

Attacks that live outside this repository, at a path the agent under test does
not read before the first run. The point is that someone other than the author
of the defence gets to say what "blocked" means.

You do not need to read this codebase to write one. You need the folder layout
below and one of seven component names.

---

## Folder layout

```
forge-heldout/
  attacks/
    01/
      attack.json        # required — what should happen
      files/             # the input tree the check runs against
    02/
      attack.json
      files/
      fact.json          # only for component: store
    03/
      attack.json
      briefing.json      # only for component: passport
      files/
    04/
      attack.json
      files/
      test.json          # only for component: record
      repair.js          # only for component: record
```

One directory per attack. The directory name is irrelevant; `attack.json.id`
is what the report numbers. Order in the report is by directory name, so name
them `01-`, `02-` if you want to control it.

`files/` is a real directory that gets handed to the system exactly as it is.
Whatever you put in it — nested folders, odd extensions, huge files, symlinks,
zero-byte files — is what the system sees. Nothing is pre-processed.

---

## `attack.json`

```json
{
  "id": 7,
  "component": "probe",
  "check": "scan",
  "expected": "flagged",
  "slug": "clearcut"
}
```

| field | required | meaning |
|---|---|---|
| `id` | yes | the number in the report. Any string or number, kept unique. |
| `component` | yes | one of the seven below |
| `check` | yes | the operation. Must match the component (table below). |
| `expected` | yes | what the system **should** do. Closed list per component. |
| `slug` | no | repository name for the federation-backed checks. Default `heldout`. |
| `title` | no | free text. **Never printed in the report.** |

`expected` is the correct behaviour, not the attack's intent. `"expected":
"refused"` means *the system should refuse this and a FAIL means it accepted it*.

---

## The seven components

Each line says what the component is; the check name is what `attack.json`
must say.

| component | check | what it is |
|---|---|---|
| `probe` | `scan` | The risk scanner over a tree of source files. Does it see the defect you hid, and does it invent defects that are not there? |
| `ledger` | `read-cycle` | Reading a repair cycle's hash-chained event log. Does a doctored or incomplete cycle get refused? |
| `lesson` | `land-lesson` | Landing a finished cycle as a fact in a shared commons. Does a cycle run on repo A get filed against repo B? |
| `bar` | `guard` | Holding a finished cycle to a bar issued *before* it ran. Does a weakened rule still hold? |
| `store` | `land-fact` | Landing a single fact with a witness. Does an invented, borrowed or misattributed witness get accepted? |
| `passport` | `render-passport` | Rendering the file an AI agent reads as context. Does instruction-shaped text reach the agent? |
| `record` | `record-repair` | Recording a repair as a cycle. Does a repair that fixed nothing get recorded as one that did? |

### Allowed `expected` values

| component | values | meaning |
|---|---|---|
| `probe` | `clean` | the scanner must report nothing in `files/` |
| | `flagged` | the scanner must report something in `files/` |
| `ledger` | `accepted` | `files/` is a sound cycle and must read cleanly |
| | `refused` | `files/` is unsound and must be rejected |
| `lesson` | `landed` | the cycle is sound and must become a fact |
| | `refused` | the cycle must not become a fact |
| `bar` | `passed` | the cycle meets the bar |
| | `refused` | the cycle must not meet the bar |
| `store` | `landed` | the fact is sound and must be stored |
| | `refused` | the fact must be rejected |
| `passport` | `sanitised` | no instruction marker may survive into the rendered text |
| | `prints` | the marker is expected to survive — use this only to document a hole you know about |
| `record` | `recorded` | the repair must be recorded as a cycle |
| | `refused` | the repair must not be recorded |

### Extra files, per component

- **`store`** — `fact.json`: the object handed to `land()`. See
  `attacks/01` in any working set; the shape is
  `{shelf, witness, nodeId, equation:{subject,predicate,object}, ...}`.
- **`passport`** — `briefing.json`: the object handed to `render()`. The shape is
  `{own:[], elsewhere:[{predicate, object, seenIn, scope}]}`. Put your hostile
  text in any string field of a `elsewhere` entry.
- **`record`** — `test.json` is `{command, args}`, and `repair.js` exports a
  function `(repoDir) => ({ok})` that is called to perform the "repair". If
  `repair.js` is absent the repair changes nothing.
- **`bar`** — optional `"bar": "bar.json"` in `attack.json`, a path relative to
  the attack directory, holding a bar receipt.

---

## The three verdicts

- **PASS** — the system did what `expected` says.
- **FAIL** — it did something else, including throwing instead of refusing.
- **NOT-APPLICABLE** — the attack named a seam this system does not have, or the
  attack directory is malformed (unknown `component`, unknown `check`,
  `expected` not in that component's list, missing `files/`).

**NOT-APPLICABLE is never counted as a pass.** A run with zero applicable
attacks exits non-zero, because zero evidence is not evidence. If you get a
NOT-APPLICABLE on an attack you meant to apply, the metadata is wrong, not the
system.

A check that throws while running is **FAIL**, never NOT-APPLICABLE. A seam that
crashes instead of refusing has not held.

---

## Running it

```bash
FORGE_HELDOUT_DIR=/path/to/forge-heldout node bin/heldout.js
```

Output is one line per attack, number and verdict only:

```
1	PASS
2	FAIL
3	NOT-APPLICABLE

20 run — 18 PASS, 1 FAIL, 1 NOT-APPLICABLE
```

`--details` adds an operator log with the reason for each verdict. Run it
yourself; do not paste it to the agent under test, because the reason can
describe what it should fix.

With `FORGE_HELDOUT_DIR` unset the command prints **NOT RUN** and exits 0. That
is not a pass and the report says so.

---

## Giving CI read-only access

The repository is private and the agent's session must not hold the key. Use a
deploy key, which is scoped to one repository and cannot be used on another.

1. Generate a key on your own machine, no passphrase:
   ```bash
   ssh-keygen -t ed25519 -f forge-heldout-deploy -N ""
   ```
2. In `forge-heldout` → **Settings → Deploy keys → Add deploy key**. Paste
   `forge-heldout-deploy.pub`. **Leave "Allow write access" unchecked.**
3. In `Forge-Federation` → **Settings → Secrets and variables → Actions → New
   repository secret**. Name `HELDOUT_DEPLOY_KEY`, value is the contents of
   `forge-heldout-deploy` (the private file).
4. The workflow does the rest; see `.github/workflows/heldout.yml`.

A deploy key on `forge-heldout` gives nothing on `Forge-Federation`. A personal
access token would, which is why it is not used.

---

## What the agent under test is allowed to know

Which numbers failed. That is it. Not the wording, not the component, not the
reason. Everything after the first run is informed by the failures, and the fix
is written blind to the attack that exposed it.
