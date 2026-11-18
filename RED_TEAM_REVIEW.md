# Red-team review and production roadmap

**Review date:** 17 November 2026
**Scope:** Repository and local build, dossier comparison, security and workflow review, desktop/mobile browser smoke tests, and selected automated accessibility checks. No production deployment, external account changes, penetration test, live provider integration, or real user data were used.

## Bottom line

The project is a compelling bilingual **concept demo with a real intake foundation**, not yet an operational cleaning-business platform. It is not ready for real applicant, client, worker, school or hospital data. The dashboard at `/` is publicly accessible and its hiring, coverage, training and assistant interactions are simulations in browser memory. `/apply`, `/quote`, owner access, application emails and the experimental assistant are separately gated and off by default. They have useful security foundations but have not been verified with live services. Do not turn them on for real data yet.

The dossier's intended destination is much broader: hiring from the owner's phone, automated coverage, verified training, an actionable assistant and bilingual worker/client experiences (`Build Dossier`:63–90, 92–117, 119–140, 211–214, 332). The site-guide preview is explicitly fictional; real directions and floor plans remain **coming soon**.

## What changed during this review

- The dashboard now displays the next new sample applicant after a simulated hire/pass rather than continuing to show the old one (`app/ui.js`:26, 48–53).
- Services and About quote buttons now reach `/quote`; the Spanish demo link opens the Spanish quote form (`app/ui.js`:61–62, `app/quote/page.js`:5).
- Application forms now explain missing shifts/languages and invalid phone numbers before asking for verification, with English and Spanish messages. Phone validation is shared with server validation (`app/public/intake-form.js`:18–25; `lib/validation.mjs`; `lib/intake.mjs`:1–4).
- Added an unbranded commercial-supplies image with restrained bubbles as a dashboard tile linking to Services (`public/images/cleaning-essentials.webp`, `app/ui.js`, `app/globals.css`). It is illustrative, not a claim about actual equipment or staff.
- Improved contrast on tested views, heading structure, language-button accessible name, landmark labels and document language when switching languages (`app/globals.css`, `app/ui.js`, `app/site-guide-demo.js`, `app/public/intake-form.js`, `app/owner/assistant/owner-chat.js`). This is progress, not an accessibility certification.
- Corrected setup documentation to say **all** migrations, not both.

## Prioritized findings

### P0 — launch blockers / keep disabled

1. **Public demo can be mistaken for a live owner console.** The sample dashboard looks operational but changes reset on refresh; coverage assumes a sample worker accepts, training completion is a click, and the assistant is scripted (`app/ui.js`, `lib/demo.mjs`, `README.md`:17–27). No worker is contacted. Production needs a clearly separate public marketing experience and authenticated role-specific workspaces, with real statuses and unmistakable demo labeling. Do not load real data into `/`.
2. **Owner access does not meet the dossier's security requirement.** Owner membership and RLS exist, but the email-link login is explicitly development-only; passkeys, approved devices, step-up authentication and session policy do not exist (`lib/server/supabase.js`:36–39; `app/owner/page.js`:8–17; `README.md`:31–47). Validate authorization and revocation against an actual dedicated project before any sensitive information is entered.
3. **The worker portal and site authorization do not exist.** The site guide is a public example, not assigned-worker access. There are no real shifts, identity checks, assignment-based permissions or private documents (`app/site-guide-demo.js`, `lib/site-guide.mjs`; `README.md`:68–81). Require server-side current assignment, worker status, site eligibility and approved access window on every request; use private storage and prevent caching. Obtain client permission and avoid access codes or patient/student information. Shared links, screenshots and downloaded files cannot be recalled.
4. **Live infrastructure and abuse defenses are unverified.** Supabase migrations/RLS have only been exercised with local PGlite, not the selected live provider; Turnstile, origin and hostname restrictions, email delivery, scheduling, backup/restore, monitoring and WAF/rate limits need end-to-end deployment tests (`app/api/intake/route.js`:9–56; `README.md`:36–55). No dedicated business project has been identified. Automated tests and the current repository do not establish production readiness.
5. **Dependency advisories need resolution.** `npm audit --omit=dev` reports one high transitive PostCSS finding and one moderate Next.js finding, with several PostCSS advisories including source-map file disclosure and CSS-stringification XSS. `next@15.5.29` brings in `postcss@8.4.31`; npm proposes a major Next upgrade to 16.4.6. See [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), and [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93). These are dependency findings, **not proof of an exploitable application path**; no attacker-controlled CSS/source maps are knowingly processed by this app. Assess patched Next and/or supported override in an isolated branch/test environment, review compatibility, rebuild and rerun browser/security tests. Avoid an untested major upgrade or override in a security-sensitive release.

