# Passport — forge-federation

**Realm:** `repo:forge-federation`  ·  **Slug:** `forge-federation`
**Remote:** https://github.com/dwaynebroussard67-art/forge-federation
**Updated:** 2026-10-23T11:45:16.664Z

## What this repository is

```json
{
  "languages": [
    "JavaScript (254)",
    "TypeScript (84)",
    "Markdown (59)",
    "HTML (23)",
    "JSON (20)",
    "CSS (6)"
  ],
  "frameworks": [],
  "testCommand": "npm test",
  "entryPoints": [],
  "packageManager": "npm",
  "loc": 82986
}
```

## Conventions

- **test:** verify with `npm test`
- **evidence:** every claim in memories.jsonl points at something re-derivable in evidence.jsonl

## Evidence index

### structure (1)

- **repository** — {"loc":82986,"files":470,"languages":["JavaScript (254)","TypeScript (84)","Markdown (59)","HTML (23)","JSON (20)","CSS (6)"]}
  - witness: `structural` `sha256:3a487f4c40eaa1d9a3a136ca498cc40a968063dc9fb49c61789b04d22c5b3b6a`

### contract (1)

- **package.json** — npm manifest
  - witness: `structural` `sha256:e475d391fbd557d24b46943912be9e8abae77b3a8702b05ac9afdd2425e9e26e`

### test (1)

- **verification** — command: npm test; 80 test file(s)
  - witness: `structural` `path:package.json`

### history (1)

- **commits** — {"commits":3,"contributors":2,"branches":5,"lastCommit":"2026-10-23T03:54:13+00:00"}
  - witness: `structural` `git:2026-10-23T03:54:13+00:00`

### dependency (1)

- **npm** — {"dependencies":0,"devDependencies":0}
  - witness: `structural` `sha256:e475d391fbd557d24b46943912be9e8abae77b3a8702b05ac9afdd2425e9e26e`

### risk (6)

- **hardcoded-identity** — {"summary":"209 site(s) — a name trusted as an identity is a standing backdoor","count":209,"why":"a name trusted as an identity is a standing backdoor","example":"omnibox/collective-admission.test.mjs:63"}
  - witness: `structural` `scan:hardcoded-identity`
- **innerHTML-assignment** — {"summary":"30 site(s) — unescaped content into the DOM","count":30,"why":"unescaped content into the DOM","example":"omnibox/mobile/app.js:144"}
  - witness: `structural` `scan:innerHTML-assignment`
- **dynamic-execution** — {"summary":"7 site(s) — executing strings built from content","count":7,"why":"executing strings built from content","example":"omnibox/scripts/verify.mjs:136"}
  - witness: `structural` `scan:dynamic-execution`
- **record-truncation** — {"summary":"10 site(s) — a chained log rewritten instead of appended can be erased","count":10,"why":"a chained log rewritten instead of appended can be erased","example":"omnibox/test/chain.test.js:82"}
  - witness: `structural` `scan:record-truncation`
- **unchecked-secret** — {"summary":"1 site(s) — a literal credential in source","count":1,"why":"a literal credential in source","example":"test/hub.test.js:376"}
  - witness: `structural` `scan:unchecked-secret`
- **shell-interpolation** — {"summary":"1 site(s) — user content reaching a shell","count":1,"why":"user content reaching a shell","example":"test/write-lock.test.js:215"}
  - witness: `structural` `scan:shell-interpolation`


## Memory

_Nothing remembered yet._

## Neural link

This passport is a **link**, not a store. It holds your bearings and the
address of the hub. The Federation holds the commons, the tools, and the
skills — ask it.

```json
{
  "shape": "{ from, kind, name?, arg?, reason? }",
  "note": "Request, never command. The hub authorizes; this repository asks."
}
```

**Realm:** `repo:forge-federation` · **Hub:** `/home/user/.forge-federation` · **Serves:** context, ask, tool, skill, remember, evidence

You **request**; the hub authorizes. Three answers come back:

- `granted` — here it is
- `deferred` — queued for a named human. Asking twice does not help.
- `refused` — not a thing the hub does, with the reason named

_Context, `ask`, `read`/`transform` tools and structural `evidence` are_
_granted on request. `git.commit`, `git.push` and self-reported `outcome`_
_memories are always deferred — the human is step four._

## From the hub

_The Federation is the hub every passport is linked to. This section is_
_what the rest of the system knows that is worth your attention here._

### About this repository

- **structure** — {"loc":82986,"files":470,"languages":["javascript (254)","typescript (84)","markdown (59)","html (23)","json (20)","css  _(provisional, 1 witness)_
- **contract** — npm manifest  _(provisional, 1 witness)_
- **test** — command: npm test; 80 test file(s  _(provisional, 1 witness)_
- **history** — {"commits":3,"contributors":2,"branches":5,"lastcommit":"2026-10-23t03:54:13+00:00"}  _(provisional, 1 witness)_
- **dependency** — {"dependencies":0,"devdependencies":0}  _(provisional, 1 witness)_
- **risk_hardcoded-identity** — name trusted as an identity is a standing backdoor  _(provisional, 1 witness)_
- **risk_innerhtml-assignment** — unescaped content into the dom  _(provisional, 1 witness)_
- **risk_dynamic-execution** — executing strings built from content  _(provisional, 1 witness)_
- **risk_record-truncation** — chained log rewritten instead of appended can be erased  _(provisional, 1 witness)_
- **risk_unchecked-secret** — literal credential in source  _(provisional, 1 witness)_
- **risk_shell-interpolation** — user content reaching a shell  _(provisional, 1 witness)_


---

Generated by Forge Federation. `memories.jsonl` and `evidence.jsonl` are
hash-chained and append-only; this document is derived from them and may be
regenerated at any time. The chain is the truth; this file is the reading of it.
