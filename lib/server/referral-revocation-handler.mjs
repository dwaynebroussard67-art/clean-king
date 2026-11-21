const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The database RPC checks the session's current identity, active status and invitation ownership.
// Do not accept an employee ID or use a service-role client on this path.
export async function revokeReferral(form, { enabled, sessionClient, onRevoked }) {
  try {
    if (!enabled()) return { error: true };
    const id = form?.get('id');
    if (typeof id !== 'string' || !UUID.test(id)) return { error: true };
    const client = await sessionClient();
    if (!client) return { error: true };
    const { data, error } = await client.rpc('revoke_my_referral_invitation', { p_id: id });
    if (error || data !== true) return { error: true };
    // Revalidation is best-effort after the transaction has committed. Never claim that
    // an already-revoked link remains usable if cache invalidation is unavailable.
    try { await onRevoked(); } catch { /* User can refresh to see current status. */ }
    return { revoked: true };
  } catch {
    return { error: true };
  }
}
