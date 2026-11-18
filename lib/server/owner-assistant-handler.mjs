import { buildSystemPrompt } from '../assistant-prompt.mjs';

const MAX_BODY_BYTES = 8192;
const MODEL_NAME = /^[A-Za-z0-9._:/-]{1,100}$/;
const FALLBACK_CODES = new Set(['upstream', 'timeout', 'rate_limit']);
const PROVIDER_CODES = new Set(['config', 'auth', 'rate_limit', 'timeout', 'upstream', 'bad_response', 'blocked_url']);

export function reply(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(status, error) {
  return reply({ error }, status);
}

// A null result denotes an actual stream overflow, even with a missing or understated header.
async function readBodyBytes(request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes.subarray(0, size);
      if (size + value.byteLength > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

export function withOwnerRequest({ env, ownerLoginEnabled, getSessionClient }, operation, {
  expectsJson = true,
  invalidBody = () => fail(400, 'invalid'),
  unavailable = () => fail(503, 'not_configured'),
} = {}) {
  return async function handleOwnerRequest(request) {
    try {
      if (env.OWNER_ASSISTANT_ENABLED !== 'true' || !ownerLoginEnabled()) return fail(503, 'not_configured');
    } catch { return fail(503, 'not_configured'); }

    const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (!env.APP_ORIGIN || request.headers.get('origin') !== env.APP_ORIGIN || mediaType !== 'application/json') {
      return fail(403, 'rejected');
    }
    const declaredLength = request.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
      return fail(413, 'too_large');
    }
    let bytes;
    try { bytes = await readBodyBytes(request); } catch { /* Report malformed input only after authorization. */ }
    if (bytes === null) return fail(413, 'too_large');

    let client, userId;
    try {
      client = await getSessionClient();
      if (!client) return fail(401, 'sign_in');
      const { data, error } = await client.auth.getUser();
      userId = data?.user?.id;
      if (error || typeof userId !== 'string' || !userId) return fail(401, 'sign_in');
    } catch { return fail(401, 'sign_in'); }

    try {
      const { data, error } = await client.from('owner_memberships').select('user_id').eq('user_id', userId).maybeSingle();
      if (error || data?.user_id !== userId) return fail(403, 'not_authorized');
    } catch { return fail(403, 'not_authorized'); }

    if (!bytes) return invalidBody();
    let input;
    if (expectsJson) {
      try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { return invalidBody(); }
    }
    try { return await operation({ client, input }); }
    catch { return unavailable(); }
  };
}

export function hasShape(value, required, optional = []) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

function boundedText(text, max) {
  return typeof text === 'string' && text.length <= max && text.trim() !== '';
}

function parseChat(input) {
  if (!hasShape(input, ['message', 'language'], ['history']) || !['en', 'es'].includes(input.language)
      || !boundedText(input.message, 2500)) return null;
  const history = Object.hasOwn(input, 'history') ? input.history : [];
  if (!Array.isArray(history) || history.length > 6 || history.length % 2 !== 0) return null;
  const messages = [];
  for (const [index, item] of history.entries()) {
    const role = index % 2 === 0 ? 'user' : 'assistant';
    if (!hasShape(item, ['role', 'text']) || item.role !== role || !boundedText(item.text, 1000)) return null;
    messages.push({ role, content: item.text.trim() });
  }
  messages.push({ role: 'user', content: input.message.trim() });
  return { language: input.language, messages };
}

export async function beginAssistantRun({ perMinute, perMonth }, client) {
  const { data, error } = await client.rpc('begin_assistant_run', { p_per_minute: perMinute, p_per_month: perMonth });
  if (error) throw new Error('assistant_run_unavailable');
  return data?.[0];
}

export async function finishAssistantRun(runId, success, client) {
  const { data, error } = await client.rpc('finish_assistant_run', { p_run_id: runId, p_success: success });
  if (error) throw new Error('assistant_run_unavailable');
  return data;
}

export async function withAssistantRun({ beginRun, finishRun }, client, { perMinute, perMonth }, task) {
  const run = await beginRun({ perMinute, perMonth }, client);
  if (run?.result === 'rate_limit' || run?.result === 'monthly_limit') return fail(429, 'rate_limited');
  if (run?.result !== 'ok' || typeof run.run_id !== 'string' || !run.run_id) throw new Error('assistant_run_unavailable');
  let success = false;
  try {
    return await task(() => { success = true; });
  } finally {
    try { await finishRun(run.run_id, success, client); }
    catch { /* The started run still counts against quota. */ }
  }
}

export async function readAssistantSecret(store, name) {
  try { return await store.getSecretPlain(name); }
  catch (error) {
    // Allow an env fallback without encryption only if the DB slot is confirmed empty.
    if (error?.message === 'encryption_not_ready' && (await store.secretStatus())?.[name]?.set === false) return null;
    throw error;
  }
}

function usableKey(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export function allowLocalCustom(env) {
  return env.AI_ALLOW_LOCAL_CUSTOM === 'true' && env.NODE_ENV !== 'production';
}

export async function resolveProvider({ env, validateCustomBaseUrl }, settings, getSecret, provider = settings.provider.active) {
  if (provider !== 'anthropic' && provider !== 'custom') return { code: 'config' };
  const { anthropicModel, customModel, customBaseUrl } = settings.provider;
  const model = provider === 'anthropic' ? anthropicModel : customModel;
  if (typeof model !== 'string' || !MODEL_NAME.test(model)) return { code: 'config' };

  let options = { provider, model };
  if (provider === 'custom') {
    if (!usableKey(customBaseUrl)) return { code: 'config' };
    const allowLocal = allowLocalCustom(env);
    const checked = validateCustomBaseUrl(customBaseUrl, { allowLocal });
    if (!checked.ok) return { code: 'blocked_url' };
    options = { ...options, baseUrl: checked.url, allowLocal };
  }

  let key;
  try { key = await getSecret(provider); }
  catch (error) {
    if (error?.message === 'encryption_not_ready') return { code: 'config' };
    throw error;
  }
  if (provider === 'anthropic' && key === null) key = env.ANTHROPIC_API_KEY;
  if (!usableKey(key)) return { code: 'config' };
  return { options: { ...options, apiKey: key } };
}

export function providerErrorCode(error) {
  return PROVIDER_CODES.has(error?.code) ? error.code : null;
}

export async function requestProvider({ env, callProvider }, options, { system, messages, limits }, previousKeys = []) {
  const secrets = [options.apiKey, env.ANTHROPIC_API_KEY, env.ASSISTANT_SECRET_KEY, ...previousKeys]
    .filter(usableKey).flatMap(key => [key, key.trim()]);
  const containsSecret = value => typeof value === 'string' && secrets.some(key => value.includes(key));
  const outbound = [system, options.model, options.baseUrl, ...messages.map(item => item.content)];
  if (outbound.some(containsSecret)) throw Object.assign(new Error('config'), { code: 'config' });

  const result = await callProvider({
    ...options, system, messages, maxTokens: limits.maxOutputTokens, temperature: limits.temperature,
    // Leave time for quota bookkeeping and a possible second attempt within the route budget.
    timeoutMs: 12000,
  });
  const text = typeof result?.text === 'string' ? result.text.trim() : '';
  if (!text || text.length > 6000 || containsSecret(result.text)) {
    throw Object.assign(new Error('bad_response'), { code: 'bad_response' });
  }
  // Only return the requested provider/model, not arbitrary upstream metadata.
  return { text, provider: options.provider, model: options.model };
}

export function createOwnerAssistantHandler(deps) {
  return withOwnerRequest(deps, async ({ client, input }) => {
    const chat = parseChat(input);
    if (!chat) return fail(400, 'invalid');
    const { settings } = await deps.loadSettings(client);
    if (settings.enabled !== true) return fail(503, 'disabled');

    return withAssistantRun(deps, client, settings.limits, async markSuccess => {
      const getSecret = name => deps.getSecret(name, client);
      const primary = await resolveProvider(deps, settings, getSecret);
      if (!primary.options) return fail(503, 'provider_not_set');

      const { persona, capabilities, limits } = settings;
      const snapshot = await deps.loadSnapshot(client, capabilities);
      const system = buildSystemPrompt({ persona, capabilities }, { language: chat.language, snapshot });
      const prompt = { system, messages: chat.messages, limits };
      let result;
      try { result = await requestProvider(deps, primary.options, prompt); }
      catch (error) {
        if (primary.options.provider !== 'anthropic' || settings.provider.fallbackToCustom !== true
            || !FALLBACK_CODES.has(providerErrorCode(error))) throw error;
        const fallback = await resolveProvider(deps, settings, getSecret, 'custom');
        if (!fallback.options) throw error;
        result = await requestProvider(deps, fallback.options, prompt, [primary.options.apiKey]);
      }
      const response = reply({ answer: result.text, meta: { provider: result.provider, model: result.model } });
      markSuccess();
      return response;
    });
  }, { unavailable: () => fail(503, 'provider_failed') });
}
