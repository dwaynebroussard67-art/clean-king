# Goodwork — interactive concept

A Phase 0 demo inspired by the Build Dossier for Andy Merchant. Goodwork is a placeholder name, not an assertion of franchise affiliation. All applicants, crew, shifts, metrics, sites and activity are invented. No customer or franchisor marks are used.

## Run locally

Requires Node.js 20.9 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Run `npm test` for the sample coverage rules and `npm run build` for a production build of the demo.

## What the demo does

- Review sample applicants, simulate decisions and toggle site clearance. These changes live only in browser memory and reset on reload.
- Simulate a school or hospital call-out. The sequence skips workers who are unavailable, lack Rookie Run or the applicable clearance, exceed an hour cap, or lack the health track for hospital work. The first eligible sample worker is assumed to accept; nobody is contacted or assigned.
- Preview a three-lesson sequence and simulate completion. There are no actual training videos, watch-time checks, certificates, or persisted records.
- Explore a scripted assistant, service templates and an owner page shell, in English or Spanish.

## Important limits before real use

The **demo at `/` is not a secure or production-ready system**. Its owner workspace is not authenticated and its actions do not send messages or save data. Separate, disabled-by-default intake and email-notification foundations are described below, but have not been deployed or verified with live providers. Do not enter real personal, school, patient, or customer data. The simulated Bench is not a scheduling engine: it does not implement offer timeouts, overlap detection, rotation, quiet hours, premium approvals, or concurrency control.

Before launch, confirm branding/franchise permissions, actual services and territory, site screening requirements, training sources and translations, and approved contact details. Implement passkeys and server-side authorization, database row-level security, consent and SMS registration, secure queues and atomic shift claims, privacy controls, and explicit approvals for external messages and sensitive actions. Review the dossier for the full requirements and open questions.

## Intake foundation (not yet approved for production)

The separate `/apply` and `/quote` pages and `/owner` inbox are the beginning of a real, persistent workflow. They are **off by default**. The demo at `/` remains fictional and is not connected to the inbox. No project has been selected or modified, and nothing has been deployed.

- The two forms validate on the server, use an explicit Turnstile verification action and hostname, cap request body size, and insert using a server-only service key. An idempotency key prevents repeated submissions from creating a second record. The application collects optional SMS consent, consent timestamp and wording version, plus the form language. It does not send any messages. Quote requests do not grant SMS consent.
- Owner accounts must exist in Supabase Auth **and** have a manually provisioned `owner_memberships` row. The inbox uses the signed-in user's session, not the service key; Postgres RLS and column grants restrict reads and updates. Status and clearance changes are recorded in the audit table without copying contact details. The inbox currently displays the latest 100 records of each type.
- Owner email-link login is a **development-only interim mechanism**, disabled by default. It is not the dossier's passkeys, approved-device enrollment, step-up authentication, or 90–180 day policy. Do not use it for real personal or sensitive data. Clearing a site flag is a manual owner action, not verification of a background check.

### Development setup on a dedicated test project only

1. Choose a dedicated Supabase project and apply both migrations in `supabase/migrations/` in timestamp order through the normal migration workflow. Do not apply it to another application's database. Create an owner user in Supabase Auth and, using an administrator-only SQL session, insert that user's actual UUID into `public.owner_memberships`. Never provide an anonymous user with membership-write privileges.
2. Copy `.env.example` to `.env.local` and configure the project URL, publishable key, and server-only service role key. Configure `APP_ORIGIN` to the exact canonical origin (HTTPS in production; no trailing slash), register `/owner/auth/callback` as a Supabase Auth redirect, and restrict signup appropriately. For local development use `http://localhost:3000`. Enable email link login only in a controlled test environment.
3. Configure Cloudflare Turnstile for the same hostname and set its site and secret keys. Test the `application` and `quote` widget actions. Only set `INTAKE_ENABLED=true` for a controlled test; it requires all configuration to be present. All pages and the API fail closed by default.
4. Exercise the complete flow with synthetic data and validate the RLS policies against the actual Supabase deployment. `npm test` includes an embedded Postgres RLS test (PGlite omits the pgcrypto extension statement because it already provides `gen_random_uuid`); it does not replace deployment integration tests.

### Launch blockers

Implement passkeys, device approval, session controls and step-up checks; complete real Supabase and Turnstile integration testing; configure WAF/rate limiting and monitoring; review privacy notice, retention/deletion, accessibility, translations, consent wording and legal/SMS requirements; register the texting number and implement opt-out/HELP handling before sending messages; approve brand, services, contact details and franchise usage. Add inbox pagination and operational backups. The application email code below is disabled and untested against a real provider; no SMS, offers, scheduling, worker portal, training verification, or AI actions are implemented. Client and crew data must not be entered until the security and operational requirements are satisfied.


## Application emails to the owner (disabled by default)

A submitted application creates a notification record in the same database transaction. The application response does not depend on email delivery. After the response, the server attempts an immediate send; a separate scheduler is **required** for recovery and retry. An email contains first name, phone, area, availability, transportation, languages and referral, so Andy can read it and call from his phone without signing into the website. The email links to the protected inbox for decisions; there are no unprotected hire/pass links. Provider acceptance is not proof that an email reached a phone or inbox. Phone notification settings depend on the owner's email app.

Before using this with real applicants:

