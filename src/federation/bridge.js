/**
 * bridge.js — the only door between two carriers.
 *
 * WHY A DOOR AND NOT A SHARED ROOM
 *
 * The repair carrier and the browser carrier are separated in the signature
 * itself (see carrier.js), so they can no longer contaminate each other by
 * accident. But separation that means "never speaks" is the wrong product:
 * Forge Flight flying to GitHub to relay a repair is a real workflow, and what
 * those seats figure out belongs on the repair side — and stays on the browser
 * side too, because it is genuinely both.
 *
 * So facts cross. Crossing means a SECOND RECORD in the destination carrier,
 * carrying provenance back to the first. Not one merged record with a pooled
 * witness list. Two records is more honest than one: each carrier keeps its own
 * witness population, its own clock and its own blast radius, and a reader on
 * either side can see that a fact arrived from somewhere else and go check
 * where.
 *
 * THE FOUR REFUSALS
 *
 *   not-portable      a fact that has not earned the right to travel WITHIN its
 *                     own carrier does not earn it by crossing. `portable()`
 *                     decides, and a single node's self-reported outcome stays
 *                     put. This reuses the rule the store already has rather
 *                     than inventing a looser one for the door.
 *
 *   closed /          a dead fact must not arrive alive. Landing a closed or
 *   superseded        superseded fact into a fresh carrier would create a live
 *                     record from one its own population already retired, and
 *                     the destination would have no way to know.
 *
 *   same-carrier      a fact cannot arrive from where it already is. Without
 *                     this the door is a no-op that launders a local
 *                     observation into an "arrived" one.
 *
 *   unsigned-export   the direction that leaks is the direction that needs a
 *                     name. See below.
 *
 * WHY THE TWO DIRECTIONS ARE NOT SYMMETRIC
 *
 * They carry different risks, so they get different bars. Treating them alike
 * would either make the relay unusable or make the leak easy.
 *
 *   browser -> repair   may be MECHANICAL. This is the relay workflow: seats
 *                       worked a repository, and what they established should
 *                       inform the repair side without a human signing every
 *                       equation. It lands witnessed `structural`, because the
 *                       provenance is re-derivable by anybody holding both
 *                       logs. And it NEVER VOTES: an arrived witness is
 *                       recorded and reported, but promotion counts only what
 *                       the destination population observed itself (see
 *                       `land()` in store.js). So the browser can inform the
 *                       repair side without the two populations pooling.
 *
 *   repair -> browser   requires a NAMED HUMAN. This direction puts repair
 *                       intelligence onto a surface whose whole job is typing
 *                       into somebody else's chat composer — the boot block
 *                       reads the store and renders it into the prompt. That is
 *                       an export, exports are the human's call, and "the human
 *                       is the gate" is not a slogan that gets relaxed because
 *                       the transfer was convenient. Fail closed: no name, no
 *                       crossing, and the refusal says why.
 *
 * WHAT THE PROVENANCE IS WORTH, HONESTLY
 *
 * `origin` names the source carrier, the fact id, its signature in that store,
 * and the chain head it was read from. Given BOTH logs, any of it is checkable
 * and none of it has to be trusted. Given only the destination log, it is a
 * claim about a file you do not hold. That is the same ceiling the rest of the
 * system accepts — a hash identifies, it does not attest — and it is stated
 * here rather than left to be discovered.
 */

'use strict';

const { CARRIERS, DEFAULT_CARRIER, isCarrier, origin } = require('./carrier.js');
const { portable } = require('./store.js');

/** Which ways a fact can be refused at the door. Closed, and named, because a
 *  transfer that silently dropped facts would teach the next caller not to
 *  trust the door. */
const REFUSALS = ['not-portable', 'closed', 'superseded', 'same-carrier', 'unsigned-export', 'unwitnessed'];

const shortHead = (h) => String(h || '').slice(0, 12);

/**
 * A stable witness reference for an arrived fact.
 *
 * Deliberately EXCLUDES the chain head. Including it would make every transfer
 * after a new write look like a fresh witness, and repeated transfers would
 * mint distinct witnesses — the exact vote-minting the store's
 * `already-witnessed` path exists to stop. The head lives in `origin`, where it
 * dates the reading without changing the identity of the observation.
 */
const transferReference = (from, fact) => `carrier:${from}|fact:${fact.id}|sig:${String(fact.signature || '').slice(0, 16)}`;

