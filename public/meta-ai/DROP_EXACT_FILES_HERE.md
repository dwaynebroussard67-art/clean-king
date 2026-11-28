# Drop the EXACT Meta AI ad files in this folder

**Put the original Meta AI files here. Do not rename, re-export, screenshot,
trace, or recreate them.** The pitch page renders whatever is listed in
`lib/pitch/meta-ai-assets.mjs` directly from this folder, byte for byte, at
`/meta-ai/<exact filename>`.

## Three steps

1. Copy the exact files Meta AI produced into **this** folder (`public/meta-ai/`),
   keeping their exact filenames and extensions.
2. Open `lib/pitch/meta-ai-assets.mjs` and add one line per file to
   `META_AI_ASSETS`, for example:

   ```js
   export const META_AI_ASSETS = [
     { file: 'Bubbles-avatar-FINAL.png', kind: 'image', role: 'avatar', label: 'Bubbles avatar (Meta AI)' },
     { file: 'Bubbles-loop-FINAL.mp4', kind: 'video', role: 'motion', label: 'Bubbles motion (Meta AI)' },
   ];
   ```

3. Reload `/pitch`. The hero avatar switches from the repo's real
   `CharacterBubble` component to **that exact file**. Nothing else changes.

## What is supported

| Kind | Extensions | Rendered as |
| --- | --- | --- |
| `image` | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg` | `<img src="/meta-ai/…">` |
| `video` | `.mp4`, `.webm` | `<video autoplay loop muted playsinline>` |

If a listed file is missing or fails to load, the page falls back to the real
Bubbles avatar from `lib/bubbles-bg.js` — never a generated substitute.

## Why this exists

The request was: *use them directly, not something like them, not copies, not
a picture, not a screenshot.* A generated "Bubbles-like" image would violate
that, so no substitute art was created. This folder is a zero-copy loading dock:
the exact asset objects become the advertisement the moment they land in the
repo.
