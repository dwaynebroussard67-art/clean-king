# Andy’s assistant meeting · synthetic data only

**Go/no-go:** Show the public helper even without credentials. Show the owner tier only in an isolated, approved test project. If the banner is missing on the hosted demo, the project is uncertain, or any record might be real, stop. Do not paste production data, keys or a real applicant’s question into chat.

## Before the meeting

- [ ] Integrate all five slices together. With Node 22, run `npm ci`, `npm test`, `npm run build`, `npm run test:production`, `npx playwright install chromium`, `npm run test:e2e` and `npm audit --audit-level=moderate`. Use a clean environment with demo flags unset for the production fail-closed check. Browser mocks and local database tests are not a live rehearsal.
- [ ] Choose a dedicated **test** Supabase project. Apply **all** repository migrations in timestamp order, including `20261118000000_assistant_settings.sql`. Start empty or use only approved synthetic records. Never point demo login at the business database: it opens the owner inbox too, not just the assistant.
- [ ] Create the approved **test** user in Supabase Auth with a mailbox controlled by the presenter. Disable open signup as appropriate. Using admin SQL in that project only, replace the placeholder below with that Auth user’s actual UUID. Do not grant general membership-write access. The assistant uses the owner session, **not** a service-role key.

  ```sql
  insert into public.owner_memberships (user_id)
  values ('<TEST_AUTH_USER_UUID>'::uuid)
  on conflict (user_id) do nothing;
  ```

- [ ] Choose the exact HTTPS origin of the presenting deployment (no path or trailing slash). Set `APP_ORIGIN`, register its `/owner/auth/callback` with Supabase Auth, and restrict redirect URLs. The reverse proxy must preserve the canonical Host, and the app must be able to reach its **own canonical origin**: the owner page reads the guarded settings API server-side with the visitor’s cookies, JSON content type and exact Origin. Do not forward session cookies to a different host or relax the API guard to make a preview work.
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the **same test project**. For a hosted demo set `DEMO_MODE=true`, `DEMO_MODE_ACK=I_UNDERSTAND_SYNTHETIC_DATA_ONLY`, and `OWNER_ASSISTANT_ENABLED=true`. For local development the existing development login gate is a separate option; it does not turn on the demo banner. Keep `INTAKE_ENABLED`, `REFERRALS_ENABLED`, `APPLICATION_EMAIL_NOTIFICATIONS_ENABLED` and `AI_ALLOW_LOCAL_CUSTOM` **false**. Do not provision a scheduler, service-role key or notification credentials for this assistant rehearsal. Auth sign-in email is distinct from application notifications.
- [ ] Generate `ASSISTANT_SECRET_KEY` with `openssl rand -base64 32` in a trusted terminal. Store it in server secret management, stable across deploys. Never show it on screen, send it in chat, add `NEXT_PUBLIC_` or commit it. Changing it without a re-encryption procedure makes saved keys unreadable. `ANTHROPIC_API_KEY` is an optional server fallback; a stored Anthropic key wins. Custom has no environment fallback.
- [ ] On the **presenting device/browser**, sign in through `/owner/login` before the meeting. Open the email link in that browser. Verify the persistent **DEMO · synthetic data only** warning on both `/owner` and `/owner/assistant`.
- [ ] In **Assistant settings**, use synthetic display names. Choose the permitted counts and the intended provider. Verify the model ID is available to this account rather than assuming the default is entitled. For Custom, enter its HTTPS API base (including `/v1` if required), **not** a full `/chat/completions` endpoint. Use a provider you trust with the synthetic conversation. Leave fallback off unless both providers are approved. Set a small quota and provider-side billing limit; limits in the panel are not a dollar cap.
- [ ] Enable the master switch, **Save settings**, then privately enter the test provider key via **Save key**. It should clear from the input and show only a masked ending. Press **Test connection** once. Confirm provider/model and latency; a test consumes one workspace run. Ask one synthetic question. If using speech, preview it on the actual device, and rehearse **Mute replies** and **Stop voice**. Leave speech off in shared spaces unless wanted.
- [ ] Budget the rehearsal: defaults are 3 attempts/minute and 100 per UTC month, shared across owners; failures after admission count. Allow a minute between rehearsing the limit and presenting. Do not raise limits just to conceal a failure.

