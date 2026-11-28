/**
 * Generates INVESTOR_PITCH.md (and its browser-served copy) from the same
 * chapter data that drives /pitch and the spoken narration. One source of truth.
 * Run: node scripts/build-pitch-doc.mjs
 */
import { writeFileSync } from 'node:fs';
import { CHAPTERS, PITCH_META, FACTS, TOTAL_CHARS } from '../lib/pitch/script.mjs';
import durations from '../app/pitch/durations.json' with { type: 'json' };

const total = durations.reduce((a, b) => a + b, 0);
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const factRows = FACTS.map((f) => `| **${f.value}** | ${f.label} | ${f.detail} | \`${f.receipt}\` |`).join('\n');

const chapters = CHAPTERS.map((c, i) => {
  const start = durations.slice(0, i).reduce((a, b) => a + b, 0);
  return [
    `## ${String(c.n).padStart(2, '0')} · ${c.title}`,
    '',
    `*${c.kicker} · starts ≈ ${mmss(start)} · ${mmss(durations[i])} long*`,
    '',
    c.text,
    '',
    '**Backed by:** ' + c.receipts.map((r) => `\`${r}\``).join(' · '),
    '',
  ].join('\n');
}).join('\n');

const doc = `# ${PITCH_META.title}

**${PITCH_META.tagline}**

| | |
| --- | --- |
| Ask | ${PITCH_META.investment} |
| Runtime | ~${mmss(total)} of narrated audio (target ${PITCH_META.runtimeTarget}) across ${CHAPTERS.length} chapters |
| Narrator | ${PITCH_META.narrator} — the real Bubbles character in this repository |
| Listen | \`public/pitch/audio/clean-king-10-minute-pitch.mp3\` (plus one MP3 per chapter) |
| Watch / click | \`/pitch\` — interactive player, synced transcript, chapter receipts |
| Live product | ${PITCH_META.site} |
| Script source | \`lib/pitch/script.mjs\` (${TOTAL_CHARS.toLocaleString('en-US')} characters of narration) |

> **The rule for this pitch:** every claim is about something that exists and
> runs today. No "one day", no "coming soon", no invented customers, revenue,
> or hockey-stick graph. Where the repo itself says something is a gate, this
> pitch says it is a gate.

---

## The receipts

| | | | |
| --- | --- | --- | --- |
${factRows}

### Precision notes — check the narration word for word

- **24 routes / 11 API endpoints / 13 pages.** \`npm run build\` prints 26 rows today: 24 product routes (11 \`/api/*\` endpoints + 13 pages) plus Next's \`/_not-found\` and this \`/pitch\` advertisement page. Before \`/pitch\` was added, the build printed 25 rows. The narration uses the 24 product routes.
- **Roughly thirteen thousand seven hundred lines.** Exactly 13,718 lines of \`app/ + lib/ + test/ + supabase/\` JS, MJS, CSS and SQL excluding the pitch ad assets (14,486 including them).
- **23 fail-closed switches.** 22 distinct environment variables ship in \`.env.example\` (secrets blank, feature flags \`false\`), plus the owner-controlled \`settings.enabled\` switch that \`README.md\` requires alongside \`OWNER_ASSISTANT_ENABLED\`. All 23 are off by default.
- **All eight healthy services.** Supabase reported auth, db, db_postgres_user, pooler, realtime, REST, storage and pg_bouncer as \`ACTIVE_HEALTHY\`. The narration names seven and says "all eight".
- **21 vs 20 migrations.** 20 versioned SQL files are in this repo; the live project has 21 applied, the extra one being \`bubbles_memory_passport\`.
- **Nine photos.** \`public/images/\` holds nine \`.webp\` photos. Bubbles is code, not an image.

---

## The transcript

${chapters}
---

## Verify every claim in an afternoon

\`\`\`sh
npm install
npm test                 # 183 passing tests, 48 files, 0 failures
npm run build            # clean production build, 24 routes
npm run audit:secrets    # repository secret scan
git status --short
\`\`\`

Then open ${PITCH_META.site}, and open \`/pitch\` to hear the whole thing with
the transcript highlighted chapter by chapter. The live Vercel project is
READY/PROMOTED; the connected Supabase project reports all eight services
healthy with 21 migrations applied (20 versioned SQL files ship in this repo).

## What this pitch deliberately does NOT claim

It does not claim customers, revenue, passkeys, SMS sending, a scheduling
engine, training verification, or production approval for the gated flows.
\`README.md\`, \`RED_TEAM_PRE_DEMO.md\` and \`.env.example\` document those as
gates. That documented distance between *shipped* and *planned* is itself one
of the strongest things being sold here.

## Bubbles, and the Meta AI ad assets

The advertisement uses **the real assets in this repo, directly**:

- \`lib/bubbles-bg.js\` → \`CharacterBubble\`, the actual Bubbles avatar ("she"
  is one bubble at rest, a vibrating cluster when thinking). Rendered on
  \`/pitch\` and it animates while the narration plays.
- \`app/public/bubbles-widget.js\` → the real floating Bubbles launcher, chat
  dialog, mic and speech synthesis, mounted by \`app/layout.js\`.
- \`lib/bubbles-persona.mjs\` → her actual personality profile and the fifteen
  non-negotiable rules quoted in chapter 10.
- \`app/globals.css\` → the real bubble, scrub-bubble and character-bubble
  styling and keyframes.

**No picture of Bubbles, no screenshot, and no generated lookalike was
created.** The Meta AI ad files are not in this checkout yet (the only images
in the repo are the nine \`.webp\` photos in \`public/images/\`). A zero-copy
loading dock is ready instead:

1. Drop the **exact** Meta AI files into \`public/meta-ai/\`, filenames unchanged.
2. List each verbatim filename in \`lib/pitch/meta-ai-assets.mjs\`.
3. Reload \`/pitch\`: the hero renders \`/meta-ai/<exact filename>\` via
   \`<img>\` or \`<video>\` — byte for byte, nothing re-encoded or substituted.
   Until then it falls back to the real \`CharacterBubble\` above.

See \`public/meta-ai/DROP_EXACT_FILES_HERE.md\`.

---

*Generated by \`node scripts/build-pitch-doc.mjs\` from \`lib/pitch/script.mjs\`.*
`;

writeFileSync('INVESTOR_PITCH.md', doc);
writeFileSync('public/INVESTOR_PITCH.md', doc);
console.log(`Wrote INVESTOR_PITCH.md + public/INVESTOR_PITCH.md (${doc.length} chars, ${mmss(total)} audio).`);
