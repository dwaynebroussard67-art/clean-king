# Onboarding blueprint: how a Forge-built site gets its owner's real information

**Status:** engine + database + tests built and passing on synthetic data; **no screens yet**, no live Supabase, no production auth. Do not put real SSNs in this until the "Before real data" list at the bottom is done.

## The idea

Everything a business owes you at hand-over falls into one of three tiers. The tier decides how it travels and where it lives. The list lives in one file, `lib/onboarding/manifest.mjs`, so adding a field for the next business is one line.

| Tier | What | How it gets in | How it's stored | Who can read it |
|---|---|---|---|---|
| **0 Public** | Name, phone, address, hours, services, service area | Read off the business's existing site/listings. No login. | Normal rows, status `proposed` | Franchise owner |
| **1 Delegated** | Legal name, client sites, employee roster, hire dates | Admin signs in, drops a spreadsheet (or grants a connector later), **reviews, clicks confirm** | Normal rows, RLS-scoped to the franchise | Franchise owner |
| **2 Sensitive** | Owner/employee SSN, driver license/ID, bank routing/account, EIN | **Never imported.** Typed by the person it belongs to. Employees get a one-time link and enter their own. | **Ciphertext only**, per-franchise key | Nobody by default; a logged, step-up-gated reveal for the owner |

This is your 90/10: tiers 0 and 1 are the few-clicks part; tier 2 is the punched-in part. The key design choice: **the owner never types an employee's SSN, and neither do you.** The employee does, on their own phone, through a link that works once.

## What was already in the repo and is reused

Organizations (one per franchise) and owner/employee memberships, row-level security keyed to the franchise, an audit log, the hire → `employee_onboarding` record, single-use hashed referral codes (same pattern as my one-time links), and the AES-256-GCM `secret-box`. I did not touch any of it.

## What I built (all new files)

| File | Job |
|---|---|
| `lib/onboarding/manifest.mjs` | The tiered field list for a franchise (26 fields), bilingual labels, per-field validators and masks |
| `lib/onboarding/validators.mjs` | SSN structure rules, ABA routing checksum, EIN, phone, email, date, Luhn. Errors are codes; they never echo the input |
| `lib/onboarding/import.mjs` | CSV → Tier-1 fields, **plus a guard**: any column that looks like SSN/bank/card/DOB (by header *or* by value) is dropped, counted and reported, never stored |
| `lib/server/envelope-vault.mjs` | Envelope encryption: master key (env) wraps a per-franchise data key, which encrypts each value. Includes blind index and key rotation |
| `lib/server/onboarding-vault-handler.mjs` | Issue employee link, employee submits, owner stores own secret, reveal (needs fresh step-up + written reason) |
| `supabase/migrations/20261122020000_onboarding_vault.sql` | Tables, RLS, and the only functions that can touch ciphertext |
| `test/onboarding-vault.test.mjs` | 13 tests, including a real Postgres (PGlite) run of the migration |

### Why the vault is built this way

- **Master key never in the database.** `ONBOARDING_KEK_V1` lives in the host's secret store. A stolen database or backup is ciphertext.
- **Per-franchise data key.** One franchise's key cannot open another's data. Tested.
- **Ciphertext is bound to its row.** The org, person and field are part of the encryption, so a value copied to another row or franchise fails to decrypt. Tested.
- **No role can `SELECT` the ciphertext column**, including the server role. The only path is `vault_reveal()`, which writes the log row in the same transaction. Tested.
- **The access log is append-only** (a trigger rejects update/delete).
- **Blind index** (keyed hash) lets you say "this SSN was already entered" without decrypting.
- **Rotation is cheap:** re-wrap the few franchise keys, not every value. Tested, including retiring the old master key.
- **Crypto is Node's built-in AES-256-GCM / HKDF / HMAC.** Building your own system here means your own *structure and rules*, not inventing a cipher. Never do the latter.

### What this does *not* protect against (be straight with the owner about this)

Someone holding **both** database write access **and** the master key env var can decrypt. That's an operator-level risk, and today the operator is you. The later upgrade that removes it: put each franchise's master key under the owner's passkey so you genuinely cannot read it ("I don't want to be involved" becomes technically true instead of just a policy). That's Phase 3 below. Until then, don't tell customers "we can't see your data."

## A day-one walkthrough for the Jani-King franchise owner

