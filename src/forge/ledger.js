/**
 * ledger.js — read a Twin Labs evidence ledger WITHOUT trusting Twin Labs.
 *
 * WHY THIS FILE REIMPLEMENTS INSTEAD OF IMPORTING
 *
 * A `structural` witness means "re-derivable from the artifact by anyone, on
 * demand". If the Federation verified a repair cycle by calling the repair
 * engine's own verifier, the witness would mean "Twin Labs said it was fine" —
 * which is an `outcome`, self-reported, and exactly the kind of claim the store
 * refuses to let travel on its own.
 *
 * So the canonicalisation and the chain check are reimplemented here, from the
 * published format. The repair engine's verdict is not an input. Anybody holding
 * the cycle directory can run this file and reach the same conclusion, which is
 * the whole standard.
 *
 * WHAT IS CHECKED
 *
 *   the receipt      status `completed`, `failed` false, event count and head
 *                    matching the log that is actually on disk
 *   the event chain  every id is sha256(canonical(body-minus-id)); every
 *                    `previous` links to the prior id; `sequence` is 1..n with
 *                    no gaps; one runId throughout; schemaVersion 1
 *   the lineage      every `parents` entry names an EARLIER event, no duplicates
 *   the artifacts    every blob is at blobs/<id>, and sha256(bytes) === id, and
 *                    the recorded byte length matches — including blobs no event
 *                    references, because a crash can leave them and an unchecked
 *                    file in the evidence directory is an unchecked claim
 *   the head         the last event's id equals the receipt's head
 *
 * WHAT IS REFUSED, BY NAME
 *
 * A ledger that does not verify is not a lesson with a caveat on it. It is
 * nothing: `readCycle` returns a rejection and `landLesson` lands no facts,
 * because a fact whose witness cannot be re-derived has no business on the
 * operational shelf of a system whose readers are about to patch source.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { types } = require('node:util');

const HASH = /^[a-f0-9]{64}$/;
const ZERO = '0'.repeat(64);

const sha256Bytes = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * Strict, lossless canonical JSON: object keys sorted, array order preserved,
 * scalars exactly as JSON.stringify renders them.
 *
 * This is NOT `JSON.stringify`. It throws on anything JSON would silently lose
 * or that could execute on the way back out — a proxy, a symbol key, an
 * accessor, a sparse array, a cycle, NaN, Infinity, -0, a class instance. Every
 * one of those is a way for the bytes on disk to stop meaning what the record
 * says they mean, so each is a named refusal rather than a coercion.
 *
 * Matches the repair engine's canonicaliser byte for byte, which is the point:
 * the event ids are digests of this encoding, so agreeing on the encoding is
 * what makes independent verification possible at all.
 */
function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (typeof value !== 'object') throw new TypeError('evidence must be lossless JSON data');
  if (ancestors.has(value)) throw new TypeError('evidence must not contain a cycle');
  if (types.isProxy(value)) throw new TypeError('a proxy cannot be recorded as JSON');

  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    throw new TypeError('evidence objects must be plain data');
  }
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('symbol keys cannot be recorded as JSON');

  ancestors.add(value);
  try {
    const keys = Object.keys(value);
    if (Array.isArray(value) && (keys.length !== value.length || keys.some((k, i) => k !== String(i)))) {
      throw new TypeError('sparse or decorated arrays cannot be recorded');
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!desc.enumerable || !Object.hasOwn(desc, 'value')) {
        throw new TypeError('hidden or accessor data cannot be recorded');
      }
    }
    const parts = (Array.isArray(value) ? keys : keys.sort()).map((key) => {
      const encoded = canonicalJson(Object.getOwnPropertyDescriptor(value, key).value, ancestors);
      return Array.isArray(value) ? encoded : `${JSON.stringify(key)}:${encoded}`;
    });
    const open = Array.isArray(value) ? '[' : '{';
    const close = Array.isArray(value) ? ']' : '}';
    return open + parts.join(',') + close;
  } finally {
    ancestors.delete(value);
  }
}