/**
 * Pick the facts to move. Explicit signatures win; otherwise a predicate
 * filter; otherwise nothing, because "everything" is a decision a caller
 * should have to make out loud.
 *
 * THE TWO POOLS DIFFER, ON PURPOSE.
 *
 * A caller who names SIGNATURES is asking about specific facts, so they are
 * looked up among ALL of them, closed and superseded included. Searching only
 * the live set would make a request for a dead fact come back as "nothing
 * selected" — indistinguishable from a typo in the signature — and the caller
 * would never learn that what it asked for is closed. A refusal has to be
 * reachable to be a refusal.
 *
 * A caller who supplies a FILTER is asking a question about the present state
 * of the store, so it runs over the live set. Nobody writing `where` wants
 * retired facts silently included.
 */
function select(source, { signatures, where, limit = 200 } = {}) {
  if (Array.isArray(signatures) && signatures.length) {
    const pool = source.all ? source.all() : (source.live ? source.live() : []);
    const want = new Set(signatures);
    return pool.filter((f) => want.has(f.signature)).slice(0, limit);
  }
  if (typeof where === 'function') {
    const pool = source.live ? source.live() : [];
    return pool.filter(where).slice(0, limit);
  }
  return [];
}

/**
 * Move facts from one carrier to another.
 *
 * @param {object} source  a Federation (or anything exposing `live()`/`append()`)
 * @param {object} dest    a Federation to land into — a DIFFERENT store
 * @param {object} opts
 * @param {string} opts.from     the source carrier; defaults to what the source
 *                               facts say, else 'browser' for a carrierless
 *                               export (the browser store predates the axis)
 * @param {string} opts.to       the destination carrier. Required.
 * @param {string} opts.nodeId   the node witnessing the arrival in `dest`.
 *                               Must be registered there — identity is a
 *                               registered fact, not a string.
 * @param {string} [opts.actor]  the human signing a repair->browser export
 * @param {string[]} [opts.signatures]  move exactly these
 * @param {Function} [opts.where]       or move whatever this accepts
 * @param {string} [opts.reason]  why. Logged on both sides.
 * @param {string} [opts.at]
 */
