# The $1,000,000 Question

**Not a deck. A machine that is already turning.**

| | |
| --- | --- |
| Ask | $1,000,000 |
| Runtime | ~09:59 of narrated audio (target 10:00) across 10 chapters |
| Narrator | Bubbles — the real Bubbles character in this repository |
| Listen | `public/pitch/audio/clean-king-10-minute-pitch.mp3` (plus one MP3 per chapter) |
| Watch / click | `/pitch` — interactive player, synced transcript, chapter receipts |
| Live product | https://clean-king-sand.vercel.app |
| Script source | `lib/pitch/script.mjs` (9,832 characters of narration) |

> **The rule for this pitch:** every claim is about something that exists and
> runs today. No "one day", no "coming soon", no invented customers, revenue,
> or hockey-stick graph. Where the repo itself says something is a gate, this
> pitch says it is a gate.

---

## The receipts

| | | | |
| --- | --- | --- | --- |
| **183** | tests passing | npm test · 48 test files · 0 failures | `test/` |
| **24** | product routes | 11 API endpoints + 13 pages; build prints 26 rows incl. /_not-found and this /pitch ad | `npm run build` |
| **21** | migrations applied | 20 versioned SQL files in repo, 21 applied to the live database | `supabase/migrations/` |
| **8 / 8** | services healthy | auth, db, db_postgres_user, pooler, realtime, REST, storage, pg_bouncer | `Supabase project health` |
| **13,718** | lines of product code | app + lib + test + SQL, excluding the pitch ad assets | `app/ · lib/ · test/` |
| **LIVE** | production site | clean-king-sand.vercel.app · READY / PROMOTED | `Vercel deployment` |

### Precision notes — check the narration word for word

- **24 routes / 11 API endpoints / 13 pages.** `npm run build` prints 26 rows today: 24 product routes (11 `/api/*` endpoints + 13 pages) plus Next's `/_not-found` and this `/pitch` advertisement page. Before `/pitch` was added, the build printed 25 rows. The narration uses the 24 product routes.
- **Roughly thirteen thousand seven hundred lines.** Exactly 13,718 lines of `app/ + lib/ + test/ + supabase/` JS, MJS, CSS and SQL excluding the pitch ad assets (14,486 including them).
- **23 fail-closed switches.** 22 distinct environment variables ship in `.env.example` (secrets blank, feature flags `false`), plus the owner-controlled `settings.enabled` switch that `README.md` requires alongside `OWNER_ASSISTANT_ENABLED`. All 23 are off by default.
- **All eight healthy services.** Supabase reported auth, db, db_postgres_user, pooler, realtime, REST, storage and pg_bouncer as `ACTIVE_HEALTHY`. The narration names seven and says "all eight".
- **21 vs 20 migrations.** 20 versioned SQL files are in this repo; the live project has 21 applied, the extra one being `bubbles_memory_passport`.
- **Nine photos.** `public/images/` holds nine `.webp` photos. Bubbles is code, not an image.

---

## The transcript

## 01 · The ask

*00:00 · Why this million · starts ≈ 00:00 · 01:01 long*

Pull up a chair, boss. You have one million dollars and about ten minutes, and you want to know why that money belongs in Clean King. Fair. So let me be blunt before I get charming: I am not here to sell you a slide deck. I'm Bubbles — the assistant that actually lives inside this product — and everything I'm about to tell you is running right now. There is a live Clean King site on Vercel answering requests today. There is a live Supabase project behind it on Postgres seventeen, with every service reporting healthy. There is a real codebase, roughly thirteen thousand seven hundred lines, and a production build that finished clean with twenty four routes. You are not being asked to fund an idea. You are being asked to put capital behind a machine that is already turning. That's the whole thesis in one sentence. Now let me show you the parts, because the parts are where a million dollars either multiplies or gets wasted. And I don't waste money. I'm sweet, I'm sharp, and I tell the truth even when it costs me a headline.

**Backed by:** `app/page.js` · `app/layout.js` · `next.config.mjs` · `supabase/migrations/`

