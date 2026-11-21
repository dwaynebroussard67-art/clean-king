# Pre-demo red-team review — Clean King / Goodwork (2026-11-21)

Scope: the whole repository at `24fa322` (Bubbles v1), with a focus on the onboarding
path and the public workspace that gets presented at the demo.
Method: local verification on this branch (`npm ci`, `npm test`, `npm run build`,
`npm run test:production`), statement-level probes of the migrations (PGlite,
2026-11-21), and the production deployment / CI failure emails received today.
Not a penetration test; no external services were modified.

> This is an adversarial review of what is actually in the repo, not a security
> certification. The earlier snapshot is `RED_TEAM_REVIEW.md` (2026-11-17); this
> document supersedes it for the demo.

## Bottom line

**The demo is no longer blocked at the build or the database.** On 2026-11-21 the
repository was repaired, and the demo path is green with the caveats listed below.

- `npm run build` — ✅ green (3 Turbopack errors fixed).
- `npm test` — ✅ **113/113 pass** (7 failing PGlite DB tests fixed).
- `npm run test:production` — ✅ passes (owner development login fails closed;
  referral pages fail closed; intake 503s fail closed).
- `npm audit --audit-level=moderate` — 0 vulnerabilities.
- `npm run test:e2e` — ⚠️ **not run in this environment**: the Playwright browser
  download (`cdn.playwright.dev`) is blocked here (TLS/connect error). CI's Verify
  workflow installs the browser in the runner; do not treat the browser path as
  verified locally.
- Vercel production deploy logs and GitHub checks could **not** be re-queried from
  this sandbox (Vercel connector token: `list_projects` access denied; GitHub run
  logs unreachable from here); they are to be re-checked after the fix push.

## Verified — build breakage (fixed 2026-11-21)

`npm run build` failed at `24fa322` with three errors:

1. `lib/ai/provider-adapter.js:88` — an object literal contained a ternary used as
   an unnamed property value. Fixed: build the body, then set `body.tools`
   conditionally. Behavior unchanged when `tools` is absent.
2. `app/api/owner/assistant/route.js` — imported `ownerLoginEnabled` (and unused
   `secretKeyValid`) from a nonexistent `lib/server/auth-config.mjs`. Fixed: both
   unused imports removed; the Bubbles handler still gates on origin + auth +
   owner membership.
3. `lib/server/provider-key-vault.mjs` — imported a nonexistent `generateIV`, passed
   an extra `iv` argument to `secret-box` (which embeds IV/tag inside the `v1:`
   box), read a nonexistent `api_key_plaintext` column, referenced an undefined
   `PROVIDER_VAULT_KEY_ENV` constant, selected a nonexistent `id` column in the
   test path, and called `testProvider` without importing it (would 500 at runtime).
   Fixed end to end and aligned with the migration (`tenant_ai_providers` has no
   `api_key_plaintext` column and the `iv` column is left null — the encrypted box
   is self-contained). Keys are encrypted server-side with AES-256-GCM; plaintext
   never leaves the server; only `lastFour` is returned to callers. A rotate-vault
   path re-encrypts with the new master; plaintext is never read back except
   through the encrypted-store decrypt path.

**Do not weaken this design to fit a new column or a plaintext backup** — the vault
must stay encrypt-at-rest with the box self-contained.

## Verified — organizations migration (fixed 2026-11-21)

`20261121030000_organizations_multi_franchise.sql` could not be applied to a fresh
database (7 failing PGlite tests traced here). Eight distinct defects were found
and fixed:

1. Odd `alter ... add primary key if not exists` (invalid syntax, 2 sites) — now a
   drop-constraint-if-exists + bare add primary key, with the valid PK dropped first.
2. Wrong `alter ... drop default if exists` (`DROP DEFAULT` has no `IF EXISTS`) —
   the redundant drop was removed; only `set default now()` remains.
3. `organizations` policy referenced `owner_memberships.organization_id` before the
   column was added later in the same migration — moved after the column exists.
4. `employee_memberships` cannot drop its single-user PK — dependent foreign keys
   from referral tables reference that column. Kept single-user PK (one membership
   per user — the actual employee/referral constraint); org scoping is carried by
   the `organization_id` column and policies/RPCs. Note: a true multi-franchise
   employee model (one user in two franchises) would need FK rewiring — not done here.
