/**
 * equation.js — claim identity for structured facts: "the equation form".
 *
 * The problem this solves is measured, not theorised. With prose identity
 * (D7), these are three different claims with one witness each, and nothing
 * ever promotes:
 *
 *   2d422407f9c3c19e   <- The capital of France is Paris.
 *   70ee371c39e38615   <- Paris is the capital of France.
 *   4cdac79867ba9a6f   <- France has Paris as its capital.
 *
 * The equation form is a canonical structured record — subject, predicate,
 * object, plus units, time and scope — so every phrasing of one fact hashes
 * to one key:
 *
 *   capital(fance) = paris        <- one claim, however it was worded
 *
 * The rules that make it safe, all of them enforced here:
 *
 *   - IDENTITY IS CONJUNCTIVE. No single field settles it: two equations are
 *     the same claim only when subject AND predicate AND object AND units AND
 *     time AND scope all agree. A different object is a DIFFERENT claim —
 *     never a merge, never silently reconciled.
 *   - THE SOUNDNESS RULE. If the reduction is not clean, the claim keeps its
 *     prose form and simply never merges with anything. Never merged wrongly
 *     is worth more than often merged.
 *   - A MODEL NOMINATES; CODE DECIDES. A nomination arrives as data. Code
 *     checks its shape, canonicalises it, and — the part that matters —
 *     verifies it is GROUNDED in the prose it claims to reduce: the subject
 *     and the object must actually appear in the text. A nomination cannot
 *     invent content the writer never wrote.
 *   - PROSE IDENTITY IS UNCHANGED. Claims that do not reduce keep exactly
 *     the signature they have always had, so existing stores replay
 *     identically.
 *
 * The deterministic nominator below is a LABELLED PLACEHOLDER, exactly like
 * HashEncoder: it recognises a small, closed set of sentence shapes so the
 * whole pipeline is demonstrable and testable with no API key. A model that
 * nominates equations through the same interface replaces it without
 * touching anything downstream.
 */

'use strict';

const crypto = require('node:crypto');

const MAX_FIELD = 120; // a field longer than this is not a reduction, it is a sentence

// --------------------------------------------------------------------------
// Canonicalisation
// --------------------------------------------------------------------------

/** Lowercase, collapse whitespace, strip surrounding punctuation and quotes,
 *  strip a leading article. "The France." and "france" are the same field. */
function normalizeField(s) {
  let t = String(s ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^['"“”(]+/, '').replace(/['"””.,;:!?)…]+$/, '');
  t = t.replace(/^(the|a|an) /, '');
  return t.trim();
}

/** A canonical equation, or null if any field is missing/oversized. */
function canonicalEquation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const subject = normalizeField(raw.subject);
  const predicate = normalizeField(raw.predicate);
  const object = normalizeField(raw.object);
  if (!subject || !predicate || !object) return null;
  for (const f of [subject, predicate, object]) {
    if (f.length > MAX_FIELD) return null;
  }
  const units = raw.units != null ? normalizeField(raw.units) : '';
  const time = raw.time != null ? normalizeField(raw.time) : '';
  if (units.length > MAX_FIELD || time.length > MAX_FIELD) return null;
  return { subject, predicate, object, units, time };
}

/** The conjunctive identity: every field, in a fixed order, hashed. Prose
 *  claims keep claimSignature(); equation claims get this. The `eq|` prefix
 *  guarantees no equation key can ever collide with a prose key. */
function equationSignature(eq, scope = 'global') {
  const c = canonicalEquation(eq);
  if (!c) return null;
  const key = ['eq', String(scope).trim().toLowerCase(), c.subject, c.predicate, c.object, c.units, c.time].join('|');
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Human-readable: capital(france) = paris [as of 2026] [in km]. */
function renderEquation(eq) {
  const c = canonicalEquation(eq);
  if (!c) return null;
  let s = `${c.predicate}(${c.subject}) = ${c.object}`;
  if (c.units) s += ` [in ${c.units}]`;
  if (c.time) s += ` [as of ${c.time}]`;
  return s;
}

// --------------------------------------------------------------------------
// Code decides: grounding
// --------------------------------------------------------------------------

/** A nomination is grounded when its subject and object actually occur in
 *  the prose it claims to reduce. This is what stops a nominator — model or
 *  pattern — from inventing a fact and attaching it to someone's reply. */
function grounded(eq, prose) {
  const c = canonicalEquation(eq);
  if (!c) return false;
  const text = String(prose || '').toLowerCase().replace(/\s+/g, ' ');
  const hay = ` ${text} `;
  const present = (needle) => {
    const n = needle.replace(/\s+/g, ' ').trim();
    if (!n) return false;
    return hay.includes(` ${n} `) || hay.includes(` ${n}`) || hay.includes(`${n} `) || hay.includes(n);
  };
  return present(c.subject) && present(c.object);
}

/**
 * The full acceptance test. Returns a canonical equation, or
 * { rejected, reason } — never throws. Rejection means: keep the prose form.
 */
function acceptEquation(nomination, prose) {
  const c = canonicalEquation(nomination);
  if (!c) return { rejected: true, reason: 'shape' };
  if (!grounded(c, prose)) return { rejected: true, reason: 'ungrounded' };
  return c;
}

// --------------------------------------------------------------------------
// The placeholder nominator (deterministic, closed set of shapes)
// --------------------------------------------------------------------------

const NOMINATOR_NOTE =
  'Deterministic pattern nominator — a labelled placeholder, same posture as ' +
  'HashEncoder. It recognises four sentence shapes and nothing else. A model ' +
  'nominating through acceptEquation() replaces it with no downstream changes.';

/** Strip a trailing sentence stop and normalise spacing for matching. */
function matchable(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/, '')
    .trim();
}

/** Four shapes, one canonical triple each. Predicate keeps its head phrase
 *  only ("capital of" and "capital" are the same predicate — the "of" is
 *  syntax, not meaning). Returns a raw nomination or null. */
function nominateEquation(prose) {
  const t = matchable(prose);
  if (!t || t.length > 300) return null;
  let m;

  // "the capital of france is paris"  ->  capital(france) = paris
  m = t.match(/^(?:the )?([a-z][a-z ]{1,40}?) of ([a-z0-9 .'()-]{1,60}?) is (.+)$/);
  if (m) return { subject: m[2], predicate: m[1], object: m[3] };

  // "paris is the capital of france"  ->  capital(france) = paris
  m = t.match(/^(.+?) is (?:the )?([a-z][a-z ]{1,40}?) of ([a-z0-9 .'()-]{1,60})$/);
  if (m) return { subject: m[3], predicate: m[2], object: m[1] };

  // "france has paris as its capital"  ->  capital(france) = paris
  m = t.match(/^(.+?) has (.+?) as (?:its |the |a )?([a-z][a-z ]{1,40})$/);
  if (m) return { subject: m[1], predicate: m[3], object: m[2] };

  // "france's capital is paris"  ->  capital(france) = paris
  m = t.match(/^(.+?)(?:'s|’s) (.+?) is (.+)$/);
  if (m) return { subject: m[1], predicate: m[2], object: m[3] };

  return null;
}

module.exports = {
  normalizeField,
  canonicalEquation,
  equationSignature,
  renderEquation,
  grounded,
  acceptEquation,
  nominateEquation,
  NOMINATOR_NOTE,
  MAX_FIELD,
};
