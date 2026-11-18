# Dossier implementation map and phased plan

Updated 17 November 2026. This maps the new operational/referral dossier and the requested **optional 30-second video introduction** against the current repository. It does not replace the original `Build Dossier`; both inform the roadmap. Nothing in this document means the product is approved for real data.

## Status definitions

- **Implemented and verified locally:** code exists and was tested locally, not necessarily against live services.
- **Partial:** some real foundation exists, but the end-to-end requirement is incomplete.
- **Present, not connected:** a demo/placeholder exists but does not perform the real operation.
- **Missing:** no working implementation of the requested feature.
- **Requires replacement/major change:** a demo or interim design must not be used as the production solution.

## Requirement map

| Dossier area | Status | Current evidence and gap |
|---|---|---|
| Public/mobile and business dashboard | Present, not connected; production dashboard requires replacement | `app/ui.js` uses fictional data and in-memory state. Production must use authenticated, authorized persisted records and must never display invented numbers as real. |
| Owner authentication and permissions | Partial; interim sign-in requires replacement | Owner membership, RLS and development email-link access exist (`app/owner`, `middleware.js`, migrations). Passkeys, approved devices, MFA/step-up, lifecycle and live verification are absent. |
| Managers/supervisors | Missing | No delegated permission model, approval or manager account. |
| Employee accounts | Partial; interim sign-in requires replacement | Referral prototype has administrator-enrolled active employee membership and development sign-in only. No production activation, onboarding, account recovery or worker portal. |
| Employee invitations and sharing | Partial | `app/crew/referrals` generates a high-entropy one-use, seven-day code and link, with a ten/day limit and native share/copy. Disabled by default; no revocation interface, general campaign links or live two-device test. |
| Verify referral code and application session | Partial | `app/api/intake/route.js` checks the code atomically when the application is submitted. There is no pre-submission verification or resumable application session, and no separate started timestamp. An invalid/expired/used code yields an actionable error. |
| Referral attribution/evidence | Partial, locally verified | `20261117030000_referral_foundation.sql` stores code hash, creation/expiration/use time, application link and referring employee, with an attribution audit record. Status/hiring history is not yet integrated into worker-facing reporting; authorized correction process is missing. Foreign keys currently restrict deleting linked applicants/employees; an approved, tested retention/deletion procedure is required before real data. Applicant cannot select another employee as credited owner. |
| Invitation analytics and employee privacy | Partial | Employee sees only created/submitted totals, not private applicant data. Owner inbox sees an internal employee ID, not a human-friendly directory. Hired/pending metrics and employee notifications are missing. Counts are not a bonus ledger. |
| Referral rewards | Missing | No policies, eligibility, approval, payment or clawback ledger. Do not automate payment. |
| Applicant identity/consent | Partial | Self-entered name/phone and browser autofill exist; referral code does not access personal information. No identity-provider consent, granular permissions, last name, email, withdrawal flow or source/version audit. Optional text-message consent is recorded. |
| Short progressive application, experience questionnaire, review and resume | Partial | Mobile form now offers optional job-related experience questions and review/edit before submission, with server validation and persistence in the existing applicant record. No save/resume, configurable questions or application-start timestamp. Legal/work-authorization questions require review before being collected. |
| Optional 30-second video introduction | Missing; marked coming soon | No recording, upload, storage, viewing or deletion exists. Application does not depend on video. Requirements and safety gates are below. |
| Applicant management/hiring stages | Partial | Owner inbox can set limited statuses and manual eligibility, with audit; not the full stage model, notes, interviews, requests, applicant communications or real onboarding. |
| Onboarding and employee record | Missing | No account activation, employment document storage, transfers, onboarding tasks, identity lifecycle or emergency contacts. |
| Training/qualifications | Present, not connected | Lessons are simulated clicks. No content management, verified completion, assessments, qualifications, renewal or real assignment restrictions. |
| Scheduling, coverage and worker notifications | Present, not connected | Bench simulates eligibility; no persistent schedules, atomic offer/claim, conflict/travel detection, actual texts, quiet hours, consent handling or escalation. |
| Site guides/maps | Present, not connected | Fictional public sample only; no assigned-worker authorization, real maps or directions, private files or approved access window. |
| Job completion/verification | Missing | No jobs, checklists, photos, employee/supervisor/customer verification or audit trail. |
| Customer inquiries/quotes | Partial | Disabled intake and owner inbox store lead details when configured; no customer account, quote preparation/sending/approval, job conversion or customer updates. |
| Owner assistant | Partial; no operational actions | Separate opt-in assistant uses aggregate counts and typed question, with request quotas and no tools. Scripted demo is separate. No evidence-backed operational reporting, spend cap or approved actions. AI must not make hiring decisions. |
| Reporting/revenue/labor costs | Present, not connected | Demo values are fictional. Real business records, accounting and metrics do not exist. |
| Audit/access logs/retention/backups | Partial | Status/clearance changes and new referral attribution are audited; access logs, complete audit events, export/retention/deletion and backup/restore operations are missing. |
| Multi-company/industry expansion | Missing | Current schema is single-business. Do not assert tenant isolation; add explicit organization boundaries and cross-tenant authorization before expansion. |
| Abuse prevention and live integration | Partial | Turnstile, body cap, same-origin checks and referral creation limits exist. Production WAF/rate limits, monitoring, credential controls, provider tests and operational alerts remain blockers. |
| Required end-to-end demonstrations | Missing | Unit/PGlite tests and mocked browser form smoke tests exist; the complete employee-to-applicant journey has not been exercised in two separate live browser sessions/devices against a dedicated project. No real-person test. |

## Recommended build sequence

