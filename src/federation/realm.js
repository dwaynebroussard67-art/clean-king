/**
 * realm.js — the axes of identity: WHICH POPULATION, WHICH REPO, WHICH SHELF.
 *
 * A fact's key is `carrier | realm | shelf | equation`, broadest scope first.
 * The carrier lives in carrier.js and is imported here only so the signature
 * function has one home; this file owns the realm.
 *
 * The Federation was built for one cockpit landing facts on one carrier. A
 * collective that spans every repository a person owns needs one more
 * dimension, and it is not a label on the outside — it is part of what makes
 * two claims the same claim.
 *
 *   BEFORE   capital(france) = paris            on the world shelf
 *   AFTER    capital(france) = paris            on the world shelf, in realm R
 *
 * That distinction is not bookkeeping. Two repos disagreeing is not a
 * contradiction — it is a DIVERGENCE, and it is information. `test_command` in
 * TWLD being `npm test` while `striper` speaks `pytest` breaks nothing, and
 * firing "one contradiction closes it forever" across repository boundaries
 * would empty the shelf the first week.
 *
 * THE THREE RULES OF A REALM
 *
 *   1. A REALM IS A CLOSED VOCABULARY. `shared`, or `repo:<slug>`. Nothing
 *      else is accepted, because an unrecognised realm is a fact living
 *      somewhere nobody can find it again.
 *   2. REALM GATES IDENTITY AND RETRIEVAL, NOT WITNESSING. Any registered
 *      node may witness anything it actually observed — that is the entry
 *      rule and it does not change. What a realm controls is what counts as
 *      the same claim, and who is SERVED the fact.
 *   3. `shared` IS THE COMMONS AND IT IS THE DEFAULT. Every fact that
 *      predates realms lands there, so nothing a person built is lost. See
 *      D26's standard: a reshape that only changed strings would have started
 *      every existing carrier from nothing.
 *
 * RENAMES ARE FIRST-CLASS AND NEVER SILENT
 *
 * GitHub slugs change. If the realm key were the slug and the slug changed,
 * every fact in that repo would silently re-key into a different realm and
 * the repository would look like it had never existed. So a rename is an
 * appended registry record (see nodes.js) that leaves the old slug as an
 * alias, and `resolveRealm` follows aliases. The on-disk key never moves.
 */

'use strict';

const crypto = require('node:crypto');

const { CARRIERS, DEFAULT_CARRIER, isCarrier } = require('./carrier.js');

/** The commons. A fact here is asserted to hold no matter which repo you are
 *  standing in. It is the reason the collective is worth more than the sum of
 *  the passports. */
const SHARED_REALM = 'shared';

/** One repository. The slug is the DISPLAY key; the node's identity is its
 *  remote (see nodes.js). The two are linked by the registry, not by string
 *  surgery, so a rename cannot silently re-key a repository's history. */
const REPO_PREFIX = 'repo:';

const SLUG_RE = /^[a-z0-9._-]{1,80}$/;

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

// ---------------------------------------------------------------- vocabulary

const isRealm = (v) => typeof v === 'string' && (v === SHARED_REALM || isRepoRealm(v));

const isRepoRealm = (v) => typeof v === 'string' && v.startsWith(REPO_PREFIX) && SLUG_RE.test(v.slice(REPO_PREFIX.length));

/** `repo:twld` — or null if the slug cannot be a realm. */
function repoRealm(slug) {
  return sanitizeSlug(slug) ? `${REPO_PREFIX}${sanitizeSlug(slug)}` : null;
}

/** `repo:twld` -> `twld`. The commons has no slug. */
function realmSlug(realm) {
  return isRepoRealm(realm) ? realm.slice(REPO_PREFIX.length) : null;
}

/**
 * GitHub slugs are not always filesystem- or URL-safe. One canonical shape.
 *
 * Case is folded HERE and nowhere else, so there is exactly one spelling of
 * every realm: `TWLD`, `twld` and `Twld` are the same key, not three nodes.
 * Length is checked BEFORE any truncation, because truncating two long names
 * into the same short one is a collision dressed up as normalisation.
 */
function sanitizeSlug(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 80) return null;
  return SLUG_RE.test(s) ? s : null;
}

// ------------------------------------------------------------------- remotes

