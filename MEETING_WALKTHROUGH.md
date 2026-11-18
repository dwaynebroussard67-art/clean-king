# Meeting walkthrough

Use the live workspace preview and a phone or laptop. The banner identifies the records as examples: use fictional names and do not enter actual applicant, customer, medical, building-security or other personal information. Example changes exist only in the current page's memory and disappear on refresh; they do not synchronize to a second phone.

## Suggested walkthrough

1. **Today:** show the business overview, images, attention items and navigation. Figures and activity are examples, not real business metrics.
2. **Hiring:** open Hiring, choose **Add example applicant**, enter a fictional name and town, and optionally enter a fictional referrer. Review or edit the example and add it to the workspace. This is self-reported example information, not a verified referral invitation or a real application.
3. Select the example applicant and choose **Hire**. Explore the onboarding preparation checkboxes and the link to the academy. These are browser-only notes; no employee account, message, eligibility verification or assignment is created.
4. **Training academy:** open a lesson, read the sample text and mark it viewed. This is not a real training completion, certificate, video or qualification.
5. **Coverage board:** run the school or hospital example. The result is a suggested eligible backup—not a sent offer, worker acceptance or scheduled shift.
6. **Assistant:** ask the suggested question. The scripted response uses the current example counts, viewed lesson count and coverage suggestion; it is not a connected AI and cannot act or access private records.
7. **Services:** open a service to see potential scope, then build an example plan. It is not a quote, price, contract or sent request. Actual service scope and pricing need owner approval.
8. **Site maps & directions:** select areas on the fictional layout. Real plans and directions remain coming soon and need site approval and access controls.
9. **Language:** use the language control in the header to switch between English and Spanish.

## What's real and what still needs setup

The site interactions above are real browser interactions, but their records and outcomes are examples. Public application and quote intake, owner sign-in, actual referral invitations, employee accounts, notifications, verified training and scheduling are not live. No email or text is sent from the walkthrough. Optional video introductions remain unimplemented. The local source also contains disabled persistent intake and onboarding foundations, described in `PRODUCTION_READINESS_PROGRESS.md`; those are not connected to this walkthrough and must not be represented as an active business workflow.

**Next decisions:** identify and authorize a dedicated Supabase staging project; supply Andy's notification email and approve sender/provider setup; agree on service offerings, privacy/retention, security and employee onboarding. Test using separate real sessions and synthetic data before going live.

## Design choice and limits

A browser-memory walkthrough was chosen over enabling an unapproved live database or pretending submissions were delivered. Both are easy to present; local state is safer and requires no provider setup, but does not persist or work across devices. In-memory applicant updates and counts are O(n) in the small example list; lesson and quote-plan updates are O(1) for fixed choices. User-provided strings are rendered as text and not sent to an API. The workspace is not authenticated, so it must not hold real data. Refresh clears changes; there is no audit trail, recovery, or multiuser coordination.
