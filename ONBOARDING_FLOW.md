# Onboarding flow — exactly what you do, in order

Two different flows share the word "onboarding". Know which one you're in before you
start the demo.

## A. Demo walkthrough (browser-memory, example data)

This is what the demo audience sees at `/`, and it is **example-only** — no database
write, no employee account, no message, no verification.

1. **Hiring** (top nav → Hiring): the list shows example applicants.
   - **Add example applicant** (the "+ Add example applicant" button) — fills in a
     fictional name, area, shifts, transportation, languages, optionally a fictional
     referrer. Nothing is sent; it's a browser-local example.
   - Select an example applicant card to review their details.
   - Toggle **School** / **Hospital** clearances if you want to show that gate.
     These are *eligibility notes*, not verified authorizations — a hospital requires
     the health track, and the app says so.
2. **Hire** — the green "Hire" button sets the applicant to Hired **in your browser
   only**. You land in the onboarding preparation panel:
   - **Review employment documents** — a browser-only checkbox.
   - **Plan initial training** — a browser-only checkbox (the button below it opens the Academy).
   - **Plan first shift** — a browser-only checkbox.
   - The panel also links to Training Academy and notes the honest disclosure:
     *"Session-only example notes. No account, training assignment or real shift has been created."*
   - Everything disappears on refresh. No employee account is created, no assignment
     is made, no eligibility or compliance document is produced or verified.
3. **Training academy:** open any lesson, read the text, mark **Viewed**.
   "Viewed" is not a completion — it's a checkbox meaning the sample text was read.
   It never verifies training, issues a certificate, or signs anyone in.

Copy for the room: *"These are browser-only example notes. Nothing is saved remotely.
The real onboarding flow — hiring, tasks, documents, and training tracking — is
disabled in this build and must not be operated as a live workflow."*

## B. Real onboarding (database RPCs — not live in this deployment)

This is the actual feature path, for when owner access is authorized and the
deployment is configured. **It is not enabled today.**

1. **Owner inbox** (`/owner`, gated by owner development-login — disabled by default):
   - Find the applicant row in your list.
   - **Hire & start onboarding** — calls `start_employee_onboarding($applicant_id)`.
2. **What the RPC does, atomically (fails closed on any error):**
   - Checks you are the franchise owner (fail closed if access was emergency-stopped).
   - Locks and validates the applicant (status must not be passed/missing).
   - Creates one `employee_onboarding` row (with the current franchise) — returns
     "created", "existing" on retry, or honest failures (not_found, ineligible).
   - Creates the three tasks: `review_documents`, `plan_training`, `plan_first_shift`.
   - Updates the applicant to `hired` (status transitions via `set_applicant_status`
     are blocked for hired applicants).
   - Writes an `audit_log` row.
   - Nothing email-like or account-creating happens. No employee account is created —
     that is intentionally NOT part of onboarding (see `onboarding-database.test.mjs`).
3. **Onboarding tasks** — in `/owner`'s onboarding panel each task is a one-click
   "Mark noted" / "Undo note" toggle calling `record_onboarding_task(...)`. Each
   toggle writes an audit row. Undoing the note resets the task to pending.
4. **Status lifecycle**: New → Later / Screening / Passed / Hired. Only an owner can
   move an applicant out of `hired`/`passed` states (all changes via RPCs, never raw).

## What NOT to do

- Don't demo `/owner` as if it were live. Owner sign-in is not configured and is
  deliberately fail-closed.
- Don't enter real applicant names, phone numbers, addresses, or any personal data
  in the browser-memory workspace — it is a demo, and resetting it clears nothing
  and leaks nothing back into history beyond the page memory.
- Don't present the Training Academy "Viewed" checkbox as a real training record.
- Don't describe the walkthrough as synchronized across devices — it isn't.
  Two phones will show different examples, and nothing synchronizes.
- Don't describe the yellow "This is not a real training completion" notice as
  optional — it is the honest disclosure, keep it visible during the demo.
