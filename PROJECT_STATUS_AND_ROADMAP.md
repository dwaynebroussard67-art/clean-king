# Project status, changes, and road to the end goal

**Snapshot:** 17 November 2026
**Project:** Goodwork placeholder / cleaning-business platform
**Baseline:** main at `93cf788642e1fb5da428c6c6b81a958f93532607` (PR #3); this document describes the changes prepared for the next merge.
**Purpose:** Explain what exists, what works only in a controlled test or demo, what is missing, and how to reach a reliable business operation.

## Executive summary

The project is **early development, not production-ready**. It has a polished bilingual fictional demonstration and meaningful, disabled-by-default foundations for persistent applications, quote requests, owner review, notifications, referrals, and a limited experimental assistant. It does **not** yet run a cleaning business or demonstrate the complete referral-to-hire-to-training-to-scheduling journey.

Merging source code preserves the work; it does **not** configure providers, apply database migrations, turn on features, prove delivery, or establish production readiness. A hosting provider could deploy a merge according to its own configuration; deployment status is not verified by this document. Keep production intake, referrals, email and assistant features disabled and use synthetic data until security and integration gates are met.

### The distinction used throughout

- **Demonstration:** a screen or simulation exists but does not do the real-world operation.
- **Foundation built / locally tested:** implementation exists and has local tests, but its live integration and operating procedures are unverified or incomplete.
- **Operational:** an entire approved workflow works with persisted records, permissions, failure handling, and end-to-end evidence. **No complete real-business workflow is claimed operational yet.**
- **Missing:** the requested real feature is not implemented.

No percentage-complete estimate is offered: features differ greatly in scope and risks, and local code/tests alone do not measure operational completion.

## What this merge adds compared with the baseline

| Area | Change in this branch | Limit |
|---|---|---|
| Referral invitations | Test-only employee page can create random, one-use, seven-day invitation codes and shareable links; code hashes, invitation creation/expiry/use, attribution and an audit event are stored (`app/crew/referrals/`, `lib/referrals.mjs`, `supabase/migrations/20261117030000_referral_foundation.sql`). | Disabled by default. Employee membership is manually provisioned, login is development-only, and the entire two-device flow has not been tested against real services. |
| Referral application | Applicant can receive a code in a link or enter it; server checks and consumes a valid code atomically with the application and existing notification outbox. Same-request/same-content retries are recognized. | Validation happens on final submission, not when the link is opened; there is no saved draft or separate application-start timestamp. A link is a transferable bearer secret. |
| Applicant experience | Optional experience and willingness-to-train questions, bilingual review/edit before final submission, and owner-inbox display. Unanswered optional questions remain null, not “no” (`app/public/intake-form.js`, `lib/intake.mjs`, `20261117040000_application_experience.sql`). | Not yet tested with a deployed database or real users. Answers are not included in the owner email. Fairness, translation and legal review remain necessary. |
| Usability and accessibility | Fixed stale demo applicant attention card, connected Services/About quote buttons to the quote page, added form validation messages and improved language attributes, landmarks and contrast on tested views. | Demo state remains fictional; automated accessibility checks are limited, not certification or full assistive-technology testing. |
| Visual details | Added an unbranded supplies image with subtle bubbles on a dashboard tile linking to Services. | Illustrative imagery, not a claim about actual employees, clients or equipment. |
| Tests and documentation | Added local tests for referral authorization, expiry, one-use attribution, retry, rollback and optional experience; added a red-team review and implementation map. | Local database tests use PGlite and browser intake checks mock providers; no claim of live end-to-end completion. |
| Video introduction | An honest “coming soon” notice and design requirements. | **Not implemented:** no recording, upload, storage, playback or deletion. Video is optional and not required to apply. |

Existing foundations from previous work are retained rather than rebuilt: the fictional dashboard and coverage simulation; disabled persistent intake and owner inbox; notification outbox and retry worker; disabled experimental owner assistant; and fictional site-guide preview.

## Current state versus the end goal

| Capability | Current state | End goal / remaining difference |
|---|---|---|
| **Owner dashboard** | Demonstration: fictional metrics, applicants, crew and actions in browser memory (`app/ui.js`). | Authenticated, phone-first operational console driven by saved, permission-filtered records; no invented data presented as real. |
| **Public apply and quote** | Foundation built: separate server-validated, Turnstile-gated forms, size limits, server-only inserts and content-hash idempotency; off by default. | Deployed and tested applications and inquiries, clear recovery and monitoring, verified live providers, accessibility, bilingual review, and documented privacy/retention. |
| **Applicant experience** | Basic identity/contact, availability, transport, languages, optional experience and review; phone autofill supported. | Short progressive and resumable flow; applicant-controlled authorized information sources, configurable relevant questions and disclosures, recorded start/submission and robust recovery. The referral code alone never retrieves personal information. |
| **Optional video résumé** | Missing; marked coming soon. | Applicant-controlled ~30-second video or accessible non-video alternative, independent server-side duration/file verification, private access, consent and deletion, with equitable human review and no AI hiring decision. |
| **Employee recruitment/referrals** | Disabled test foundation: employee membership, invite creation/share, single-use code and transactionally recorded attribution; employees see aggregate counts only. | Secure employee activation; pre-submission validation and safe session start, notifications and reporting without private applicant details, corrections and abuse handling; a real two-session demonstration. Optional bonuses need eligibility ledger and authorized approval, never automatic payment. |
| **Hiring and onboarding** | Owner test inbox can change limited applicant statuses and manual school/hospital flags with audit. | Authorized hiring decision creates/activates the employee, transfers appropriate data, starts onboarding and required training, and records every transition. A “hired” label is not onboarding. |
| **Employee portal** | Test-only referral page and fictional site-guide preview; no real portal. | Secure, accessible employee access to own shifts, assigned jobs, training, qualifications, notifications and referrals, with least-privilege permissions. |
| **Training** | Three fictional lesson previews and simulated completion. | Approved free content, bilingual captions, assessments and trustworthy completion/renewal records that determine eligibility; do not claim certification without authorization. |
| **Scheduling / Bench** | Simulation checks sample availability, training, clearance and hour cap, then assumes acceptance. | Real shift/availability records; qualification and overlap checks; timed offers, worker responses and atomic claims; escalation, owner override rules and notifications. No worker is actually contacted today. |
| **Site directions and floor plans** | Public fictional interactive preview; real maps/directions marked coming soon. | Client-approved information, server-checked active assignment/eligibility and time window, private no-store document access, versioning/review and restricted distribution for sensitive facilities. |
| **Job completion** | Missing. | Task/checklist and issue reporting, recorded start/finish where approved, and separate employee-reported, supervisor-verified and customer-confirmed states. |
| **Customer and quotes** | Disabled quote-intake and owner inbox foundation. | Customer records, inquiry follow-up, authorized estimate creation/sending, explicit acceptance, scheduling and customer updates; no quote is a contract until approved. |
| **Applicant email to Andy** | Disabled durable outbox and bounded retry worker; recipient intentionally blank. | Verified sender and recipient, protected scheduled retry, monitoring/alerts, privacy approval and end-to-end mailbox delivery testing. Provider acceptance is not proof of delivery. |
| **AI assistant** | Demo is scripted. A separate disabled experimental owner-only endpoint can use an AI provider with a typed question and aggregate counts; no tools or actions. | Evidence-backed answers on authorized data, hard spend limits, privacy controls and audited server-authorized tools; consequential actions require owner approval. It must not independently decide whom to hire. |
| **Security, privacy and operations** | RLS, server-only service keys, owner membership, input checks, audit events and quotas have local tests. Temporary email login is not production security. | Passkeys/approved devices, role permissions, secure employee activation, WAF/rate limiting, retention/deletion, backup/restore, monitoring, incident procedures, accessibility and legal review, plus live provider testing. |
| **Management, reports and scale** | Mostly missing; current design assumes one business. | Delegated manager roles, reliable job/revenue/labor records and reports, then deliberate organization isolation and configuration before supporting multiple businesses. |

For the complete feature classification and proposed video/security design, see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). For the adversarial review and dependency details, see [RED_TEAM_REVIEW.md](RED_TEAM_REVIEW.md).

