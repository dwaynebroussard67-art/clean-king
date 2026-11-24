# Uploaded ZIP salvage — reference only (2026-11-24)

Sources: PR #24 `synthetic-demo-system-guide.zip` and PR #16 `onboarding-engine.zip`.
Both upload PRs were closed and **no code from either ZIP was merged**.

- PR #24 is a separate TypeScript / Next 16 / Drizzle / raw-Postgres app: no authentication,
  no migrations, no tests, no build without a live database, and fabricated business claims.
- PR #16 is a stale snapshot of files already in `main`; four of its files predate the
  PR #18 security hardening (org-scoped RLS, active-owner checks, `VAULT_KEK_*`, real
  migration-chain tests). Merging it would have rolled those fixes back.

## Reusable ideas only — not code, not approved copy

1. **Page inventory** worth rebuilding in the existing stack, behind owner auth:
   `/services`, `/privacy`, `/terms`, `/crew/guide` (EN/ES), `/crew/training` (EN/ES),
   `/owner/bench` (call-out simulator), `/owner/audit`.
2. **Bilingual site-guide layout:** header with EN/ES toggle; site card with name,
   address, shift, supervisor and clearance badge; numbered instructions; directions CTA.
   All site data stays fictional until the owner supplies approved sites.
3. **Training module layout:** sequential locked lessons, topics per lesson, progress
   bar, and an explicit "no watch-time tracking or certificates in this demonstration"
   disclaimer.
4. **Schema sketch (7 tables):** applicants, quotes, employees, onboarding_records,
   onboarding_tasks, audit_logs, referral_invitations. Worth copying: SMS consent plus
   timestamp, `code_hash` on referral codes, and hire -> employee + default onboarding tasks.
5. **Legal-page skeleton:** privacy/terms sections for collection, use, SMS consent,
   retention, security and contact. Replace the ZIP's fictional addresses and the dynamic
   "last updated" date with approved placeholders, and build a real deletion path before
   claiming one.

## Explicitly not kept

Hardcoded stats ("500+ facilities", "98% retention", "100% background checked"), named
testimonials, HIPAA / certification claims, the fake phone number and email addresses,
the invented hospital site guide, every server action, and all database/auth code.

Governing documents: `Build Dossier` ("show only numbers he approves"; franchisor
sign-off for brand and training claims), `RED_TEAM_REVIEW.md`, `DEMO_RUNBOOK.md`.
