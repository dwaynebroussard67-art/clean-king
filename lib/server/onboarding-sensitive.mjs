/**
 * Tier 2 sensitive onboarding items: store, reveal, revoke.
 * Wraps onboarding-vault-handler.mjs and the vault_delete RPC.
 * All deps injected for unit testing.
 */

import { storeAsOwner, reveal as revealValue } from '../server/onboarding-vault-handler.mjs';

function firstRow(result) {
  if (!result) return null;
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

/** Store an owner-typed tier-2 secret. */
export async function storeSensitiveItem({ rpc, keyring, orgId, actorId, subjectKey, fieldKey, value }) {
  return storeAsOwner({ orgId, actorId, subjectKey, fieldKey, value }, { rpc, keyring });
}

/** Reveal a tier-2 secret (step-up gated by the handler). */
export async function revealSensitiveItem({ rpc, keyring, orgId, actorId, itemId, reason, stepUpAt, now }) {
  return revealValue({ orgId, actorId, itemId, reason, stepUpAt }, { rpc, keyring, now });
}

/** Revoke (delete) a tier-2 sensitive item. Owner-gated via vault_delete RPC. */
export async function deleteSensitiveItem({ rpc, orgId, actorId, itemId, reason }) {
  const result = await rpc('vault_delete', {
    p_org: orgId,
    p_actor: actorId,
    p_item: itemId,
    p_reason: reason,
  });
  const row = firstRow(result);
  return row && row.ok === true;
}