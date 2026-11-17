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

This is **not a secure or production-ready system**. The owner workspace is not authenticated; there is no database, role-based access control, SMS, push, scheduler, geofencing, real applicant intake, AI provider, API key storage, real training player, or audit log. Do not enter real personal, school, patient, or customer data. No actions send messages or save data. The simulated Bench is not a scheduling engine: it does not implement offer timeouts, overlap detection, rotation, quiet hours, premium approvals, or concurrency control.

Before launch, confirm branding/franchise permissions, actual services and territory, site screening requirements, training sources and translations, and approved contact details. Implement passkeys and server-side authorization, database row-level security, consent and SMS registration, secure queues and atomic shift claims, privacy controls, and explicit approvals for external messages and sensitive actions. Review the dossier for the full requirements and open questions.

## Intake foundation (not yet approved for production)

The separate `/apply` and `/quote` pages and `/owner` inbox are the beginning of a real, persistent workflow. They are **off by default**. The demo at `/` remains fictional and is not connected to the inbox. No project has been selected or modified, and nothing has been deployed.

- The two forms validate on the server, use an explicit Turnstile verification action and hostname, cap request body size, and insert using a server-only service key. An idempotency key prevents repeated submissions from creating a second record. The application collects optional SMS consent, consent timestamp and wording version, plus the form language. It does not send any messages. Quote requests do not grant SMS consent.
- Owner accounts must exist in Supabase Auth **and** have a manually provisioned `owner_memberships` row. The inbox uses the signed-in user's session, not the service key; Postgres RLS and column grants restrict reads and updates. Status and clearance changes are recorded in the audit table without copying contact details. The inbox currently displays the latest 100 records of each type.
- Owner email-link login is a **development-only interim mechanism**, disabled by default. It is not the dossier's passkeys, approved-device enrollment, step-up authentication, or 90–180 day policy. Do not use it for real personal or sensitive data. Clearing a site flag is a manual owner action, not verification of a background check.

### Development setup on a dedicated test project only

1. Choose a dedicated Supabase project and apply `supabase/migrations/20261117000000_intake_foundation.sql` through the normal migration workflow. Do not apply it to another application's database. Create an owner user in Supabase Auth and, using an administrator-only SQL session, insert that user's actual UUID into `public.owner_memberships`. Never provide an anonymous user with membership-write privileges.
2. Copy `.env.example` to `.env.local` and configure the project URL, publishable key, and server-only service role key. Configure `APP_ORIGIN` to the exact canonical origin (HTTPS in production; no trailing slash), register `/owner/auth/callback` as a Supabase Auth redirect, and restrict signup appropriately. For local development use `http://localhost:3000`. Enable email link login only in a controlled test environment.
3. Configure Cloudflare Turnstile for the same hostname and set its site and secret keys. Test the `application` and `quote` widget actions. Only set `INTAKE_ENABLED=true` for a controlled test; it requires all configuration to be present. All pages and the API fail closed by default.
4. Exercise the complete flow with synthetic data and validate the RLS policies against the actual Supabase deployment. `npm test` includes an embedded Postgres RLS test (PGlite omits the pgcrypto extension statement because it already provides `gen_random_uuid`); it does not replace deployment integration tests.

### Launch blockers

Implement passkeys, device approval, session controls and step-up checks; complete real Supabase and Turnstile integration testing; configure WAF/rate limiting and monitoring; review privacy notice, retention/deletion, accessibility, translations, consent wording and legal/SMS requirements; register the texting number and implement opt-out/HELP handling before sending messages; approve brand, services, contact details and franchise usage. Add inbox pagination and operational backups. No automatic messages, offers, scheduling, worker portal, training verification, or AI actions are implemented. Client and crew data must not be entered until the security and operational requirements are satisfied.