## Five-minute walkthrough

| Show | What to say |
| --- | --- |
| `/` → Assistant, enter `12*(3+4)`; switch to Español. Expand Quick answers below `/apply` or `/quote`. | “84. This helper follows rules in your browser. It does not call AI or see any inbox data.” Use the Network tab to confirm no helper/provider request on submit. The public workspace’s other records and coverage actions are fictional. |
| Public helper: `hours for 5000 sq ft with 2 cleaners`. | “2.5 hours **using an example rate**, not a price or promise. We need your real productivity assumptions.” |
| `/owner/assistant` → Ask about the number of new requests. | “This is a real provider call using enabled aggregate counts from the test project. Zero is a valid count. No names, documents or individual records are pulled into the snapshot.” Questions, recent chat excerpts and persona aliases can be sent: keep them synthetic. |
| Inspect the provider/model credit and the settings. Turn off a count group, save and ask again. | “You control the facts available on each new run. Saving a different count group or provider clears the conversation on this page; reload any other open session. The assistant cannot act on the inbox.” Don’t present a model reply as proof of an action. |
| Switch languages and show voice, if supported. | “Speech uses the device/browser’s available voices. Muting changes playback, not provider access.” |

## Expected failures (don’t improvise a workaround)

| Symptom | Presenter response / next step |
| --- | --- |
| Sign-in unavailable, session expired, or access not approved | “This is owner-only.” Check the exact origin, two opt-ins, callback, correct project and approved user’s membership. Reauthenticate on the presenting device. Never grant public access. |
| Assistant not configured / switched off | “The service and the owner switch both default off.” Check the server gate first, then the panel switch and **Save settings**. The public helper still works. |
| Key editing disabled / provider not set / rejected key or URL | “A configured provider is required.” Check server encryption readiness, account entitlement, allowed HTTPS base, saved key and model. Don’t screen-share a key or weaken URL safeguards. A masked status describes DB storage, not whether an environment fallback exists. |
| Provider unavailable, slow or returns an unusable answer | A connection test may report a provider error without exposing its response body. Check model access, provider status and provider billing off-screen. Only an explicitly configured fallback may be tried. Show the public tier rather than inventing an answer. |
| Workspace limit reached (429) | “The test and chat share a workspace budget.” Wait for the minute window, or end the AI demo if the monthly budget is exhausted. No automatic retry loop. |
| Concurrent save (409) / invalid setting (422) | Don’t overwrite the other editor. Note your intended changes, choose **Reload latest** (clears this chat and draft), then reapply. For validation, correct the marked field and save again. |
| Request rejected / too large | Use the canonical origin; shorten the question. Do not disable the origin or size checks. |

**Verify on the test deployment:** save and reload settings, set/clear a test key, run Test connection, ask a question, deliberately reach a small limit, then sign out. With all configuration gates still on, a valid same-origin JSON request to **each** assistant endpoint with no session must return `401 {"error":"sign_in"}`; invalid headers or a disabled deployment fail earlier. Check the GET using a trusted HTTP client with the required Origin and Content-Type (a browser address-bar navigation is not that request). Verify an authenticated non-owner gets 403. Use synthetic requests only; don’t save prompts, headers or keys in logs. Re-sign-in before presenting.

## Decisions to record — placeholders, not commitments

- **PLACEHOLDER — Andy:** business name/branding and approved public FAQ wording, hours and service territory.
- **PLACEHOLDER — Andy:** productivity rates, what influences them, and pricing/quote policy. The example weekly cap is not payroll or employment guidance.
- **PLACEHOLDER — Andy:** preferred persona/display names, languages/voice, provider and budget, and who may change settings or keys.
- **PLACEHOLDER — Andy:** verified notification mailbox, privacy/retention/deletion wording and provider terms. Do not enter a guessed address. There is no assistant email, calendar or hiring integration.

**Afterward:** while still signed in, remove saved test provider keys, turn off the master switch and save. Sign out, disable the server/demo gates, remove any environment fallback, and revoke test credentials as appropriate. Preserve or delete synthetic records only under the approved test-project policy. Email links are not passkeys or approved-device protection; this demo is not approval to handle real data.
