/**
 * Tier 0/1 onboarding items: owner proposes and confirms.
 * Wraps the `upsert_onboarding_items` and `confirm_onboarding_items` RPCs.
 * All deps injected for unit testing.
 */

function firstRow(result) {
  if (!result) return null;
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export async function upsertOnboardingItems({ rpc, tenantId, actorId, items }) {
  const result = await rpc('upsert_onboarding_items', {
    p_org: tenantId,
    p_actor: actorId,
    p_source: 'owner_dashboard',
    p_items: items,
  });
  const row = firstRow(result);
  return row && typeof row.count === 'number' ? row.count : (row ?? 0);
}

export async function confirmOnboardingItems({ rpc, fieldKeys }) {
  const result = await rpc('confirm_onboarding_items', {
    p_field_keys: fieldKeys,
  });
  const row = firstRow(result);
  return row && typeof row.count === 'number' ? row.count : (row ?? 0);
}