/** A regular, non-symlink file, or a named refusal. Evidence that can be a link
 *  is evidence that can be swapped. */
function regularFile(file, what) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return { rejected: true, reason: 'missing-file', detail: `${what} is not there: ${file}` };
  }
  if (st.isSymbolicLink()) return { rejected: true, reason: 'symlink', detail: `${what} is a symlink: ${file}` };
  if (!st.isFile()) return { rejected: true, reason: 'not-a-file', detail: `${what} is not a regular file: ${file}` };
  return { ok: true, bytes: fs.readFileSync(file) };
}

function regularDir(dir, what) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return { rejected: true, reason: 'missing-directory', detail: `${what} is not there: ${dir}` };
  }
  if (st.isSymbolicLink()) return { rejected: true, reason: 'symlink', detail: `${what} is a symlink: ${dir}` };
  if (!st.isDirectory()) return { rejected: true, reason: 'not-a-directory', detail: `${what} is not a directory: ${dir}` };
  return { ok: true };
}

/**
 * Verify a ledger directory from scratch.
 *
 * @param {string} directory  the `ledger/` folder: events.jsonl + blobs/
 * @param {string} [expectedHead]  pin it, if the receipt supplies one
 * @returns {{ok:true, events:Array, runId:string, head:string} | {rejected:true, reason:string, detail:string}}
 */
