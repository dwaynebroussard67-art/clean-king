import { createClient } from '@supabase/supabase-js';
import { createKeyring, seal, open, keyringFromEnv } from './envelope-vault.mjs';
import { validAnthropicKey, validOpenAICompatibleKey, PROVIDER_IDS } from '../ai/provider-adapter.js';
import { validateCustomBaseUrl } from '../ai/url-guard.mjs';
import { requestPinnedProvider } from './provider-url.mjs';

/**
 * Provider key vault — envelope encryption for AI provider keys.
 *
 * One vault, one rotation story, one audit trail. Uses the same envelope-vault
 * pattern as Tier-2 onboarding data: a master KEK from the environment wraps
 * a per-franchise DEK, and each provider key is sealed with AAD binding so a
 * ciphertext cannot be moved to another franchise or provider.
 *
 * The key is write-only. Nothing returns plaintext to a browser; the UI sees
 * only provider id, model name, last4, and status.
 *
 * Injected dependencies (keyring, rpc) so tests need no Supabase.
 */

/** Get a Supabase admin client (service role). */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Build a provider-key-vault module with injected deps. */
export function createProviderKeyVault({ keyring, rpc }) {
  if (!keyring) throw new Error('vault_keyring_required');

  /** Validate a provider key before sealing. */
  function validateKey(providerId, apiKey, baseURL) {
    if (providerId === PROVIDER_IDS.ANTHROPIC) {
      if (!validAnthropicKey(apiKey)) {
        throw new Error('invalid_anthropic_key');
      }
    } else if (providerId === PROVIDER_IDS.OPENAI_COMPATIBLE) {
      if (!validOpenAICompatibleKey(apiKey)) {
        throw new Error('invalid_openai_key');
      }
      if (baseURL) {
        const safe = validateCustomBaseUrl(baseURL);
        if (!safe.ok) throw new Error('blocked_base_url');
      }
    } else {
      throw new Error('unknown_provider');
    }
  }

  /** Seal a plaintext API key for a tenant+provider. */
  function sealKey(tenantId, providerId, apiKey) {
    const ctx = {
      orgId: tenantId,
      subjectKey: `provider:${providerId}`,
      fieldKey: 'api_key',
    };
    return seal(apiKey, ctx, keyring.get(keyring.current));
  }

  /** Open a sealed ciphertext for a tenant+provider. */
  function openKey(tenantId, providerId, ciphertext, dekVersion) {
    const ctx = {
      orgId: tenantId,
      subjectKey: `provider:${providerId}`,
      fieldKey: 'api_key',
    };
    return open(ciphertext, ctx, keyring.get(dekVersion || keyring.current));
  }

  /** Save a provider key for a tenant via RPC. */
  async function saveProviderKey(tenantId, actorId, cfg) {
    if (!tenantId) return { ok: false, error: 'No tenant.' };
    if (!actorId) return { ok: false, error: 'No actor.' };

    let validationError;
    try { validateKey(cfg.id, cfg.apiKey, cfg.baseURL); }
    catch (err) { validationError = err.message; }
    if (validationError) return { ok: false, error: validationError };

    const ciphertext = sealKey(tenantId, cfg.id, cfg.apiKey);
    const lf = cfg.apiKey.length >= 8 ? cfg.apiKey.slice(-4) : null;

    const { error } = await rpc('save_provider_key', {
      p_tenant: tenantId,
      p_actor: actorId,
      p_provider: cfg.id,
      p_model: cfg.model || '',
      p_base_url: cfg.baseURL || null,
      p_ciphertext: ciphertext,
      p_last_four: lf,
      p_key_version: keyring.current,
    });

    if (error) return { ok: false, error };
    return { ok: true, lastFour: lf };
  }

  /** Read a decrypted provider key for a tenant via RPC. Server-only. */
  async function getProviderKey(tenantId, providerId) {
    if (!tenantId) return { ok: false, error: 'No tenant.' };

    const { data, error } = await rpc('get_provider_key_ciphertext', {
      p_tenant: tenantId,
      p_provider: providerId,
    });

    if (error || !data || data.length === 0) {
      return { ok: false, error: 'Provider not found.' };
    }

    const row = data[0];
    if (row.status !== 'active') {
      return { ok: false, error: 'Provider is inactive.' };
    }

    try {
      const apiKey = openKey(tenantId, providerId, row.ciphertext, row.key_version);
      return { ok: true, apiKey };
    } catch {
      return { ok: false, error: 'Could not decrypt key. The vault key may have changed.' };
    }
  }

  /** Delete a provider key for a tenant via RPC. */
  async function deleteProviderKey(tenantId, actorId, providerId) {
    if (!tenantId) return { ok: false, error: 'No tenant.' };
    if (!actorId) return { ok: false, error: 'No actor.' };

    const { error } = await rpc('delete_provider_key', {
      p_tenant: tenantId,
      p_actor: actorId,
      p_provider: providerId,
    });

    if (error) return { ok: false, error };
    return { ok: true };
  }

  /** Test a saved provider key by making a real API call. */
  async function testSavedProviderKey(tenantId, providerId) {
    const keyResult = await getProviderKey(tenantId, providerId);
    if (!keyResult.ok) return { ok: false, error: keyResult.error };

    const client = adminClient();
    if (!client) return { ok: false, error: 'Database not configured.' };

    const { data: cfg } = await client
      .from('tenant_ai_providers')
      .select('id, model, base_url')
      .eq('tenant_id', tenantId)
      .eq('provider_id', providerId)
      .maybeSingle();

    if (!cfg) return { ok: false, error: 'Provider not found.' };

    const testCfg = {
      id: cfg.id,
      apiKey: keyResult.apiKey,
      model: cfg.model,
      baseURL: cfg.base_url,
    };

    return testProvider(testCfg);
  }

  return {
    saveProviderKey,
    getProviderKey,
    deleteProviderKey,
    testSavedProviderKey,
    sealKey,
    openKey,
    validateKey,
  };
}

/** Default module instance using env-based keyring and Supabase RPC. */
const keyring = keyringFromEnv();
const admin = adminClient();
const rpc = admin
  ? async (name, args) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error(`rpc_failed:${name}`);
      return data;
    }
  : null;

export const providerKeyVault = keyring && rpc
  ? createProviderKeyVault({ keyring, rpc })
  : null;

/** Convenience exports for direct use (deprecated; use createProviderKeyVault). */
export async function saveProviderKey(tenantId, cfg) {
  if (!providerKeyVault) return { ok: false, error: 'Vault not configured.' };
  // actorId is not available in the old signature; use a placeholder.
  return providerKeyVault.saveProviderKey(tenantId, 'system', cfg);
}
export async function getProviderKey(tenantId, providerId) {
  if (!providerKeyVault) return { ok: false, error: 'Vault not configured.' };
  return providerKeyVault.getProviderKey(tenantId, providerId);
}
export async function deleteProviderKey(tenantId, providerId) {
  if (!providerKeyVault) return { ok: false, error: 'Vault not configured.' };
  return providerKeyVault.deleteProviderKey(tenantId, 'system', providerId);
}
export async function testSavedProviderKey(tenantId, providerId) {
  if (!providerKeyVault) return { ok: false, error: 'Vault not configured.' };
  return providerKeyVault.testSavedProviderKey(tenantId, providerId);
}