## Roadmap and measurable milestones

The milestones are ordered to preserve existing work and prove connected workflows before adding broad automation. The order is a plan, not a claim that a phase is already complete; time and cost estimates require a defined scope and provider choices.

### 1. Secure synthetic-data staging — **foundation exists; not complete**

- Select and authorize a dedicated test Supabase project and staging deployment; do not use an unrelated project. Apply all five migrations **in timestamp order**, including the experience migration even when referrals are off.
- Resolve dependency advisories; establish secure owner and employee identity, passkeys/approved devices for privileged users, access revocation, RLS and service-role boundaries. Add WAF/rate limits, privacy/retention/deletion procedures, backups/restore and monitoring.
- Configure Turnstile and email only for approved synthetic tests. Recipient and sender remain placeholders until provided and verified.
- **Exit proof:** documented staging setup, real-provider integration tests for authorization and failure recovery, security review, operational runbook and rollback. No real applicant or facility data before approval.

### 2. Complete referral → applicant → owner review — **partially built, not operational**

- Add application-start tracking and secure resume, pre-submit validation, referral correction/revocation policy, user-friendly owner attribution, privacy-safe employee updates, and reviewed bilingual applicant questions.
- Complete owner notification delivery/retry/alerting and verify inbox/status changes; establish a fair, authorized human hiring process. Do not infer identity from a referral code or silently import contacts.
- **Exit proof:** two separate devices or browser sessions with synthetic employee and applicant: generate/share invitation, open it, complete and review application, verify attribution, receive owner notification and see the saved record. Include invalid, expired, already-used, concurrency, network-loss and unauthorized-access tests; record actual results.

