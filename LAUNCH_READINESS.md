# Launch readiness: focused three-day plan

**Status:** not production-ready. A successful build/deployment does not mean the application can safely accept real applicants or run hiring, training, or scheduling. These gates cannot be replaced with a deadline. Keep production intake, email-link login, referrals and the assistant disabled; use fictional data until the appropriate launch controls are verified.

## Proposed priority order (not a delivery guarantee)

1. **Day 1 — controlled staging and security.** Obtain explicit approval of a dedicated Supabase test project; inventory who administers it. Establish a separate staging deployment, back up and apply every migration in order, verify RLS and service-key isolation, and test with synthetic users. Design and implement production-grade owner and employee authentication, device/recovery/revocation and authorization; the current email-link login is development-only. Configure WAF/rate limits and review privacy, retention, accessibility and incident response. Verify that an administrative emergency stop works and that service-key rotation is documented.
2. **Day 2 — one real workflow.** On staging, configure Turnstile and the notification provider, verify the sender and the owner's approved recipient, and run application-to-owner review with two separate sessions and synthetic records. Test retries, concurrency, rejection paths, recovery, monitoring, actual email delivery and provider failures. Review legal/employment, consent, bilingual copy and data-retention requirements before accepting any real data. Production must still remain gated until the checks pass and an authorized owner approves release.
3. **Day 3 — controlled launch decision.** Run end-to-end smoke, accessibility and security checks against the actual production configuration, test backups and restore, monitoring and rollback, prepare an incident contact/runbook, and obtain owner sign-off. Launch only the individually verified workflow, if the security and legal/operational gates are met. Referral-to-hire-to-training-to-scheduling is not yet an end-to-end product; do not advertise it as one. If the gates fail, retain the safe presentation and continue staging work.

**Needed from the owner:** identify and approve the dedicated test project (never an unrelated project), authorized owners and employees, verified application-notification recipient, sender/domain and provider, business/brand information and permissions, services and territory, privacy/retention decisions, and the person authorized to approve production. Real maps and plans need separate customer approval. Do not send credentials through chat or commit them to the repository.

## New local safety controls

The forward migrations `20261121000000_owner_access_controls.sql`, `20261121010000_referral_revocation.sql`, and `20261121020000_assistant_quota_serialization.sql` have **not** been applied remotely. Use them only after reviewing and testing the complete ordered migration set in an approved staging project. Roll out schema and matching application code together; without the referral migration the list/revoke functions are unavailable.

### Owner emergency stop

The owner-access control starts **enabled** to avoid silently breaking existing test installations. An administrator with a separately secured privileged SQL connection can stop owner data access through existing owner RLS policies and owner RPCs:

```sql
update public.owner_access_control set enabled = false where singleton = true;
```

Restore only after investigating and obtaining approval:

```sql
update public.owner_access_control set enabled = true where singleton = true;
```

A missing singleton row denies owner access. A particular account can instead be suspended by a privileged SQL administrator setting `public.owner_memberships.active` to false for its verified UUID. Do not use a user-supplied UUID without verification; restore explicitly after approval. Changes produce metadata-only audit events with a null actor, so privileged database/provider audit logs are needed to identify the operator. Client roles and `service_role` cannot update the controls through the granted table privileges.

**Scope and failure modes:** this blocks future owner checks using `is_business_owner()`, including direct owner RLS/RPC calls, and hides suspended membership from the application's owner lookup. It does not sign a user out, stop employee self-service, stop public intake or queue workers, revoke service-role/administrator access, cancel in-flight requests or recall already accessed data. Transactions with an earlier snapshot may finish with prior permissions. If a service key is compromised, disable the affected services and rotate it using the provider's documented process. Treat privileged database access as a separate high-trust boundary. Test on real Supabase and with concurrent requests before relying on it.

### Referral revocation

Active test employees can list their most recent invitations (at most 100, active first) and revoke their own active, unused links. No applicant name, contact information, code hash or application contents are returned. Revocation and submission use the same invitation row lock: whichever commits first wins; an already-submitted application is not undone. Repeat revocation, expired, used, foreign or unavailable links return a generic failure. Identical already-submitted request retries retain the existing idempotency behavior. A link remains a transferable bearer secret until use, expiry or revocation. Real concurrent Postgres and authenticated browser tests are still required.

### Assistant quotas

Settings writes and assistant admission now take the same transaction-scoped advisory lock, with admission locking before it reads the limits. This avoids admitting a request using stale limits after a completed settings reduction under the usual Postgres read-committed isolation. The change is locally tested, not yet tested with concurrent sessions on real Postgres. Request quotas are not a monetary spend cap; configure provider billing limits and monitoring separately.

## Verification and decision record

For the current local changes: local PGlite tests cover direct owner RLS/RPC denial and referral revocation, ownership, expiry, deactivation and retry. Local PGlite cannot prove real PostgREST behavior or concurrent transactions. Browser tests exercise existing mocked flows, not the new authenticated referral-management screen. Live Supabase, authentication, mail delivery, Turnstile, scheduler, two-device workflow, and real-provider AI have not been tested. Automated accessibility checks are limited, not certification.

Alternatives scored qualitatively (correctness / efficiency / maintainability / security / minimality, 1–5; security is a hard constraint): database authorization stop plus individual suspension **4/4/4/5/3**, versus hiding owner UI only **1/5/4/1/5**; transactional row-locked referral revocation **4/4/4/5/3**, versus deleting the attribution after submission **1/4/2/1/3**. Database lookup of the singleton and owner uses indexed keys, and revocation uses an indexed primary-key lookup (typically O(log n)); the bounded invitation list returns at most 100 rows, while actual scan and concurrency costs need live measurement. Quota count cost depends on the indexed run history and contention; no production benchmark has been performed.
