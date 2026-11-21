import { DEFAULT_SETTINGS, parseSettings } from '../assistant-settings-schema.mjs';
import { decryptSecret, encryptSecret, lastFour, secretKeyValid } from './secret-box.mjs';

const MAX_VERSION = 2147483647;
const SECRET_NAMES = new Set(['anthropic', 'custom']);
const unavailable = () => new Error('settings_store_failed');

export function createSettingsStore({ client, secretKey }) {
  if (!client || typeof client.rpc !== 'function') {
    throw new Error('settings_store_not_configured');
  }

  async function rpc(name, args) {
    try {
      const { data, error } = await client.rpc(name, args);
      if (!error) return data;
    } catch {
      // Do not expose database diagnostics or RPC arguments to the caller.
    }
    throw unavailable();
  }

  async function rows(name, args) {
    const value = await rpc(name, args);
    if (!Array.isArray(value) || value.length > 1) throw unavailable();
    if (!value.length) return null;
    const [row] = value;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw unavailable();
    return row;
  }

  async function load() {
    const row = await rows('get_assistant_settings', {});
    if (!row) return { settings: structuredClone(DEFAULT_SETTINGS), version: 0 };
    const parsed = parseSettings(row.settings);
    if (!parsed.ok || !Number.isInteger(row.version) || row.version < 1 || row.version > MAX_VERSION) {
      throw unavailable();
    }
    return { settings: parsed.value, version: row.version };
  }

  async function save(settings, expectedVersion) {
    const parsed = parseSettings(settings);
    if (!parsed.ok || !Number.isInteger(expectedVersion) || expectedVersion < 0 || expectedVersion > MAX_VERSION) {
      return { result: 'invalid', version: (await load()).version };
    }
    const row = await rows('save_assistant_settings', {
      p_settings: parsed.value,
      p_expected_version: expectedVersion,
    });
    if (!row || !['ok', 'conflict', 'invalid'].includes(row.result) ||
        !Number.isInteger(row.version) || row.version < 0 || row.version > MAX_VERSION) throw unavailable();
    return { result: row.result, version: row.version };
  }

  async function readSecret(name) {
    return rows('get_assistant_secret', { p_name: name });
  }

  async function secretStatus() {
    const status = {};
    for (const name of SECRET_NAMES) {
      const row = await readSecret(name);
      if (!row) {
        status[name] = { set: false, last4: null };
        continue;
      }
      if (typeof row.ciphertext !== 'string') throw unavailable();
      const last4 = typeof row.last4 === 'string' && Array.from(row.last4).length === 4
        ? row.last4 : null;
      status[name] = { set: true, last4 };
    }
    return status;
  }

  function requireSecretKey() {
    if (!secretKeyValid(secretKey)) throw new Error('encryption_not_ready');
  }

  async function setSecret(name, plaintext) {
    requireSecretKey();
    if (!SECRET_NAMES.has(name) || typeof plaintext !== 'string' ||
        plaintext.length < 8 || plaintext.length > 400) return false;
    const data = await rpc('set_assistant_secret', {
      p_name: name,
      p_ciphertext: encryptSecret(plaintext, secretKey),
      p_last4: lastFour(plaintext),
    });
    if (typeof data !== 'boolean') throw unavailable();
    return data;
  }

  async function clearSecret(name) {
    if (!SECRET_NAMES.has(name)) return false;
    const data = await rpc('clear_assistant_secret', { p_name: name });
    if (typeof data !== 'boolean') throw unavailable();
    return data;
  }

  async function getSecretPlain(name) {
    if (!SECRET_NAMES.has(name)) return null;
    requireSecretKey();
    const row = await readSecret(name);
    return row ? decryptSecret(row.ciphertext, secretKey) : null;
  }

  return { load, save, secretStatus, setSecret, clearSecret, getSecretPlain };
}
