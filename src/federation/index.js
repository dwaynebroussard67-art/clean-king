/**
 * index.js — the Forge Federation facade. One door in.
 *
 * The carrier is deliberately small: a store, a registry, the two rules that
 * decide what a fact is and where it lives, and one door between the two
 * carriers a fact can belong to. Everything that reads it —
 * a browser cockpit, a coding agent, a cron job, a phone — is a NODE, and a
 * node is a registered repository, not a string somebody typed.
 */

'use strict';

const { Federation, FederationError, SCHEMA, SHELVES, WITNESS_KINDS, OUTCOME_REPLICATION, PROMOTION_THRESHOLD, SHARED_REALM, REPO_PREFIX, CARRIERS, DEFAULT_CARRIER, portable, servable, chainHash, GENESIS } = require('./store.js');
const { isCarrier, normalizeCarrier, legacyCarrier, origin, isOrigin } = require('./carrier.js');
const { transfer, transferReference, REFUSALS } = require('./bridge.js');
const { NodeRegistry, SCHEMA: NODE_SCHEMA } = require('./nodes.js');
const {
  SHARED_REALM: REALM_SHARED,
  REPO_PREFIX: REALM_PREFIX,
  isRealm,
  isRepoRealm,
  repoRealm,
  realmSlug,
  sanitizeSlug,
  normalizeRemote,
  ownerRepo,
  repoName,
  slugFromRemote,
} = require('./realm.js');

/**
 * Open a Federation: the carrier plus the registry of repositories that may
 * witness into it.
 *
 * @param {string} dir  where federation.jsonl and nodes.jsonl live
 */
function open(dir, opts = {}) {
  const nodes = new NodeRegistry(dir).load();
  const federation = new Federation(dir, { ...opts, nodes }).load();
  return { federation, nodes };
}

module.exports = {
  open,
  Federation,
  FederationError,
  NodeRegistry,
  SCHEMA,
  NODE_SCHEMA,
  CARRIERS,
  DEFAULT_CARRIER,
  isCarrier,
  normalizeCarrier,
  legacyCarrier,
  origin,
  isOrigin,
  transfer,
  transferReference,
  REFUSALS,
  SHELVES,
  WITNESS_KINDS,
  OUTCOME_REPLICATION,
  PROMOTION_THRESHOLD,
  SHARED_REALM,
  REPO_PREFIX,
  isRealm,
  isRepoRealm,
  repoRealm,
  realmSlug,
  sanitizeSlug,
  normalizeRemote,
  ownerRepo,
  repoName,
  slugFromRemote,
  portable,
  servable,
  chainHash,
  GENESIS,
};