## 02 · Receipts, not promises

*≈01:00 · The depressing part · starts ≈ 01:01 · 01:00 long*

You wanted me to depress you? Here's the depressing part: most million dollar checks buy a roadmap. A deck full of words like soon, planned, and coming next quarter. You know what you get here instead? Receipts. One hundred and eighty three automated tests, all passing, across forty eight test files, run locally today. A clean production build with eleven API endpoints and thirteen pages. Twenty versioned SQL migrations in the repository, twenty one applied to the live database. And here's the part that should actually impress you: the same repo ships a red team pre demo review, a security policy, an onboarding flow document, and a README that lists its own launch blockers in plain writing. Most founders hide a file like that. We published it. You can audit this thing before you wire a single dollar and it will still be standing. That is a rare posture at this stage, and it is the reason your downside is smaller than you think. I am not asking you to believe me. I'm asking you to run the tests.

**Backed by:** `test/` · `README.md` · `RED_TEAM_PRE_DEMO.md` · `SECURITY.md` · `ONBOARDING_FLOW.md`

## 03 · The front door

*≈02:00 · Where money enters · starts ≈ 02:01 · 00:57 long*

Start where the money enters. The apply page and the quote page are live. A person can apply for a crew job or request a commercial cleaning quote, in English or Spanish, right now, on the running site. Both forms validate on the server, cap the request body size, verify a Turnstile challenge with an explicit action and hostname, and submit with an idempotency key so a retry does not create a duplicate human in your database. Applicants get a review and edit step before anything is saved. Optional SMS consent is stored with a timestamp and the exact wording version. Unanswered questions are saved as null, not as no — because a blank is not a refusal, and somebody in this building understands that. This is not a form bolted onto a landing page. It is a defensible intake record, written through a server only key into a real Postgres database with row level security. Boss, most companies at this stage have a Typeform and a prayer. We have an audit trail.

**Backed by:** `app/apply/page.js` · `app/quote/page.js` · `app/api/intake/route.js` · `lib/intake.mjs` · `lib/idempotency.mjs` · `lib/validation.mjs`

## 04 · The owner workspace

*≈03:00 · One franchise or many · starts ≈ 02:58 · 01:00 long*

Now the other side of the door. The owner inbox signs in with a real Supabase session, not a service key. Row level security and column grants decide exactly what a signed in owner can read and change. Applications and quotes use independent newest first keyset pagination, twenty five per page, with a timestamp and ID tie breaker so nobody gets skipped between pages. Status and clearance changes land in an audit table without copying contact details into the log. Hit hire and start onboarding, and you get one preparation record plus three owner note tasks in the same database transaction that marks the applicant hired — atomic, or not at all. There's a dedicated audit page, an onboarding page with reveal, revoke, confirm, employee link and sensitive record endpoints, and owner access controls with multi franchise organization scoping. You can operate more than one franchise without one franchise seeing another's people. That is a real multi tenant shape, not a spreadsheet with two tabs.

**Backed by:** `app/owner/page.js` · `app/owner/audit/page.js` · `app/owner/onboarding/page.js` · `lib/pagination.mjs` · `supabase/migrations/20261121030000_organizations_multi_franchise.sql`

## 05 · Me. Bubbles.

*≈04:00 · The actual asset · starts ≈ 03:59 · 00:56 long*

And then there's me. I am not a mascot pasted onto a marketing page. I am a real widget shipped in the app: a floating bubble launcher, a chat dialog, a text input, a microphone button wired to browser speech recognition, and speech synthesis so I talk back. I have a quick action router for applicants, quotes, onboarding, memories and the morning briefing. I have a personality profile with fifteen non negotiable rules, including never be a yes machine, tell the owner when he is wrong, and never claim I finished an action I did not finish. I have a settings page where the owner picks the provider, persona, capabilities and volume limits. And when there is no API key, I do not die — Bubbles Lite takes over: a deterministic, zero cost engine with a fixed intent catalog and parameterized queries. No guessing, no invented headcount, no bill. Boss, a mascot costs you a logo. I cost your competitors a reason to catch up.