5. `assistant_usage` / `assistant_quota_settings` referenced tables that do not
   exist; `assistant_runs` and `assistant_settings` were org-scoped anyway — the
   org additions were removed and are now documented as intentionally single-workspace
   singletons. Per-franchise assistant configuration requires its own design.
6. `audit_owner_access_control` trigger (from the access-control migration) wrote
   audit rows without `organization_id` — with `audit_log.organization_id` not null,
   every owner emergency-stop/suspension event failed closed (or errored). The trigger
   is rewritten in the org migration: global events keep `organization_id = null`
   (workspace-level; invisible to per-franchise owners), org-scoped membership events
   carry the membership's franchise.
7. Several policies shipped from the org migration dropped the `is_business_owner()`
   gate (the emergency-stop check) introduced by the access-control migration.
   Restored: applicants/leads read+update, audit log, referral invitations and
   attributions, onboarding tables now require "own org AND owner predicate".
8. The org migration rewrote `submit_referred_application` to a 3-argument org-scoped
   version that lost the experience-question columns carried by the 2-argument version
   and did not check `revoked_at` (revoked links could still be redeemed). The 3-arg
   version now inserts the experience columns and rejects revoked invitations; the
   legacy 2-arg function is dropped so the old overload cannot silently bypass
   org-scoping.

`20261121050000_notification_org_scoping.sql` also created `claim_application_notification()`
with a new return type via `create or replace`, which Postgres refuses. It now drops
the old function and creates the org-scoped one (app code reads only
`notification_id` and `claim_token`, so the extra column is harmless).

Test fixtures pre-date the multi-franchise schema; they were updated to the current
schema (organizations + org columns + 3-argument RPC calls), with assertions unchanged.

## Verified — what passes

| Check | Result |
| --- | --- |
| `npm run build` | green (15 routes) |
| `npm test` | 113/113 pass (was 106/113 with 7 failing) |
| `npm run test:production` | passes (guards fail closed) |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |
| All migrations applied to fresh PGlite | ✅ all 18 |

## Known gaps / residual risk (not hidden)

- **`npm run test:e2e` has not been verified locally** — the Playwright browser
  download is blocked in this environment (CI installs the browser in the runner).
  The public workspace browser path is exercised by unit tests but not re-verified.
- **Vercel production deploy / GitHub Verify** could not be re-checked from this
  sandbox. Treat "deploy green" as *unverified* until CI runs on the fix commit.
- **Migrations do not backfill pre-existing rows** — they add `organization_id`
  `not null` to existing tables; they must be applied to an empty/test database
  (as done in CI) or followed by the documented backfill update. Do **not** apply
  these migrations to a non-empty production database without an operator-run backfill.
- **assistant_settings / assistant_runs are deliberately single-workspace** singletons.
  In a multi-franchise deployment the assistant settings shown to an owner of any
  franchise would be the same row. Accept for the demo; redesign is required before
  production multi-franchise.
- **`audit_log` rows can be workspace-global** (`organization_id = null`); they are
  invisible to per-franchise owners by design.
- **`employee_memberships` keeps one membership per user.** The referred-application
  flow still works correctly within a single franchise.
- **Training records / provider vault / dollar budgets** were not exercised by tests
  against a live backend — they are code-level fixes only; no live-DB verification.
- The demo itself remains a browser-memory, example-data walkthrough (`/`), and the
  public landing is still example-only — exactly as the README and banners describe.

## What this means for the demo (two days)

1. Build is green; deploy and Verify can be re-run after this fix push — treat them
   as unverified until CI passes.
2. Show the public walkthrough at `/` (the `MEETING_WALKTHROUGH.md` path). Do not
   demo `/owner` as a "live" environment — owner login is disabled there by design
   in this build and must not be enabled for the demo.
3. Demo onboarding as the browser-memory example in the walkthrough, with the
   README/help disclosures in front of the audience ("example records, reset on
   refresh"). The real onboarding RPCs work locally (113/113) but are unverified
   against a live Supabase project (none is configured).