1. **Safe operating foundation:** resolve dependency findings, identify an approved dedicated staging project, run every migration, implement owner passkeys/approved-device policy and secure employee enrollment. Complete real RLS, consent, anti-abuse, retention, accessibility, backup and provider testing; keep features off until approved. Replace demo dashboard with role-specific real views, not fabricated values.
2. **Referral-to-application:** add pre-submit verification with anti-enumeration/rate limits, a privacy-preserving application-start/resume design and timestamps, multilingual progressive questions and review, employee notification that contains no applicant details, authorized attribution correction, and human-readable owner reporting. Verify concurrent use, revocation, expiration, failed submissions, retries and races. Run the required two-session demonstration with synthetic identities.
3. **Optional video introduction:** implement the private, permissioned and independently validated design below; run fair-hiring, legal, accessibility and security reviews before enabling. Never let it block submission.
4. **Hire-to-onboard:** implement explicitly authorized status transitions and audit, onboarding and employee activation, approved information transfer, notification preferences, and secure document access. A label change alone is not hiring.
5. **Training-to-scheduling:** approved bilingual training and reliable completion/qualification records, then persistent shifts, role/qualification checks, atomic assignments, conflict handling, communication and fallbacks. Keep facility maps private and scoped to approved assignments.
6. **Jobs-to-customers:** task checklists and independent verification, inquiries, estimates and explicit customer approval, reporting from saved facts, and supervised evidence-backed assistant tools. Add bonus policy and human approval before payments.
7. **Expansion:** only after single-business workflows are reliable, add organizations, cross-tenant isolation, configurable service categories and broader recruitment campaigns. Re-test every data boundary.

## Optional video introduction: proposed contract (not implemented)

- Applicant explicitly chooses whether to record/upload a short introduction; no video, camera/microphone permission, identity provider or biometric collection is required. Permit the applicant to continue or withdraw a selected video without penalty. Provide an accessible text alternative and communicate intended viewers, retention, deletion and acceptable content. Do not ask applicants to disclose protected traits or unnecessary sensitive information. Obtain appropriate employment/privacy legal advice; provide consistent, job-related human review and avoid AI screening or facial/voice analytics.
- Offer mobile camera recording and, if approved, an existing file. Preview and allow re-record/remove before final submission. A 30-second limit must be independently checked server-side using a hardened media inspection/transcoding service, not merely a browser metadata field; bound file size, supported codecs, duration, processing time and resource consumption. Handle unsupported browsers, denied permissions, intermittent connections and processing failures without blocking the non-video application.
- Use a private storage location and random object IDs. Authorize every owner access and provide short, no-store responses with least-privilege access; do not include video or reusable URLs in owner email, public assets or employee views. Virus/content scanning, provider security and upload abuse controls must be established before access. A downloaded/screen-recorded copy cannot be technically recalled.
- Model separate explicit consent/version, upload state, application association, processing outcome, deletion request, timestamps, approved retention period and auditable access/deletion. Ensure failed, abandoned and withdrawn uploads are actually purged, including backups/caches under policy. Do not claim a video is saved until upload, inspection and association commit. Apply state-machine and race tests for retry, failed processing, expired sessions, withdraw-before/after-submit and deletion.
- Obtain Andy's approved storage/retention period, authorized reviewers, accessible alternative, employment/privacy guidance, size/format limits, provider/budget and moderation/incident procedures. Do not send raw video to AI or use it to make hiring decisions.

## Key architecture choices and tradeoffs

Qualitative scores, 1–5: higher is better. Security is a hard requirement, not something to trade away for total points.

| Choice | Alternative | Correctness | Efficiency | Maintainability | Security | Minimality |
|---|---|---:|---:|---:|---:|---:|
| Attribution | Server-generated one-use code, hash stored, transactional claim (chosen prototype) | 4 | 5 | 4 | 4 | 4 |
| Attribution | Editable employee ID submitted by applicant | 1 | 5 | 3 | 1 | 5 |
| Video | Private upload plus server inspection and per-request authorized viewing (recommended; not built) | 5 | 3 | 3 | 5 | 2 |
| Video | Public file or email attachment with client-only length check | 1 | 4 | 3 | 1 | 4 |

Code normalization and SHA-256 are O(n) in code length (fixed at 64 characters); indexed hash lookup and a row lock avoid scanning invitations on redemption. Database indices give typical logarithmic lookup, while contention and database/provider latency are unbenchmarked. SHA-256 here is suitable for randomly generated 256-bit secrets; it would not make human-chosen weak codes safe. A link is a bearer secret: a recipient can forward it, and a forwarded or leaked link can be used first. One-use/expiration and a creation cap reduce, but do not eliminate, abuse. A false personal referrer name is not treated as verified attribution.

## Testing and known limits of this iteration

- PGlite tests exercise employee vs stranger permissions, code-use/expiration, idempotent replay, content conflict, atomic attribution/outbox/audit, failure rollback and deactivation. They also check persistence and authorization for experience answers on referred and unreferred applications. Local tests are not real Supabase authorization or concurrent deployment tests.
- Mobile Chromium tests with synthetic data and mocked Turnstile/API exercised invitation autofill, review without premature submission, edit and resubmit, optional responses, Spanish review, and an unaffected quote flow. Automated axe checks found no violations on the particular enabled application and review states tested after contrast fixes. This is not a database, live-provider, full accessibility, or employee-to-applicant end-to-end test.
- Referral UI and migrations remain disabled by default. Employee creation, real login, external providers, delivery and two-device end-to-end flow were not tested. No accounts or remote resources were changed. See `RED_TEAM_REVIEW.md` for the previous review and unresolved launch blockers.