### P1 — essential operations and human usability

6. **Hiring emails have a safe foundation but no production delivery assurance.** A transactionally queued applicant email and lease/retry worker exist; Andy's recipient is blank, no scheduler is provisioned, failures after eight attempts need attention, and provider acceptance is not delivery (`README.md`:49–60; `lib/server/application-notifications.js`; `app/api/jobs/application-notifications/route.js`). Configure a verified sender, owner-approved mailbox, scheduler, monitoring, failure alerts and operational runbook; test outage, retry and mailbox delivery. An email can contain personal data, so confirm mailbox security and retention. Do not put unsecured hire/pass action links in emails.
7. **Intake idempotency has user-recovery limits.** Duplicate same-content requests with the same request ID are reconciled after a fresh verification (`app/api/intake/route.js`:33–52; `app/public/intake-form.js`:11, 28). After an uncertain response the widget resets; the applicant must verify again. Reload creates a new ID and can produce duplicates after a successful but unacknowledged insert; editing after an uncertain submission can yield a conflict. Test this against real Turnstile and network failure and design privacy-preserving recovery/deduplication rather than claiming exactly-once submission.
8. **Coverage is not a scheduling system.** There are no real offers, timers, acknowledgments, concurrency-safe claim, overlap/availability checks, escalations, hours/quiet-hours policies, real client notification or fallback operator workflow (`lib/demo.mjs`; `README.md`:19–27). Specify rules with Andy, model shifts and eligibility, then implement an atomic, auditable claim and queue; simulate races and provider outages before a limited pilot. SMS consent, carrier registration, STOP/HELP handling and jurisdictional review must precede messaging.
9. **Assistant is not yet the autonomous business assistant.** The demo is scripted. The separate opt-in owner assistant can send the owner's typed question and aggregate counts to an external provider; it has no tools or actions. Its request count limit is not a monetary cap, and the typed question can itself contain sensitive data (`README.md`:62–66; `app/api/owner/assistant/route.js`; `lib/assistant.mjs`). Add a provider spend cap, privacy policy/retention controls, independent alerts, authorization for every future tool, audit logs, and explicit approval for consequential actions. Stage from read-only suggestions to supervised, narrowly scoped actions; never rely on model instructions as authorization.
10. **Training and bilingual coverage are incomplete.** Training is a simulated lesson click, not verified watch time, approved material or persisted completion. The separate owner inbox is English-only; language choice does not consistently persist across all navigation, and some demo labels/static content remain English (`app/ui.js`, `app/owner/page.js`:17, `app/public/header.js`). Obtain permitted material and bilingual human review, implement accessible captions and honest completion evidence, then perform end-to-end translation and screen-reader testing.
11. **Accessibility and mobile testing remain incomplete.** Automated axe checks initially found contrast, heading and accessible-name issues; fixes removed reported violations in the specific tested mobile demo views and disabled Apply state. That does not cover enabled forms, dialogs, all interaction states, keyboard/focus management, screen readers, zoom, translations or actual users. Dialogs in `app/ui.js` need focus management, escape handling and return-focus testing. Very small secondary text remains in parts of the design. Establish keyboard/screen-reader and WCAG review with representative workers and clients before release.
12. **Lead handling is partial.** Quotes save into the separate owner inbox when configured, but no quote alert, workflow/SLAs, service-area validation, client contact page or real sales follow-up automation exists (`app/owner/page.js`:13–17). The 100-record limit has no pagination. Define response ownership, add alerts and pagination, and test unsuccessful handoffs.

### P2 — maintainability and operational maturity

13. **Regression coverage needs to follow workflows.** `npm test` covers validation, demo selection rules, and database/provider mocks, but browser smoke tests used for this review are temporary, not checked-in CI. Add maintained automated desktop/mobile and accessibility tests, real-provider staging tests, reproducible CI, audit checks and dependency update policy; test English and Spanish, failures and race conditions.
14. **Demo and production logic need clearer boundaries.** `app/ui.js` contains extensive inline translated copy and many views on long lines; CSS has accumulated selectors. Separate product areas, translations and shared accessible components to improve reviewability. Keep production data paths isolated from demo state and explicitly label generated imagery and fictional metrics.
15. **Operational policies are not established.** Define privacy notices and retention/deletion, incident response, audit review, backups and restore drills, secret rotation, production/staging separation, consent/legal requirements, service accessibility and content governance. Owner controls should show when automation failed, what was actually done and what needs a decision.

