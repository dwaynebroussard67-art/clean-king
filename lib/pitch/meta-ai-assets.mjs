/**
 * META AI AD ASSET MANIFEST — exact files, used directly.
 *
 * This is intentionally EMPTY right now. The Meta AI ad assets are not in this
 * checkout yet (verified: the only images in the repo are the ten .webp photos
 * in public/images/, and Bubbles herself is code, not an image file).
 *
 * HOW THIS WORKS — no copies, no screenshots, no lookalikes, no regenerated art:
 *   1. Drop the EXACT Meta AI files into public/meta-ai/ (keep their filenames).
 *   2. Add one entry per file below with the verbatim filename and its role.
 *   3. The /pitch page renders that exact byte-for-byte file at
 *      /meta-ai/<filename> via <img> / <video>. Nothing is re-encoded,
 *      traced, screenshotted or substituted.
 *   4. Until then, the page falls back to the REAL Bubbles avatar component
 *      (CharacterBubble from lib/bubbles-bg.js) — the same one the app ships.
 *
 * The first entry with role "avatar" becomes Bubbles on the pitch page.
 * Roles: "avatar" | "backdrop" | "motion".
 * Kinds: "image" (.png .jpg .jpeg .webp .gif .svg) | "video" (.mp4 .webm).
 */
export const META_AI_ASSETS = [
  // { file: 'EXACT-FILE-NAME.png', kind: 'image', role: 'avatar', label: 'Bubbles avatar (Meta AI)' },
  // { file: 'EXACT-FILE-NAME.mp4', kind: 'video', role: 'motion', label: 'Bubbles motion (Meta AI)' },
];

export const META_AI_DROP_PATH = '/meta-ai/';

export function metaAiAvatar(assets = META_AI_ASSETS) {
  return assets.find((a) => a.role === 'avatar') || null;
}

export function metaAiMotion(assets = META_AI_ASSETS) {
  return assets.find((a) => a.role === 'motion' || a.kind === 'video') || null;
}
