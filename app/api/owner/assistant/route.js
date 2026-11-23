import { createBubblesHandler } from '../../../../lib/server/bubbles-handler.mjs';
import { sessionClient, adminClient } from '../../../../lib/server/supabase.js';
import { createProviderKeyVault } from '../../../../lib/server/provider-key-vault.mjs';
import { keyringFromEnv } from '../../../../lib/server/envelope-vault.mjs';
import { loadSnapshot } from '../../../../lib/server/assistant-snapshot.mjs';
import { createSettingsStore } from '../../../../lib/server/assistant-settings-store.mjs';
import { buildSystemPrompt } from '../../../../lib/assistant-prompt.mjs';
import { settingsForPrompt } from '../../../../lib/assistant-settings-schema.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const env = process.env;

/**
 * Get the current tenant/organization for the authenticated user.
 * Uses the owner_memberships table to find the user's franchise.
 */
async function getTenantId(session, user) {
  if (!session || !user) return null;
  const { data: memberships } = await session
    .from('owner_memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1);
  if (memberships?.length > 0) {
    return memberships[0].organization_id;
  }
  return null;
}

/**
 * Load assistant settings for the tenant.
 */
async function loadSettings(session, user, tenantId) {
  const store = createSettingsStore({
    client: session,
    secretKey: env.ASSISTANT_SECRET_KEY,
  });
  const loaded = await store.load();
  return loaded?.settings ?? loaded;
}

/** Service-role RPC caller for vault and budget operations. */
function makeRpc() {
  const admin = adminClient();
  if (!admin) return null;
  return async (name, args) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(`rpc_failed:${name}:${error.message}`);
    return data;
  };
}

/** Provider key vault instance (write-only; plaintext never leaves the server). */
const providerKeys = (() => {
  const keyring = keyringFromEnv(env);
  if (!keyring) return null;
  const rpc = makeRpc();
  if (!rpc) return null;
  return createProviderKeyVault({ keyring, rpc });
})();

/**
 * Create the Bubbles handler with all dependencies.
 */
const handle = createBubblesHandler({
  env,
  getSessionClient: sessionClient,
  getTenantId,
  loadSettings,
  loadSnapshot,
  buildSystemPrompt: (settings, language, snapshot) =>
    buildSystemPrompt(settingsForPrompt(settings), { language, snapshot }),
  providerKeys,
  rpc: makeRpc(),
});

export const POST = (request) => handle(request);
