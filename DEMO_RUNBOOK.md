# Owner assistant rehearsal · synthetic data only

**Choose the right demo.** The public workspace at `/` is a fictional, browser-only walkthrough. Its suggested assistant question is scripted; its settings do not configure AI. Follow [the meeting walkthrough](MEETING_WALKTHROUGH.md) for that presentation. The public calculator is retired; an applicant Concierge awaits approved content.

`/owner/assistant` is different: it can make **real, billable provider calls**. Use it only in a controlled development/test environment with a dedicated, approved test project and fictional records. Production email-link login and the owner assistant remain unavailable. There is no hosted-demo login exception. If the project, audience or data is uncertain, show the public walkthrough instead.

## Before presenting the owner tier

1. **Verify the code.** On Node 22, run `npm ci`, `npm test`, `npm run build`, `npm run test:production`, `npm run test:e2e` (install Playwright Chromium first) and `npm audit --audit-level=moderate`. Mocked browser tests verify the interface, not live authentication, billing or delivery.
2. **Prepare the isolated project.** Apply all migrations in filename order to the approved test project only. Create the test user in Supabase Auth. In an admin-only SQL session, provision its membership using the actual test UUID, not a personal address or a guessed identifier:

   ```sql
   insert into public.owner_memberships (user_id)
   values ('<TEST_AUTH_USER_UUID>'::uuid)
   on conflict (user_id) do nothing;
   ```

   Verify that the account is active and owner access is permitted. If the global emergency stop or an individual suspension is in effect, stop; do not override it for the meeting. See [the operator runbook](LAUNCH_READINESS.md). Use empty tables or synthetic records only.
3. **Configure only what is needed.** Use the test project URL and publishable key, an exact `APP_ORIGIN` (HTTPS or `http://localhost:3000` for local development), and the matching `/owner/auth/callback` redirect. In development/test, enable `OWNER_EMAIL_LINK_ENABLED=true` and `OWNER_ASSISTANT_ENABLED=true`. Leave public intake, referrals and application-email delivery off. No scheduler or service-role key is required for the owner chat. Never put provider or encryption keys in `NEXT_PUBLIC_` variables.
4. **Set up encryption and provider access.** Generate a stable `ASSISTANT_SECRET_KEY` with `openssl rand -base64 32` in a trusted terminal; keep it in server secret management. Do not show or log it. A rotated encryption key requires re-entering the provider keys. Only Anthropic has an optional `ANTHROPIC_API_KEY` server fallback if no DB key is saved. Set provider-side billing controls; request quotas are not a monetary cap.
5. **Sign in on the presenting device beforehand.** Open the sign-in email on that device. Go to `/owner/assistant/settings`. Use fictional display names, choose the allowed count groups, verify the provider/model is available to the test account, and save. For Custom, use an approved public HTTPS API base, not the full chat-completions endpoint. Enable fallback only if both providers may receive the synthetic conversation. Enter the test key privately. Its saved status shows a mask, not the key.
6. **Rehearse one question.** Enable the saved master switch. From `/owner/assistant`, ask “How many new quote requests are there?” This uses the actual guarded chat API and consumes a workspace run; there is no separate connection-test button in the current settings flow. Confirm the provider/model credit. Try Español. If spoken replies are enabled, check Mute and Stop on the presenting device. Some device voices use an online speech service.

## What the presenter can promise

- Only enabled aggregate counts are retrieved, not individual names or documents. The question, excerpts of up to six recent messages, display names and the enabled snapshot can reach the selected provider. Do **not** type private details or credentials.
- There are no tools or assistant actions: it cannot send messages, change hiring decisions or schedule work. Zero is a valid count; an answer can be wrong.
- The displayed chat is page-local. Reload for a clean conversation after changing provider/visibility, or before presenting to a different audience. A reload does not undo earlier provider requests or reset quotas.

## Expected failures

| What happens | What to do |
| --- | --- |
| No sign-in, session ended or access denied | Confirm development/test configuration, canonical origin, presenting browser, approved active membership and operator access state. Reauthenticate if appropriate. Never weaken production gates. |
| Assistant off or unconfigured | Both the server gate and saved switch must permit chat. Verify encryption readiness, key status and actual model entitlement privately. |
| Invalid setting or concurrent save | Correct the field, or reload the current settings and reapply the intended change. Do not overwrite another editor's changes. |
| Provider missing, unavailable or timed out | Check the saved provider, base, model and billing. No real records or extra keys are needed to demonstrate the public walkthrough. Do not fabricate an AI reply. |
| 429 workspace limit | Wait for the minute window; stop if the monthly budget is exhausted. Admitted failures count too. Rehearse deliberate limits **before** the meeting. |
| Request rejected or too large | Use the approved origin or shorten the question. Do not disable the server guard. |

**After the rehearsal:** while signed in, remove saved test keys and disable the saved switch. Sign out; disable server flags, remove optional environment fallbacks and revoke test credentials as appropriate. Verify the protected page/API do not return private data after sign-out. Do not apply changes to a live project as part of a demonstration.

**PLACEHOLDERS — owner approval required:** Concierge/FAQ wording, business name, service area, real productivity assumptions and pricing, notification mailbox, preferred persona and voices, provider/budget, settings permissions, privacy and retention. No example is an approved rate or policy.
