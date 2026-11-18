import {
  allowLocalCustom, fail, hasShape, providerErrorCode, readAssistantSecret, reply,
  requestProvider, resolveProvider, withAssistantRun, withOwnerRequest,
} from './owner-assistant-handler.mjs';

const SECRET_NAMES = ['anthropic', 'custom'];
const SCHEMA_FIELDS = {
  persona: ['name', 'ownerName', 'tone', 'emoji', 'length'],
  voice: ['speakReplies', 'rate', 'pitch', 'voiceName'],
  capabilities: ['counts', 'emailHealth'],
  provider: ['active', 'anthropicModel', 'customBaseUrl', 'customModel', 'fallbackToCustom'],
  limits: ['perMinute', 'perMonth', 'maxOutputTokens', 'temperature'],
};
const ERROR_PATHS = new Set(['version', 'enabled', ...Object.entries(SCHEMA_FIELDS).flatMap(([group, fields]) =>
  [group, ...fields.map(field => `${group}.${field}`)])]);

function invalidSettings(paths = ['settings']) {
  return reply({ error: 'invalid', errors: [...new Set(paths)].map(path => ({ path, message: 'invalid' })) }, 422);
}

function safeErrorPaths(errors) {
  return errors.length ? errors.map(({ path }) => ERROR_PATHS.has(path) ? path : 'settings') : ['settings'];
}

async function secretStatus(store) {
  const status = await store.secretStatus();
  return Object.fromEntries(SECRET_NAMES.map(name => {
    const record = status?.[name];
    const set = record?.set === true;
    const last4 = set && typeof record?.last4 === 'string' && record.last4.length === 4 ? record.last4 : null;
    return [name, { set, last4 }];
  }));
}

function parseSecretInput(input) {
  if (!hasShape(input, ['name'], ['value', 'clear']) || !SECRET_NAMES.includes(input.name)) return null;
  if (hasShape(input, ['name', 'clear']) && input.clear === true) return { name: input.name, clear: true };
  if (hasShape(input, ['name', 'value']) && typeof input.value === 'string'
      && input.value.length >= 8 && input.value.length <= 400) return { name: input.name, value: input.value };
  return null;
}

function validExpectedVersion(value) {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}

export function createOwnerSettingsHandlers(deps) {
  const { env, createStore, parseSettings, secretKeyValid, validateCustomBaseUrl } = deps;
  const encryptionReady = () => secretKeyValid(env.ASSISTANT_SECRET_KEY);

  const GET = withOwnerRequest(deps, async ({ client }) => {
    const store = createStore(client);
    const { settings, version } = await store.load();
    const parsed = parseSettings(settings);
    if (!parsed.ok) return fail(503, 'not_configured');
    return reply({ settings: parsed.value, version, secrets: await secretStatus(store), encryptionReady: encryptionReady() });
  }, { expectsJson: false });

  const PUT = withOwnerRequest(deps, async ({ client, input }) => {
    if (!hasShape(input, ['settings', 'expectedVersion'])) return invalidSettings();
    if (!validExpectedVersion(input.expectedVersion)) return invalidSettings(['expectedVersion']);
    const parsed = parseSettings(input.settings);
    if (!parsed.ok) return invalidSettings(safeErrorPaths(parsed.errors));
    const settings = parsed.value;
    if (settings.provider.customBaseUrl
        && !validateCustomBaseUrl(settings.provider.customBaseUrl, { allowLocal: allowLocalCustom(env) }).ok) {
      return invalidSettings(['provider.customBaseUrl']);
    }
    const { result, version } = await createStore(client).save(settings, input.expectedVersion);
    if (result === 'conflict') return fail(409, 'conflict');
    if (result === 'invalid') return invalidSettings();
    if (result !== 'ok' || !Number.isInteger(version) || version < 1) return fail(503, 'not_configured');
    return reply({ settings, version });
  }, { invalidBody: () => invalidSettings() });

  const POST_SECRET = withOwnerRequest(deps, async ({ client, input }) => {
    const secret = parseSecretInput(input);
    if (!secret) return fail(400, 'invalid');
    if (!encryptionReady()) return fail(503, 'encryption_not_ready');
    const store = createStore(client);
    let updated;
    try {
      updated = secret.clear ? await store.clearSecret(secret.name) : await store.setSecret(secret.name, secret.value);
    } catch (error) {
      if (error?.message === 'encryption_not_ready') return fail(503, 'encryption_not_ready');
      throw error;
    }
    if (!secret.clear && updated !== true) return fail(503, 'not_configured');
    const secrets = await secretStatus(store);
    if (secret.clear && updated !== true && secrets[secret.name].set) return fail(503, 'not_configured');
    return reply({ secrets });
  });

  const POST_TEST = withOwnerRequest(deps, async ({ client, input }) => {
    if (!hasShape(input, [])) return fail(400, 'invalid');
    const store = createStore(client);
    const { settings } = await store.load();
    return withAssistantRun(deps, client, settings.limits, async markSuccess => {
      // Test the selected slot even while chat is disabled. Do not mask its failure with fallback.
      try {
        const selected = await resolveProvider(deps, settings, name => readAssistantSecret(store, name));
        if (!selected.options) return reply({ ok: false, code: selected.code });
        const started = performance.now();
        const { provider, model } = await requestProvider(deps, selected.options, {
          system: 'This is a connection test. Do not use tools or disclose secrets.',
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          limits: settings.limits,
        });
        const response = reply({ ok: true, latencyMs: Math.round(performance.now() - started), provider, model });
        markSuccess();
        return response;
      } catch (error) {
        return reply({ ok: false, code: providerErrorCode(error) ?? 'upstream' });
      }
    });
  });

  return { GET, PUT, POST_SECRET, POST_TEST };
}