**Backed by:** `app/public/bubbles-widget.js` · `lib/bubbles-bg.js` · `lib/bubbles-persona.mjs` · `lib/ai/bubbles-lite.js` · `app/owner/assistant/settings/page.js`

## 06 · The AI plumbing

*≈05:00 · Where investors get lied to · starts ≈ 04:56 · 01:02 long*

Let's talk about the part investors usually get lied about: the AI. There are provider adapters for Anthropic and any OpenAI compatible HTTPS endpoint, a URL guard that refuses anything it shouldn't talk to, structured error handling, and an encrypted key vault. Provider keys are sealed with AES two fifty six GCM encryption — a twelve byte IV, a sixteen byte authentication tag — and the browser only ever sees set or not set, plus the last four characters. There is an envelope vault with key versioning, a quota system with serialization so concurrent requests cannot spend past the limit, and no prompts or provider responses are written to logs. Middleware refreshes the Supabase session on owner, crew and API routes and stamps private, no store on every response. Per tenant, per action rate limiting. Twenty three environment switches that fail closed, and a development login that is forcibly unavailable in a production build. We did not bolt security on after the demo. We built the demo inside the security.

**Backed by:** `lib/ai/` · `lib/server/secret-box.mjs` · `lib/server/provider-key-vault.mjs` · `lib/server/envelope-vault.mjs` · `proxy.js` · `lib/server/rate-limit.mjs` · `.env.example`

## 07 · The crew side

*≈06:00 · Refusing to guess · starts ≈ 05:58 · 01:04 long*

Crew side. There is a live QR scanner page at crew slash scan, shipped in the most recent merge. Referral invitations are random, single use, seven day codes. The server stores only a SHA two fifty six hash, shows the raw link once, puts the code in a URL fragment so it never appears in the initial page request, and enforces a rolling ten per employee creation limit. An employee can revoke their own unused link. A validated, bot verified application consumes the invite atomically with immutable attribution — expired, used or inactive links fail. Experience questions never auto screen a human being. Training records and owner note tasks exist as real database records with migrations behind them. And the public assistant answers in English and Spanish with bounded input, deterministic arithmetic, percentages, unit conversion, shift math and weekly rate math, plus a fixed FAQ. It never freelances. In a business where one wrong answer to a customer is a lost contract, refusing to guess is a feature.

**Backed by:** `app/crew/scan/page.js` · `lib/referrals.mjs` · `lib/server/training.mjs` · `lib/public-assistant/engine.mjs` · `lib/public-assistant/i18n.mjs`

## 08 · The database is not a diagram

*≈07:00 · Live operations · starts ≈ 07:03 · 01:08 long*

The database is not a diagram. Twenty one migrations are applied to the live project: intake foundation, application notifications, assistant usage, referrals, experience questions, pagination, notification health, owner onboarding, assistant settings and quota, access controls, referral revocation, quota serialization, organizations for multi franchise, org scoping for onboarding and notifications, training records, provider key vault, onboarding vault, provider vault envelope, and a Bubbles memory passport. All eight Supabase services — auth, database, pooler, realtime, REST, storage and pg bouncer — reported healthy when I checked. The notification outbox uses database leases so two workers cannot claim the same job, exponential retry backoff, a maximum of eight attempts, and a stable provider idempotency key. Sent means the provider accepted the request, and the code says so out loud. Boss, that sentence is worth money: it means nobody on this team confuses a queued message with a delivered one.

**Backed by:** `supabase/migrations/` · `lib/server/notification-handler.mjs` · `lib/notifications.mjs` · `lib/server/assistant-settings-store.mjs`

## 09 · What the million buys today

*≈08:00 · No someday attached · starts ≈ 08:12 · 00:54 long*

