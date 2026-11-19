import 'server-only';
import { createSettingsStore } from './assistant-settings-store.mjs';
import { adminClient, ownerLoginEnabled, sessionClient } from './supabase.js';

export async function getAuthorizedAssistantContext() {
  if (!ownerLoginEnabled()) return null;
  const session = await sessionClient();
  if (!session) return null;

  const { data, error } = await session.auth.getUser();
  const user = data?.user;
  if (error || !user?.id) return null;

  const { data: membership, error: membershipError } = await session
    .from('owner_memberships')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (membershipError || !membership) return null;

  const serviceClient = adminClient();
  if (!serviceClient) return null;

  return {
    user,
    store: createSettingsStore({
      client: serviceClient,
      secretKey: process.env.ASSISTANT_SECRET_KEY,
      ownerId: user.id,
    }),
  };
}