function transfer(source, dest, opts = {}) {
  const to = opts.to == null || opts.to === '' ? DEFAULT_CARRIER : String(opts.to).trim().toLowerCase();
  if (!isCarrier(to)) {
    return { rejected: true, reason: 'carrier', detail: `to must be one of ${CARRIERS.join(', ')}.` };
  }

  const nodeId = String(opts.nodeId || '').trim();
  if (!nodeId) {
    return { rejected: true, reason: 'nodeId', detail: 'A transfer names the node that will witness the arrival.' };
  }

  // The source carrier. An export from the browser store has no carrier field
  // at all — it predates the axis — so it is named here rather than guessed
  // per record.
  const declared = opts.from == null || opts.from === '' ? null : String(opts.from).trim().toLowerCase();
  const from = declared && isCarrier(declared) ? declared : null;
  if (declared && !from) {
    return { rejected: true, reason: 'carrier', detail: `from must be one of ${CARRIERS.join(', ')}.` };
  }
  if (from === to) {
    return {
      rejected: true,
      reason: 'same-carrier',
      detail: `A fact cannot be transferred from '${from}' into '${to}'. That is a no-op that would launder a local observation into an arrived one.`,
    };
  }

  // The leak direction needs a name. Fail closed, and say which direction and
  // why, because a refusal that does not explain itself gets worked around.
  const actor = String(opts.actor || '').trim() || null;
  if (from === 'repair' && to === 'browser' && !actor) {
    return {
      rejected: true,
      reason: 'unsigned-export',
      detail:
        'repair -> browser is an export onto a surface that types into third-party chat composers. ' +
        'It needs a named human: pass actor. Nothing crossed.',
    };
  }

  const at = opts.at || new Date().toISOString();
  const picked = select(source, opts);
  if (!picked.length) {
    return {
      ok: true,
      from: from || null,
      to,
      transferred: [],
      refused: [],
      detail: 'Nothing selected. A transfer moves named facts or facts a filter accepts; it does not move everything by default.',
    };
  }

  const transferred = [];
  const refused = [];
  const srcHead = source.head || (source.chain && source.chain.head) || '';

  for (const f of picked) {
    // A carrierless source (a browser export) takes the declared carrier; a
    // carrier-aware source is believed per record.
    const factCarrier = isCarrier(f.carrier) ? f.carrier : from;
    if (!isCarrier(factCarrier)) {
      refused.push({ id: f.id, reason: 'carrier', detail: 'Source fact has no carrier and none was declared.' });
      continue;
    }
    if (factCarrier === to) {
      refused.push({ id: f.id, reason: 'same-carrier', detail: `Already in '${to}'.` });
      continue;
    }

    // A dead fact does not arrive alive.
    if (f.closedAt && f.status === 'closed') {
      refused.push({ id: f.id, rendered: f.rendered, reason: 'closed', detail: 'Closed by contradiction in its own carrier.' });
      continue;
    }
    if (f.closedAt || f.status === 'superseded') {
      refused.push({ id: f.id, rendered: f.rendered, reason: 'superseded', detail: 'The target moved; the live replacement is the fact worth crossing.' });
      continue;
    }

    // Has it earned the right to travel at all?
    const p = portable(f);
    if (!p.portable) {
      refused.push({ id: f.id, rendered: f.rendered, reason: 'not-portable', detail: p.reason });
      continue;
    }

    // Only a witness with a checkable pointer may cross. Every portable fact
    // has one by construction, but a fact whose witnesses lost their reference
    // is not something the door should wave through on faith.
    const srcWitness = (f.witnesses || []).find((w) => w && String(w.reference || '').trim());
    if (!srcWitness) {
      refused.push({ id: f.id, rendered: f.rendered, reason: 'unwitnessed', detail: 'No witness carries an evidence pointer.' });
      continue;
    }

    const prov = origin({
      carrier: factCarrier,
      factId: f.id,
      signature: f.signature,
      head: srcHead,
      at,
      actor,
      mechanical: !actor,
    });

    // A named human ruling is witnessed `human`; a mechanical crossing is
    // witnessed `structural`, because the provenance is re-derivable by anyone
    // holding both logs. Never `outcome` — the destination node did not act,
    // and store.js refuses that combination outright.
    const res = dest.land({
      shelf: f.shelf,
      carrier: to,
      realm: f.realm || 'shared',
      equation: f.equation,
      witness: actor ? 'human' : 'structural',
      nodeId,
      reference: transferReference(factCarrier, f),
      target: f.target || undefined,
      actor: actor || undefined,
      origin: prov,
      at,
    });

    if (res.rejected) {
      refused.push({ id: f.id, rendered: f.rendered, reason: res.reason, detail: res.detail });
      continue;
    }
    transferred.push({
      id: res.fact.id,
      signature: res.fact.signature,
      rendered: res.fact.rendered,
      action: res.action,
      from: { carrier: factCarrier, factId: f.id, signature: f.signature, head: shortHead(srcHead) },
      votes: false,
    });
  }

  // The door is logged on BOTH sides. A transfer only the destination knows
  // about is a transfer the source cannot audit, and the source is where the
  // fact was earned.
  const note = `${transferred.length} fact(s) ${from || 'source'} -> ${to}${opts.reason ? ` — ${opts.reason}` : ''}`;
  try {
    dest.append('event', {
      kind: 'transfer-in',
      carrier: to,
      from: from || null,
      nodeId,
      actor,
      mechanical: !actor,
      count: transferred.length,
      refused: refused.length,
      signatures: transferred.map((t) => t.signature),
      sourceHead: srcHead,
      note,
      at,
    });
  } catch { /* a destination that cannot log still landed the facts; reported below */ }
  try {
    if (typeof source.append === 'function') {
      source.append('event', {
        kind: 'transfer-out',
        carrier: from || null,
        to,
        nodeId,
        actor,
        mechanical: !actor,
        count: transferred.length,
        refused: refused.length,
        signatures: transferred.map((t) => t.from.signature),
        note,
        at,
      });
    }
  } catch { /* an export file opened read-only cannot log; the destination did */ }

  return {
    ok: true,
    from: from || null,
    to,
    actor,
    mechanical: !actor,
    transferred,
    refused,
    // Said out loud every time, so a caller cannot mistake an informed fact for
    // an established one.
    votes: false,
    detail: transferred.length
      ? `${transferred.length} crossed into '${to}'; ${refused.length} refused. Arrived facts inform and never vote.`
      : `Nothing crossed; ${refused.length} refused.`,
  };
}

module.exports = { transfer, select, transferReference, REFUSALS };
