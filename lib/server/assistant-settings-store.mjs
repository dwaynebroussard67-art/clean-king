import { DEFAULT_SETTINGS, parseSettings } from '../assistant-settings-schema.mjs';
import { decryptSecret, encryptSecret, lastFour, secretKeyValid } from './secret-box.mjs';

const SECRET_NAMES = new Set(['anthropic', 'custom']);

export function createSettingsStore({ client, secretKey, ownerId }) {
  if (!client || typeof client.rpc !== 'function' || typeof ownerId !== 'string') {
    throw new Error('settings_store_not_configured');
  }

  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error('settings_store_failed');
    return data;
  }

  return {
    async load() {
      const rows = await rpc('get_assistant_settings', { p_owner_id: ownerId });
      const row = firstRow(rows);
      if (!row) return { settings: cloneDefaults(), version: 0 };
      const parsed = parseSettings(row.settings);
      if (!parsed.ok || !Number.isSafeInteger(row.version) || row.version < 1) {
        throw new Error('settings_load_failed');
      }
      return { settings: parsed.value, version: row.version };
    },

    async save(settings, expectedVersion) {
      const parsed = parseSettings(settings);
      if (!parsed.ok || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        return { result: 'invalid', version: expectedVersion };
      }
      const rows = await rpc('save_assistant_settings', {
        p_owner_id: ownerId,
        p_settings: parsed.value,
        p_expected_version: expectedVersion,
      });
      const row = firstRow(rows);
      if (!row || !['ok', 'conflict', 'invalid'].includes(row.result) ||
          !Number.isSafeInteger(row.version)) throw new Error('settings_store_failed');
      return { result: row.result, version: row.version };
    },

    async secretStatus() {
      const status = {};
      for (const name of SECRET_NAMES) {
        const rows = await rpc('get_assistant_secret', { p_owner_id: ownerId, p_name: name });
        const row = firstRow(rows);
        status[name] = {
          set: Boolean(row?.ciphertext),
          last4: row?.last4 ?? null,
        };
      }
      return status;
    },

    async setSecret(name, plaintext) {
      requireSecretKey();
      if (!SECRET_NAMES.has(name) || typeof plaintext !== 'string' ||
          plaintext.length < 8 || plaintext.length > 400) return false;
      const ciphertext = encryptSecret(plaintext, secretKey);
      return await rpc('set_assistant_secret', {
        p_owner_id: ownerId,
        p_name: name,
        p_ciphertext: ciphertext,
        p_last4: lastFour(plaintext),
      }) === true;
    },

    async clearSecret(name) {
      if (!SECRET_NAMES.has(name)) return false;
      return await rpc('clear_assistant_secret', { p_owner_id: ownerId, p_name: name }) === true;
    },

    async getSecretPlain(name) {
      if (!SECRET_NAMES.has(name)) return null;
      requireSecretKey();
      const rows = await rpc('get_assistant_secret', { p_owner_id: ownerId, p_name: name });
      const row = firstRow(rows);
      if (!row?.ciphertext) return null;
      return decryptSecret(row.ciphertext, secretKey);
    },
  };

  function requireSecretKey() {
    if (!secretKeyValid(secretKey)) throw new Error('encryption_not_ready');
  }
}

function firstRow(rows) {
  if (Array.isArray(rows)) return rows[0] ?? null;
  return rows && typeof rows === 'object' ? rows : null;
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}
