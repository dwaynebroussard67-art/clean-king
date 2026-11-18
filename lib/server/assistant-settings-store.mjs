import { DEFAULT_SETTINGS, parseSettings } from '../assistant-settings-schema.mjs';
import { decryptSecret, encryptSecret, lastFour, secretKeyValid } from './secret-box.mjs';

const MAX_VERSION = 2147483647;
const versionIsValid = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_VERSION;
const isSecretName = (name) => name === 'anthropic' || name === 'custom';
const unavailable = () => new Error('settings_store_failed');

export function createSettingsStore({ client, secretKey }) {
  async function rpc(name, args = {}) {
    try {
      const { data, error } = await client.rpc(name, args);
      if (!error) return data;
    } catch {
      // Never propagate raw Supabase diagnostics or request arguments.
    }
    throw unavailable();
  }

  async function firstRow(name, args) {
    const rows = await rpc(name, args);
    if (!Array.isArray(rows) || rows.length > 1) throw unavailable();
    if (rows.length === 0) return null;
    const [row] = rows;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw unavailable();
    return row;
  }

  async function load() {
    const row = await firstRow('get_assistant_settings');
    if (!row) return { settings: structuredClone(DEFAULT_SETTINGS), version: 0 };
    const parsed = parseSettings(row.settings);
    if (!parsed.ok || !versionIsValid(row.version) || row.version === 0) throw unavailable();
    return { settings: parsed.value, version: row.version };
  }

  async function save(settings, expectedVersion) {
    const parsed = parseSettings(settings);
    if (!parsed.ok || !Number.isInteger(expectedVersion) ||
        expectedVersion < -MAX_VERSION - 1 || expectedVersion > MAX_VERSION) {
      return { result: 'invalid', version: (await load()).version };
    }
    const row = await firstRow('save_assistant_settings', {
      p_settings: parsed.value,
      p_expected_version: expectedVersion,
    });
    if (!row || !['ok', 'conflict', 'invalid'].includes(row.result) ||
        !versionIsValid(row.version)) throw unavailable();
    return { result: row.result, version: row.version };
  }

  function readSecret(name) {
    return firstRow('get_assistant_secret', { p_name: name });
  }

  async function status(name) {
    const row = await readSecret(name);
    if (!row) return { set: false, last4: null };
    if (typeof row.ciphertext !== 'string') throw unavailable();
    const last4 = typeof row.last4 === 'string' && Array.from(row.last4).length === 4
      ? row.last4 : null;
    return { set: true, last4 };
  }

  async function secretStatus() {
    const [anthropic, custom] = await Promise.all([status('anthropic'), status('custom')]);
    return { anthropic, custom };
  }

  function requireKey() {
    if (!secretKeyValid(secretKey)) throw new Error('encryption_not_ready');
  }

  async function secretWrite(name, args) {
    const data = await rpc(name, args);
    if (typeof data !== 'boolean') throw unavailable();
    return data;
  }

  async function setSecret(name, plaintext) {
    requireKey();
    if (!isSecretName(name) || typeof plaintext !== 'string') return false;
    return secretWrite('set_assistant_secret', {
      p_name: name,
      p_ciphertext: encryptSecret(plaintext, secretKey),
      p_last4: lastFour(plaintext),
    });
  }

  async function clearSecret(name) {
    if (!isSecretName(name)) return false;
    return secretWrite('clear_assistant_secret', { p_name: name });
  }

  async function getSecretPlain(name) {
    requireKey();
    if (!isSecretName(name)) return null;
    const row = await readSecret(name);
    return row ? decryptSecret(row.ciphertext, secretKey) : null;
  }

  return { load, save, secretStatus, setSecret, clearSecret, getSecretPlain };
}