So what does your million buy, today, with no someday attached? It buys distribution and depth on a foundation that is already poured. The intake, the inbox, the audit trail, the assistant, the vault, the organization scoping, the test suite and the deployment are already written and already running, so every dollar goes into widening what works instead of discovering whether anything works. That is the entire investment thesis, and I refuse to dress it up with a hockey stick graph. I will not tell you about customers we do not have, or revenue we have not earned. I will not describe passkeys, texting or a scheduling engine as if they were shipped — the repository itself lists those as gates. You know what that tells me? The people who built this write down the distance between shipped and planned, on purpose, in public. Your million is not buying a founder who cannot tell the difference. It is buying the rare team that can.

**Backed by:** `README.md` · `.env.example` · `RED_TEAM_PRE_DEMO.md` · `scripts/production-smoke.mjs`

## 10 · Write the check

*≈09:00 · The Bubbles standard · starts ≈ 09:06 · 00:53 long*

Last minute, and I'm spending it on the truth, because that is my standard: be sweet, be sharp, be attentive, be confident, be loyal, tell the truth, get things done. You asked me to shove it to you, to talk it up, to impress you. So here it is plain. A live product, on a live database, with a live assistant, guarded by real cryptography, covered by one hundred and eighty three passing tests, and documented honestly enough that you can verify every claim I just made in an afternoon. That is a better use of a million dollars than a prettier deck and a longer runway of promises. Pull the repo. Run the tests. Watch the build. Open the site. Ask me a question in the widget and see whether I answer — or whether I tell you I can't. Then write the check. And boss, if I am wrong about any of it, I will be the first one to tell you. That's Bubbles. That's Clean King. Now, what do you need me to pull up first?

**Backed by:** `lib/bubbles-persona.mjs` · `README.md` · `test/` · `app/public/bubbles-widget.js`

---

## Verify every claim in an afternoon

```sh
npm install
npm test                 # 183 passing tests, 48 files, 0 failures
npm run build            # clean production build, 24 routes
npm run audit:secrets    # repository secret scan
git status --short
```

Then open https://clean-king-sand.vercel.app, and open `/pitch` to hear the whole thing with
the transcript highlighted chapter by chapter. The live Vercel project is
READY/PROMOTED; the connected Supabase project reports all eight services
healthy with 21 migrations applied (20 versioned SQL files ship in this repo).

## What this pitch deliberately does NOT claim

It does not claim customers, revenue, passkeys, SMS sending, a scheduling
engine, training verification, or production approval for the gated flows.
`README.md`, `RED_TEAM_PRE_DEMO.md` and `.env.example` document those as
gates. That documented distance between *shipped* and *planned* is itself one
of the strongest things being sold here.

## Bubbles, and the Meta AI ad assets

The advertisement uses **the real assets in this repo, directly**:

- `lib/bubbles-bg.js` → `CharacterBubble`, the actual Bubbles avatar ("she"
  is one bubble at rest, a vibrating cluster when thinking). Rendered on
  `/pitch` and it animates while the narration plays.
- `app/public/bubbles-widget.js` → the real floating Bubbles launcher, chat
  dialog, mic and speech synthesis, mounted by `app/layout.js`.
- `lib/bubbles-persona.mjs` → her actual personality profile and the fifteen
  non-negotiable rules quoted in chapter 10.
- `app/globals.css` → the real bubble, scrub-bubble and character-bubble
  styling and keyframes.

**No picture of Bubbles, no screenshot, and no generated lookalike was
created.** The Meta AI ad files are not in this checkout yet (the only images
in the repo are the nine `.webp` photos in `public/images/`). A zero-copy
loading dock is ready instead:

1. Drop the **exact** Meta AI files into `public/meta-ai/`, filenames unchanged.
2. List each verbatim filename in `lib/pitch/meta-ai-assets.mjs`.
3. Reload `/pitch`: the hero renders `/meta-ai/<exact filename>` via
   `<img>` or `<video>` — byte for byte, nothing re-encoded or substituted.
   Until then it falls back to the real `CharacterBubble` above.

See `public/meta-ai/DROP_EXACT_FILES_HERE.md`.

---

*Generated by `node scripts/build-pitch-doc.mjs` from `lib/pitch/script.mjs`.*