### 3. Optional video introduction — **not built**

- Add a genuinely optional camera/file flow and accessible alternative, explicit consent, preview/remove, private upload and owner-only review, safe media inspection and retention/deletion cleanup. Independent server checks must enforce duration and resource limits.
- **Exit proof:** synthetic upload/review/removal, no-video application, unsupported device, oversized/overlong file, interrupted upload, unauthorized access and deletion tests; privacy, employment, accessibility and security review completed.

### 4. Hire → employee → onboarding → training — **not complete**

- Implement authorized transitions, secure activation and employee records, appropriate information transfer, onboarding tasks, training assignment, assessments and auditable qualifications. Obtain approved bilingual training materials and policies.
- **Exit proof:** an approved synthetic applicant becomes a securely activated employee without duplicate manual entry; assigned training is completed and recorded with evidence; access is denied to other workers.

### 5. Scheduling → job → verified completion — **not built**

- Implement customers/sites, shifts, availability, qualification requirements, staffing/overlap checks, assignment and confirmations, task checklists, issues and separate verification states. Add assignment-scoped private site maps only with customer authorization.
- **Exit proof:** a synthetic employee receives an eligible assignment, reports work, and an authorized supervisor verifies it; concurrent or conflicting assignments are rejected and access is revoked when assignment ends.

### 6. Operational Bench and communications — **simulation only**

- Add primary/backups, call-out intake, timed offers, atomic first-eligible acceptance, escalation, customer-notification policies and manual fallback. Register messaging, capture consent and implement STOP/HELP before actual texting.
- **Exit proof:** exercise simultaneous acceptances, unavailable/uncleared workers, missed replies, provider outages, quiet hours and owner escalation with synthetic participants; no duplicate assignments or false “message sent” claims.

### 7. Customers, reporting and supervised AI — **partial foundations only**

- Add estimates, explicit approvals, customer communications and reporting from actual records. Introduce evidence-backed assistant tools one at a time, with server-side authorization, logging, spend caps and human approval for consequential actions.
- **Exit proof:** each report reconciles to source records and every assistant action shows evidence, correct permissions, approval and actual result. No autonomous hiring decisions.

### 8. Broader expansion — **future**

- After the single-business system is reliable, add configurable service categories, managers, multiple locations and tenant boundaries. Referral rewards and community/campaign links require explicit policy and audit, not assumptions.
- **Exit proof:** cross-tenant isolation tests, configuration tests and an operating model for each additional business.

## Decisions and materials needed from Andy

These can be supplied in stages; **do not put provider secrets in chat or source control**.

1. Approved business name, domain, service area, services, contact details and franchise/brand permissions. “Goodwork” and imagery are placeholders.
2. An approved **dedicated test** Supabase project and staging/deployment target; who can administer them and permission to configure them. None has been identified as the cleaning business's project yet.
3. Andy's approved notification email address, verified sender domain, who monitors failures and acceptable applicant/quote response times.
4. Hiring stages, relevant job questions, referral bonus/correction rules, who can hire and who approves school/hospital eligibility. Confirm actual contractual screening rules and obtain employment/privacy advice.
5. Training materials and permissions, a Spanish-language reviewer, qualifications and renewal rules; employee availability and shift/coverage/quiet-hour escalation rules.
6. Site locations, floor plans and supervisor contacts **only when** client permission and secure assigned-worker access are ready. Do not upload sensitive maps to the public demo.
7. Video introduction policy: authorized viewers, privacy notice and consent, retention/deletion, accessible alternative, fair-hiring review, file constraints and provider/budget.

## Verification, limits, and deployment cautions

- On this branch, `npm test` passed **27/27**, `npm run build` passed, and `git diff --check` passed. Local PGlite tests cover authorization, queue, quota, referral attribution and experience storage. These are not live Supabase or concurrency/load tests.
- Earlier mobile Chromium checks used synthetic data and mocked Turnstile/intake responses to exercise the review/edit flow, invitation-code input and Spanish copy. Selected automated axe scans passed after targeted contrast fixes. Neither is a full accessibility audit or the required two-device, real-provider employee-to-applicant demonstration.
- `npm audit --omit=dev` previously reported **one high and one moderate** dependency finding through PostCSS/Next. This is a dependency advisory, not proof of an exploitable application path. Recheck and resolve before release.
- No live Supabase migration, real email, Turnstile, AI, deployed login or production data flow was tested as part of this work. No business project was selected or changed. The prior branch note and PR merge do not themselves prove deployment health.
- Apply migrations before the new intake code; otherwise new experience fields can fail. A retry spanning a deployment can conflict because the validated request content has changed. Referral-linked records currently restrict deletion through foreign keys; implement and test a lawful retention/deletion process before use.
- The demo, experimental referral pages, current temporary login and optional video notice must not be mistaken for an operational product. Keep all unapproved features off and never place real school, hospital, patient, student, customer, worker or applicant data in the demo.
