# Security policy

## Status

This repository contains a **demonstration system** for a fictional cleaning business. It is not approved to store or process real applicant, employee, customer, school, patient, or operational data, and it is not an approved production deployment. Intake, referrals, notifications, and the owner assistant are disabled by default and fail closed in production builds.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, and do not include real personal data in any report.

Report privately via a [GitHub security advisory](https://github.com/dwaynebroussard67-art/clean-king/security/advisories/new) on this repository, or by contacting the repository owner listed in `CODEOWNERS` (`@dwaynebroussard67-art`) through GitHub.

Include: affected file/route/migration, impact, and a reproduction using synthetic data only. You will get an acknowledgement from the repository owner; there is no staffed 24/7 security team yet, and no guaranteed response time. Coordinated disclosure is appreciated; we will credit reporters unless they prefer otherwise.

## Scope

In scope: everything in this repository — Next.js app, server actions and route handlers, SQL migrations and RLS policies, CI, and documented operational procedures.

Out of scope: attacks against the public internet at large, social engineering, physical access, and any third-party service (Supabase, Cloudflare, Vercel, email/SMS providers) used only after the owner's explicit, separate approval.

## Safe handling rules for anyone working in this repository

- Never commit secrets, `.env` files, service-role keys, or real applicant/employee/customer data.
- Never enable intake, referrals, notifications, email-link login, or the assistant against real people without a reviewed, approved test project and the gates in `LAUNCH_READINESS.md`.
- Treat the owner emergency stop as a one-way safety control: it must remain effective for every owner-facing path.
- The full red-team findings and required launch gates are recorded in `RED_TEAM_REVIEW.md`, `LAUNCH_READINESS.md`, and `PRODUCTION_READINESS_PROGRESS.md`.

## Incident response

There is no staffed on-call rotation. If a suspected incident occurs in any environment: engage the repository owner immediately, engage the emergency stop (`owner_access_control.enabled = false`) for owner-facing access, preserve logs and audit evidence, and do not attempt silent remediation. A post-incident review should be documented in `PRODUCTION_READINESS_PROGRESS.md`.
