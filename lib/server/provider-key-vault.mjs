import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret, decryptSecret, lastFour, generateIV } from './secret-box.mjs';
import { validAnthropicKey, validOpenAICompatibleKey, validBaseURL, PROVIDER_IDS } from '../ai/provider-adapter.js';

/**
 * Provider key vault.
 *
 * Keys are encrypted server-side with AES-256-GCM before storage.
 * The master key (ASSISTANT_SECRET_KEY or a dedicated VAULT_KEY) never leaves the server.
 * The browser sees only: provider id, model name, last 4 chars of key, status.
 */

const VAULT_KEY_ENV = 'PROVIDER_VAULT_KEY'; // Falls back to ASSISTANT_SECRET_KEY

/** Get the master encryption key for the vault. */
function vaultKey() {
  // Prefer a dedicated vault key; fall back to the assistant secret key.
  let key = process.env[PROVIDER_VAULT_KEY_ENV];
  if (!key) key = process.env.ASSISTANT_SECRET_KEY;
  if (!key) return null;
  try {
    const decoded = Buffer.from(key, 'base64');
    if (decoded.length !== 32) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Get a Supabase admin client. */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Save a provider key for a tenant.
 * The key is encrypted before storage. Only lastFour is returned to the caller.
 * @param {string} tenantId
 * @param {object} cfg - { id, apiKey, baseURL?, model }
 * @returns {object} { ok, lastFour?, error? }
 */
export async function saveProviderKey(tenantId, cfg) {
  const client = adminClient();
  const masterKey = vaultKey();
  if (!client || !masterKey) return { ok: false, error: 'Vault not configured.' };
  if (!tenantId) return { ok: false, error: 'No tenant.' };

  // Validate before storing
  if (cfg.id === PROVIDER_IDS.ANTHROPIC && !validAnthropicKey(cfg.apiKey)) {
    return { ok: false, error: 'Invalid Anthropic API key. Must start with sk-ant-.' };
  }
  if (cfg.id === PROVIDER_IDS.OPENAI_COMPATIBLE) {
    if (!validOpenAICompatibleKey(cfg.apiKey)) return { ok: false, error: 'Invalid API key.' };
    if (cfg.baseURL && !validBaseURL(cfg.baseURL)) return { ok: false, error: 'Invalid base URL.' };
  }

  try {
    // Generate a unique IV for this key
    const iv = generateIV();
    // Encrypt the key
    const encryptedKey = encryptSecret(cfg.apiKey, masterKey, iv);
    // Compute last 4 chars of the plaintext key for display
    const lf = lastFour(cfg.apiKey);

    // Store in the tenant_ai_providers table
    const { error } = await client
      .from('tenant_ai_providers')
      .upsert({
        tenant_id: tenantId,
        provider_id: cfg.id,
        model: cfg.model || '',
        encrypted_key: encryptedKey,
        iv: iv,
        last_four: lf,
        status: 'active',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,provider_id',
      });

    if (error) return { ok: false, error: 'Could not save provider key.' };
    return { ok: true, lastFour: lf };
  } catch (err) {
    return { ok: false, error: 'Unexpected error saving key.' };
  }
}

/**
 * Read a decrypted provider key for a tenant. Server-only.
 * @param {string} tenantId
 * @param {string} providerId
 * @returns {object} { ok, apiKey?, error? }
 */
export async function getProviderKey(tenantId, providerId) {
  const client = adminClient();
  const masterKey = vaultKey();
  if (!client || !masterKey) return { ok: false, error: 'Vault not configured.' };

  const { data, error } = await client
    .from('tenant_ai_providers')
    .select('encrypted_key, iv, api_key_plaintext, status')
    .eq('tenant_id', tenantId)
    .eq('provider_id', providerId)
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Provider not found.' };
  if (data.status !== 'active') return { ok: false, error: 'Provider is inactive.' };

  // If we have a plaintext backup (for recently-rotated keys), use it
  if (data.api_key_plaintext) {
    return { ok: true, apiKey: data.api_key_plaintext };
  }

  try {
    const apiKey = decryptSecret(data.encrypted_key, masterKey, data.iv);
    return { ok: true, apiKey };
  } catch {
    return { ok: false, error: 'Could not decrypt key. The vault key may have changed.' };
  }
}

/**
 * Delete a provider key for a tenant.
 * @param {string} tenantId
 * @param {string} providerId
 * @returns {object} { ok, error? }
 */
export async function deleteProviderKey(tenantId, providerId) {
  const client = adminClient();
  if (!client) return { ok: false, error: 'Vault not configured.' };

  const { error } = await client
    .from('tenant_ai_providers')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider_id', providerId);

  if (error) return { ok: false, error: 'Could not delete provider key.' };
  return { ok: true };
}

/**
 * Rotate the vault master key. Re-encrypts all stored keys with the new master.
 * @param {string} newMasterKeyBase64 - 32-byte key as base64
 * @returns {object} { ok, error? }
 */
export async function rotateVaultKey(newMasterKeyBase64) {
  const client = adminClient();
  const newMasterKey = Buffer.from(newMasterKeyBase64, 'base64');
  if (!client || !newMasterKey || newMasterKey.length !== 32) {
    return { ok: false, error: 'Invalid new vault key.' };
  }

  // Get all stored provider keys
  const { data, error } = await client
    .from('tenant_ai_providers')
    .select('tenant_id, provider_id, encrypted_key, iv, api_key_plaintext');

  if (error) return { ok: false, error: 'Could not fetch keys for rotation.' };

  let reencrypted = 0;
  for (const row of (data || [])) {
    try {
      let plaintext;
      if (row.api_key_plaintext) {
        plaintext = row.api_key_plaintext;
      } else {
        try {
          plaintext = decryptSecret(row.encrypted_key, vaultKey(), row.iv);
        } catch {
          continue; // Skip keys we can't decrypt
        }
      }
      const newIv = generateIV();
      const newEncrypted = encryptSecret(plaintext, newMasterKey, newIv);
      await client
        .from('tenant_ai_providers')
        .update({
          encrypted_key: newEncrypted,
          iv: newIv,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', row.tenant_id)
        .eq('provider_id', row.provider_id);
      reencrypted++;
    } catch {
      // Skip failed re-encryptions
    }
  }

  return { ok: true, reencrypted };
}

/**
 * Test a saved provider key by making a real API call.
 * @param {string} tenantId
 * @param {string} providerId
 * @returns {object} { ok, modelName?, error? }
 */
export async function testSavedProviderKey(tenantId, providerId) {
  const keyResult = await getProviderKey(tenantId, providerId);
  if (!keyResult.ok) return { ok: false, error: keyResult.error };

  const client = adminClient();
  if (!client) return { ok: false, error: 'Database not configured.' };

  // Get the provider config
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