## Practical path to production

1. **Agree on scope and safety:** confirm business/brand permissions, services, contact channels, privacy/retention and launch geography; approve a dedicated test project. Keep real information out while access is development-only.
2. **Ship a secure minimum hiring and quote pilot:** patch dependencies; implement owner passkeys/device controls, staging RLS and abuse protection; configure synthetic intake and email with scheduler/alerts; verify retry, auth, recovery, accessibility and translations. Then run a small authorized pilot with monitoring, a rollback plan and a human fallback.
3. **Build crew identity and assignments:** authenticated mobile-first worker flow, explicit consent, actual worker/site records, shift assignments, eligibility and assignment-scoped authorization. Add private approved directions/maps only after customer approval and access tests.
4. **Build coverage and training:** persisted shift state and atomic claims, opt-in messaging, escalation with failure alerts, verified bilingual training and real completion records. Test competing claims, quiet hours, clock changes and provider failures.
5. **Expand automation deliberately:** owner assistant starts read-only and earns narrowly scoped, server-authorized tools with review, audit, approvals and hard spend limits. Add reporting, client workflows and recognition only on a reliable data foundation.

## Decisions and materials needed from Andy

- Approved business name, domain, territory, services, phone and any franchise/brand restrictions; the current Goodwork name and imagery are placeholders.
- A dedicated Supabase project and test/staging deployment target, with authorization to configure them. Do not supply secrets in chat; use the providers' secure environment settings.
- Andy's approved notification email address (currently intentionally blank), verified sending domain, who monitors failures, and acceptable response times for applicants and quotes.
- Current hiring and referral process, who may approve school/hospital eligibility, actual contract screening requirements, and whether/how applicant texts are desired.
- Current staff/site/shift workflows, primary/backups, availability, hour caps, escalation timing, quiet hours, fallback contacts and customer notification rules.
- Floor plans, approved directions and written client permissions when available, plus document owners, who may see what, update/revocation policy and supervisor contacts. Do not upload sensitive plans to the public demo.
- Approved training sources, franchise permissions, Spanish-speaking reviewer, and requirements for completion evidence; privacy/retention and legal/SMS review; priorities and budget for the first pilot.

## Evidence and test limits

- `npm test`: 23/23 passing, including local PGlite authorization/queue/quota tests, validation and mocked provider calls. `npm run build`: passed.
- Headless Chromium exercised hiring, school/hospital coverage, lesson simulation, fictional guide, Spanish display, quote navigation and mobile widths. At 375px, tested home/guide pages had no document-level horizontal overflow; no browser page errors were recorded in that smoke run.
- Enabled-form browser tests used **mock** Turnstile and a **mock** intake response with synthetic values: English validation, Spanish missing-shift message, application and quote success paths. They prove client behavior only, not real verification or database writes.
- Automated axe checks of the tested 390px demo views and disabled Apply state reported no violations after targeted fixes. This is not a full accessibility audit and did not test enabled forms or authenticated pages.
- `npm audit --omit=dev` remains nonzero with 1 high and 1 moderate dependency finding as above. No live Supabase, email, AI, Turnstile, scheduler or deployed authentication end-to-end test was performed.

## Design choices and tradeoffs

Scoring below is a qualitative review aid (1 poor, 5 strong), not a security guarantee. Security is a hard gate: a higher total never justifies accepting a broken authorization boundary.

| Decision | Approach | Correctness | Efficiency | Maintainability | Security | Minimality |
|---|---|---:|---:|---:|---:|---:|
| Form validation | Shared client/server phone predicate, authoritative server schema (chosen) | 5 | 5 | 5 | 5 | 4 |
| Form validation | Separate browser-only validation | 2 | 5 | 2 | 1 | 5 |
| Facility documents | Per-request authorized no-store proxy (recommended, not built) | 5 | 3 | 4 | 5 | 3 |
| Facility documents | Long-lived shareable public/signed links | 2 | 5 | 4 | 1 | 5 |

The shared phone check runs in O(n) time and O(n) temporary space due to digit normalization, with input capped at 25 characters; it checks format/length, not whether a number exists or can receive SMS. The hypothetical document proxy adds an authorization/database check and streaming overhead per request; it cannot stop a currently authorized recipient from saving or photographing a document. No performance benchmark or full security assessment was performed.
