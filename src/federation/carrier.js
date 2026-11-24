/**
 * carrier.js — the outermost axis of identity: WHICH POPULATION observed this?
 *
 * WHY THIS EXISTS, AND WHY A FILE PATH WAS NOT ENOUGH
 *
 * Two Federations share this codebase by descent. The repair carrier is the
 * one this repository is for: nodes are REPOSITORIES, facts are about source,
 * and the reader is an agent that is about to patch a file. The browser
 * carrier is Forge Flight's: nodes are COCKPITS, facts are about websites,
 * and the reader is a chat composer on somebody else's domain.
 *
 * They were separated by directory, and a directory is a convention, not a
 * boundary. Both stores carry the same SCHEMA, the same GENESIS, the same
 * `chainHash`, and — the part that matters — the same `equationSignature`. So
 * the same equation observed on both sides produced the SAME signature:
 *
 *     composer(claude.ai) = textarea#prompt     browser   -> f8cf989c…
 *     composer(claude.ai) = textarea#prompt     repair    -> f8cf989c…
 *
 * `land()` finds the existing record and adds a witness. No error, no
 * finding, no log line. Two populations that must never vote together start
 * voting together, and five mixed witnesses promotes the result to
 * `established` — the one status an agent trusts enough to act on.
 *
 * THAT IS CONTAMINATION, AND IT IS SILENT. This module is why it stops being
 * silent: the carrier sits IN FRONT of the realm in the signature, the same
 * way the realm already sits in front of the shelf. A browser fact and a
 * repair fact about the same equation can no longer produce the same
 * signature even if somebody points both stores at the same file.
 *
 * WHY "CROSS IT" IS STILL THE ANSWER, AND WHAT CROSSING MEANS
 *
 * Separation is not isolation. Forge Flight flying to GitHub to relay a
 * repair is a real workflow, and what those seats figure out belongs on the
 * repair side — and stays on the browser side too, because it is genuinely
 * both. So facts DO cross. They cross through `bridge.js`, and crossing means
 * a SECOND RECORD in the destination carrier, carrying provenance back to the
 * first. Not one merged record with a pooled witness list.
 *
 * Two records is more honest than one: each carrier keeps its own witness
 * population, its own clock, and its own blast radius, and a reader on either
 * side can see that the fact arrived from somewhere else and check where.
 *
 * THE CLOSED VOCABULARY
 *
 * Two carriers and no third. An unrecognised carrier is refused by name,
 * because a fact living in a population nobody defined is a fact that cannot
 * be found again — the same reasoning that closed the realm vocabulary and
 * the evidence categories. Adding a carrier is a deliberate act with a
 * migration attached, not a string somebody typed.
 */

'use strict';

/** The two populations. Closed. See the header for why a third is a decision,
 *  not a value. */
const CARRIERS = ['repair', 'browser'];

/**
 * The default carrier, and the one every legacy record adopts into.
 *
 * This repository IS the repair federation — its nodes are repositories and
 * its readers are repair agents — so its history is repair history. Adopting
 * a carrierless record anywhere else would misfile the whole existing chain.
 */
const DEFAULT_CARRIER = 'repair';

/** A carrier is one of the two, exactly. No prefixes, no slugs, no aliases. */
const isCarrier = (v) => typeof v === 'string' && CARRIERS.includes(v);

/**
 * One canonical carrier, or null.
 *
 * Null rather than a default: the caller decides what an absent carrier
 * means, because "absent" on a new write (use the default) and "absent" on a
 * record being replayed (adopt and re-key) are different acts and should not
 * share a code path by accident.
 */
function normalizeCarrier(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  return isCarrier(s) ? s : null;
}

/** Why a carrierless record is safe to adopt into the repair carrier. */
const legacyCarrier = () => DEFAULT_CARRIER;

/**
 * The provenance stamp on a fact that arrived from another carrier.
 *
 * Every field here is CHECKABLE by anybody holding both logs: the source
 * carrier names the store, the fact id and signature name the record inside
 * it, and the head names the chain state it was read from. That is what makes
 * a mechanical transfer a `structural` witness rather than a self-reported
 * one — the reader does not have to trust the bridge, only re-derive it.
 *
 * `mechanical` is kept separate from `actor` on purpose. A transfer either
 * has a named human behind it or it does not, and a reader is entitled to tell
 * those apart without inspecting whether a string happens to be empty.
 */
function origin({ carrier, factId, signature, head, at, actor = null, mechanical = false }) {
  return Object.freeze({
    carrier: normalizeCarrier(carrier),
    factId: String(factId || ''),
    signature: String(signature || ''),
    head: String(head || ''),
    at: String(at || ''),
    actor: actor ? String(actor) : null,
    mechanical: Boolean(mechanical),
  });
}

/** An origin is well formed only if every pointer in it is present. A partial
 *  provenance is worse than none: it looks checkable and is not. */
function isOrigin(o) {
  return Boolean(
    o && typeof o === 'object' && isCarrier(o.carrier) && o.factId && o.signature && o.head && o.at
  );
}

module.exports = {
  CARRIERS,
  DEFAULT_CARRIER,
  isCarrier,
  normalizeCarrier,
  legacyCarrier,
  origin,
  isOrigin,
};