1. **Owner signs up** (email + password). They see a checklist generated from the manifest: three buckets, progress bars.
2. **Tier 0, zero clicks.** Forge reads their existing public site/listing and fills the public fields as *proposed*. The owner sees a "does this look right?" list and hits **Confirm all**. *(The harvest step is not built; see Phase 2.)*
3. **Tier 1, one drop.** Owner drops their employee spreadsheet and client-site list. `importCsv` maps columns, rejects bad rows with row numbers, and **quarantines the SSN/bank columns** with a message like "We didn't import your Social Security column. Want to collect those securely instead?" One button sends each employee a link.
4. **Tier 2, employees do it themselves.** Each employee gets a text/email with a link, valid 72 hours, single use, fields listed (SSN, ID, direct deposit). They type it, see masks (`•••-••-6789`), done. Owner sees "7 of 9 employees complete" and never sees the numbers.
5. **Owner's own secrets** (their SSN, EIN, business bank) are typed on their own session, after a passkey/TOTP step-up.
6. **Reveal** (e.g. owner needs an SSN for a bonding application): step-up within the last 5 minutes + a written reason → decrypted for that moment → logged, and visible in the owner's own access log.

## Decisions I'd push you to make before building more

1. **Do you need to hold SSNs at all?** Cheapest compliance is not storing them. SSNs, I-9s and W-4s belong to the *employer* and flow to payroll/e-verify, which are government-run or regulated systems you can't replace with your own. Start with: collect and hold only what the franchise tells you it needs, and let owners **delete** (`vault_delete` exists). Have a Louisiana attorney confirm breach-notification and retention duties before real data. I'm not a lawyer.
2. **"Our own systems" has a floor.** Own: manifest, vault, import, links, UI, rules. Not ownable: SMS/email delivery (a carrier or mail server is needed), government verification, and the crypto algorithms. Open-source building blocks (e.g. SimpleWebAuthn for passkeys) are fine.
3. **Password alone is not enough for tier 2.** Email + password is fine for tier-0/1 grants. Reveal and owner-typed secrets need a second factor (passkey best, TOTP acceptable). The repo has no production auth yet, only a dev-only email link.

## Roadmap

- **Phase 1 (next, ~1 build session):** screens: owner checklist page, CSV drop + review, "send secure link" button, employee link page (bilingual, mobile-first, no navigation chrome, `Cache-Control: no-store`), owner access-log view. Wire `keyringFromEnv`, `supabaseRpc`, rate limiting and Turnstile on the employee link.
- **Phase 2:** Tier-0 harvester using Forge's DOM reading on the existing site; per-field provenance ("from your site, Nov 22"); connectors as optional adapters behind the same `upsert_onboarding_items` door.
- **Phase 3:** passkey step-up in production; owner-held master key so the operator can't decrypt; encrypted document upload (I-9 scans, IDs) using the same envelope; retention timers.
- **Whole company later:** a franchisor org above franchise orgs with a manifest per franchise; aggregate completion only, never tier-2 access.

## Repo problems found while doing this (they block "real" use)

1. **The multi-franchise migration does not run on Postgres.** `20261121030000_organizations_multi_franchise.sql` uses `add primary key if not exists` (lines 36, 150) and `drop default if exists` (line 38), which are not valid SQL. Seven existing tests fail (106 of 113 passed before my changes; none of the seven touch my code). I fixed those lines in a scratch copy and the same seven still failed, so there is at least one more cause I did not chase. My tests use a small stand-in for the organizations tables so they don't depend on it; **fix it before applying my migration to a real project.**
2. **`lib/server/provider-key-vault.mjs` is broken and has no tests.** It imports `generateIV` (not exported by `secret-box.mjs`), references an undefined `PROVIDER_VAULT_KEY_ENV`, calls `encryptSecret` with arguments the function doesn't accept, and reads an `api_key_plaintext` column that the migration doesn't create. A "plaintext backup" path in a vault is the wrong idea. Don't reuse it for onboarding; I built a separate vault for that reason.
3. **No production owner authentication** (the repo says so itself). Tier 2 should not go live on the dev login.

## Run it

```bash
npm test                      # 119 pass, 7 fail (the 7 are the pre-existing ones above)
node --test test/onboarding-vault.test.mjs   # 13/13
openssl rand -base64 32       # generate ONBOARDING_KEK_V1
```

## Before real data (checklist)

- [ ] Org migration fixed and all tests green
- [ ] Dedicated Supabase project; migrations applied in order
- [ ] KEK in the host secret store, backed up offline (lose it = every tier-2 value is unrecoverable)
- [ ] Passkey/TOTP step-up live; dev email login disabled in production
- [ ] Rate limit + Turnstile on the employee link; `no-store` headers; no tier-2 values in logs or error reporting
- [ ] Attorney review of retention, breach notice, and the employee-facing privacy notice
- [ ] A restore drill: restore a backup **and** prove a reveal works with the retained KEK