/**
 * One canonical remote per repository, however it was written.
 *
 *   git@github.com:Owner/Repo.git      -> https://github.com/owner/repo
 *   ssh://git@github.com/Owner/Repo    -> https://github.com/owner/repo
 *   https://github.com/Owner/Repo.git/ -> https://github.com/owner/repo
 *
 * Returns null for anything that is not a remote. Never throws, never
 * guesses: an unparseable remote is a named refusal, not a default.
 */
function normalizeRemote(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  let s = raw;

  // scp-like: [user@]host:owner/repo.git
  const scp = s.match(/^(?:([^@/]+)@)?([^:/]+):(.+)$/);
  if (scp && !/^[a-z+]+:\/\//i.test(s)) s = `https://${scp[2]}/${scp[3]}`;

  // every transport collapses to https for identity purposes
  s = s.replace(/^(?:ssh|git\+ssh|git|http|https):\/\//i, 'https://');
  s = s.replace(/^https:\/\/[^@/]+@/i, 'https://');
  if (!/^https:\/\//i.test(s)) return null;

  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!u.hostname) return null;

  // Trailing slashes before the .git suffix, then again after it: GitHub will
  // hand you `Owner/Repo.git/` and both decorations have to come off.
  let path = u.pathname.replace(/\/+$/, '');
  path = path.replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!path || path === '/') return null;

  return `https://${u.hostname.toLowerCase()}${path}`.toLowerCase();
}

/** `https://github.com/owner/repo` -> `owner/repo`. */
function ownerRepo(remote) {
  const n = normalizeRemote(remote);
  if (!n) return null;
  const m = n.match(/^https:\/\/[^/]+\/(.+)$/);
  if (!m) return null;
  const parts = m[1].split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-2).join('/');
}

/** The repo's own name: `https://github.com/owner/repo` -> `repo`. */
function repoName(remote) {
  const n = normalizeRemote(remote);
  if (!n) return null;
  const parts = n.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/** A proposed slug for a remote. Display only — identity is the remote. */
function slugFromRemote(remote) {
  return sanitizeSlug(repoName(remote));
}

// ------------------------------------------------------------------ identity

/**
 * The Federation's key: carrier, then realm, then shelf, then the equation.
 *
 * Ordered broadest scope first. The CARRIER sits outermost because it is the
 * population that observed the fact, and two populations must never pool
 * witnesses no matter how alike their equations are — see carrier.js for the
 * collision this prevents. The REALM sits in front of the SHELF because you
 * can hold `composer(claude.ai) = X` in two repositories and they are two
 * facts, but you cannot hold two different worlds inside one repository
 * either.
 *
 * `equationSignature` keeps its own `eq|` prefix and its own canonicalisation,
 * so a prose claim and an equation claim can never collide, and a fact that
 * predates an axis keeps the signature it always had until the store re-keys
 * it on load (see store.js `apply`).
 *
 * THE ARGUMENT ORDER IS PART OF THE CONTRACT. The carrier went in front of the
 * realm when the carriers were separated, so a call in the old four-argument
 * shape would silently compute a different key rather than fail. It is
 * detected and refused by name instead, because a mis-keyed signature is
 * exactly the silent defect this function exists to prevent.
 */
function federationSignature(eq, carrier, realm, shelf, equationSignature) {
  if (!isCarrier(carrier)) {
    const legacyShape = isRealm(carrier) && typeof realm === 'string' && ['world', 'operational'].includes(realm);
    throw new Error(
      legacyShape
        ? `federationSignature: carrier must be one of ${CARRIERS.join(', ')}. ` +
          'This call is in the pre-carrier (eq, realm, shelf, equationSignature) shape — ' +
          'the carrier argument now comes FIRST, before the realm.'
        : `federationSignature: carrier must be one of ${CARRIERS.join(', ')}, got ${JSON.stringify(carrier)}.`
    );
  }
  return equationSignature(
    eq,
    `${carrier}|${String(realm || SHARED_REALM)}|${String(shelf || 'world')}`
  );
}

/** Why a realmless record is safe to adopt into the commons. */
const legacyRealm = () => SHARED_REALM;

module.exports = {
  SHARED_REALM,
  REPO_PREFIX,
  SLUG_RE,
  CARRIERS,
  DEFAULT_CARRIER,
  isCarrier,
  sha256,
  isRealm,
  isRepoRealm,
  repoRealm,
  realmSlug,
  sanitizeSlug,
  normalizeRemote,
  ownerRepo,
  repoName,
  slugFromRemote,
  federationSignature,
  legacyRealm,
};