function verifyLedger(directory, { expectedHead = null } = {}) {
  if (expectedHead !== null && !HASH.test(String(expectedHead))) {
    return { rejected: true, reason: 'bad-head', detail: 'An expected head must be 64 lowercase hex characters.' };
  }
  const d = regularDir(directory, 'the ledger directory');
  if (d.rejected) return d;
  const blobDir = path.join(directory, 'blobs');
  const bd = regularDir(blobDir, 'the artifact directory');
  if (bd.rejected) return bd;

  const logFile = regularFile(path.join(directory, 'events.jsonl'), 'the event log');
  if (logFile.rejected) return logFile;
  const text = logFile.bytes.toString('utf8');
  if (text && !text.endsWith('\n')) {
    return { rejected: true, reason: 'truncated', detail: 'The event log does not end in a newline: the last event was cut off mid-write.' };
  }

  const events = [];
  const lines = text ? text.trimEnd().split('\n') : [];
  const seen = new Set();
  let previous = ZERO;
  let runId = null;

  for (let index = 0; index < lines.length; index++) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      return { rejected: true, reason: 'unparseable-event', detail: `Event ${index + 1} is not JSON.` };
    }
    const id = event.id;
    if (!HASH.test(String(id || ''))) {
      return { rejected: true, reason: 'bad-event-id', detail: `Event ${index + 1} has no sha256 id.` };
    }

    // The id is the digest of the body WITHOUT the id. Recomputing it is the
    // check that matters: it is what makes an edited event detectable rather
    // than merely unlikely.
    const body = { ...event };
    delete body.id;
    let recomputed;
    try {
      recomputed = sha256Bytes(Buffer.from(canonicalJson(body), 'utf8'));
    } catch (e) {
      return { rejected: true, reason: 'not-lossless', detail: `Event ${index + 1} cannot be canonicalised: ${e.message}` };
    }
    if (recomputed !== id) {
      return {
        rejected: true,
        reason: 'id-mismatch',
        detail: `Event ${index + 1} does not hash to its own id. The record was edited, or it was written by a different canonicaliser.`,
      };
    }
    if (event.previous !== previous) {
      return { rejected: true, reason: 'chain-break', detail: `Event ${index + 1} does not link to the event before it.` };
    }
    if (event.sequence !== index + 1) {
      return { rejected: true, reason: 'sequence-gap', detail: `Event ${index + 1} claims sequence ${event.sequence}.` };
    }
    if (event.schemaVersion !== 1) {
      return { rejected: true, reason: 'schema', detail: `Event ${index + 1} is schemaVersion ${event.schemaVersion}; this reader knows 1.` };
    }
    if (runId === null) runId = event.runId;
    if (typeof event.runId !== 'string' || !event.runId || event.runId !== runId) {
      return { rejected: true, reason: 'run-id', detail: `Event ${index + 1} belongs to a different run. A ledger is one run.` };
    }
    if (!Array.isArray(event.parents) || new Set(event.parents).size !== event.parents.length || event.parents.some((p) => !seen.has(p))) {
      return { rejected: true, reason: 'lineage', detail: `Event ${index + 1} cites a parent that is not an earlier event in this ledger.` };
    }
    if (!Array.isArray(event.artifacts)) {
      return { rejected: true, reason: 'artifacts', detail: `Event ${index + 1} has no artifact list.` };
    }
    for (const artifact of event.artifacts) {
      if (!artifact || !HASH.test(String(artifact.id || ''))) {
        return { rejected: true, reason: 'artifact-id', detail: `Event ${index + 1} cites an artifact with no sha256 id.` };
      }
      const blob = regularFile(path.join(blobDir, artifact.id), `artifact ${artifact.id.slice(0, 12)}`);
      if (blob.rejected) return blob;
      if (sha256Bytes(blob.bytes) !== artifact.id) {
        return { rejected: true, reason: 'artifact-integrity', detail: `Artifact ${artifact.id.slice(0, 12)} does not hash to its own address.` };
      }
      if (blob.bytes.length !== artifact.bytes) {
        return { rejected: true, reason: 'artifact-length', detail: `Artifact ${artifact.id.slice(0, 12)} is ${blob.bytes.length} bytes, recorded as ${artifact.bytes}.` };
      }
    }

    seen.add(id);
    previous = id;
    events.push(event);
  }

  // Unreferenced blobs can be left behind by a crash. They are verified too:
  // an unchecked file sitting in the evidence directory is an unchecked claim,
  // and "it wasn't referenced" is not a reason to skip it.
  let blobNames;
  try {
    blobNames = fs.readdirSync(blobDir);
  } catch {
    return { rejected: true, reason: 'unreadable-blobs', detail: `Cannot list ${blobDir}.` };
  }
  for (const name of blobNames) {
    if (!HASH.test(name)) {
      return { rejected: true, reason: 'stray-blob', detail: `blobs/${name} is not a sha256 name. Something that is not evidence is in the evidence directory.` };
    }
    const blob = regularFile(path.join(blobDir, name), `blob ${name.slice(0, 12)}`);
    if (blob.rejected) return blob;
    if (sha256Bytes(blob.bytes) !== name) {
      return { rejected: true, reason: 'blob-integrity', detail: `Blob ${name.slice(0, 12)} does not hash to its own name.` };
    }
  }

  if (expectedHead !== null && previous !== expectedHead) {
    return {
      rejected: true,
      reason: 'head-mismatch',
      detail: `The log ends at ${previous.slice(0, 12)} but the receipt pins ${String(expectedHead).slice(0, 12)}. Truncated, or replaced.`,
    };
  }

  return { ok: true, events, runId, head: previous };
}

/** Read one content-addressed blob as JSON, checking its address on the way in. */
function readBlob(directory, id, what = 'blob') {
  if (!HASH.test(String(id || ''))) return { rejected: true, reason: 'bad-address', detail: `${what} address is not a sha256: ${id}` };
  const blob = regularFile(path.join(directory, 'blobs', id), what);
  if (blob.rejected) return blob;
  if (sha256Bytes(blob.bytes) !== id) {
    return { rejected: true, reason: 'blob-integrity', detail: `${what} ${String(id).slice(0, 12)} does not hash to its own address.` };
  }
  try {
    return { ok: true, value: JSON.parse(blob.bytes.toString('utf8')) };
  } catch {
    return { rejected: true, reason: 'blob-not-json', detail: `${what} ${String(id).slice(0, 12)} is not JSON.` };
  }
}

module.exports = { canonicalJson, verifyLedger, readBlob, regularFile, regularDir, sha256Bytes, HASH, ZERO };