1. Obtain an approved, dedicated Supabase project and apply both migrations. The notification migration queues only applications submitted **after** it is applied; it does not backfill older records. Keep intake disabled until both migrations and the whole flow are verified.
2. Set up Resend, verify a sender domain, and configure its server-only key. Enter Andy's approved address in `APPLICATION_NOTIFICATION_TO` and a single verified sender address in `APPLICATION_NOTIFICATION_FROM` through the deployment environment, not source control. Set the canonical HTTPS `APP_ORIGIN`. Keep `APPLICATION_EMAIL_NOTIFICATIONS_ENABLED=false` until these and the privacy review are complete.
3. Configure a trusted scheduler to call `GET /api/jobs/application-notifications` with `Authorization: Bearer <CRON_SECRET>`. Set `CRON_SECRET` as a long random server-side secret (at least 32 characters). Vercel Cron can supply this header automatically when configured; schedule frequency and availability depend on the deployment plan. **No cron schedule is provisioned by this repository**. Use a frequent schedule, alert on non-200 responses, and monitor failed queue records. A job handles at most five messages per invocation. If the scheduler is absent or broken, failed or interrupted sends will not be retried automatically.
4. Enable notifications only after a synthetic end-to-end test and privacy review, including that the recipient controls the mailbox and can receive personal information. Review data retention and email handling. SMS consent is unrelated to the owner's email notification; this code does not send applicant texts.

The queue uses database leases to prevent concurrent claims and exponential retry delays, with a maximum of eight attempts. Failed jobs require operator attention; no independent failure alert is implemented yet. For development, an authorized database operator can inspect `public.application_notifications` (no provider secrets or applicant details are stored there) and after correcting a problem reset a failed row to `pending`, set `attempts=0` and `available_at=now()`. Changes should be logged and performed only under an approved operational procedure. `sent` means the provider accepted the request, not that it was delivered. A stable provider idempotency key reduces duplicates for retries; Resend's idempotency window is finite, so a long outage or an uncertain response can still produce duplicate email. Do not change the recipient, sender, or origin while retrying an uncertain send without investigating it first.

## Owner assistant foundation (disabled by default)

The demo assistant on `/` remains scripted. A separate experimental `/owner/assistant` page and `/api/owner/assistant` endpoint can call OpenAI when explicitly enabled. It uses the existing **development-only** owner login plus server-verified owner membership on every request. The provider receives only the typed question and four aggregate counts: new applications, new quote requests, queued application emails, and failed application emails. It does not receive applicant records or site data through the snapshot. There are no tools, database writes, messages, scheduling, or actions accessible to the model. It can still give an incorrect answer; never assume a statement means an action occurred.

The database migration `20261117020000_assistant_usage.sql` records only run metadata (owner, timestamps, result), not prompts or responses, and serializes admission to a workspace-wide limit of three attempts per minute and 100 attempts per UTC month. Failed calls count too. Input is capped at 2,500 characters, output at 400 provider tokens, and each question is independent. These request limits are **not a monetary spend cap**; pricing can change, so configure a provider-side billing limit and monitoring. Prompts are sent to the provider and subject to its data policy, so do not enter names, phone numbers, student/patient information, credentials or other sensitive data. No conversation memory, prompt logging, or key storage UI is implemented.

For synthetic testing only, apply all migrations in order to a dedicated test project, set the server-only `OPENAI_API_KEY`, and explicitly set `OWNER_ASSISTANT_ENABLED=true` alongside development owner login. Both default off. No live AI call has been tested in this environment. Before real use: replace email-link access with passkeys and approved-device controls; implement and verify a real spend cap, independent usage alerts, privacy review, secure secret management, adversarial testing, and provider-specific data retention settings. Future tools must be separately authorized in server code, logged, and subject to approval where appropriate; prompts alone are not a security boundary.

## Site guide and directions preview

The demo's **My site guide** screen is an invented example, not a crew portal. It has a tappable sample layout in English and Spanish and demonstrates where assigned-site details, instructions, supervisor contact and directions could appear. The demo directions button deliberately does not open a real address. No real floor plans, addresses, shift assignments, worker identity checks, or private file access are implemented; the preview is publicly accessible and must never be used for real site information.

### Research and recommended production design

- Google Maps URLs can open navigation on mobile or in a browser without an API key. The fixed-origin `directionsUrl()` helper encodes an approved address; it is not connected to real data yet. Opening a maps app shares the destination with that provider. [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
- Schools and care facilities may treat floor plans and security information as sensitive. Get the customer's written permission, confirm what can be shared, and use the minimum information needed for the job. Do not put access codes, passwords, student or patient information, or observations about people in site notes. Do not treat a cleaning guide as an emergency map; follow the facility's current official emergency plan. [CISA physical security guidance](https://www.cisa.gov/sites/default/files/2022-11/Planning%20and%20Response%20to%20an%20Active%20Shooter_2021.pdf)
- Store site documents in a private bucket, not public assets. Supabase private buckets support access control, but signed links can be forwarded and individual signed URLs cannot be revoked; caches can also persist after access is removed. Prefer an authenticated, no-store server-mediated document response that checks current authorization on every request, and verify storage/cache behavior before launch. No approach can recall a screenshot or a file already saved on a device. [Storage access](https://supabase.com/docs/guides/storage/buckets/fundamentals), [signed URL limitations](https://supabase.com/docs/guides/storage/serving/downloads), [cache considerations](https://supabase.com/kb/troubleshooting/storage-private-bucket-files-still-accessible-after-remove-access-or-logout)
- A worker should see only their own current or approved upcoming assignments, not the full site roster. An unaccepted offer or backup designation alone should not grant access. The server must validate worker identity, active status, site eligibility, assignment and the owner-approved access window on every site and document request. A forwarded text link by itself is not proof of identity; use a short-lived sign-in flow with appropriate verification and revocation. Actual shift windows and verification method need owner and customer approval.
- Build mobile-first, with labeled, keyboard-accessible areas, readable non-map instructions, language support, document version/date and a way to contact the assigned supervisor. Confirm how floor plans will be supplied, who can approve or replace them, any client restrictions, and how updates are communicated. Build authorization and integration tests before any real site data is loaded.
