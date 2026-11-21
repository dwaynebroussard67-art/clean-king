/**
 * Provider adapter interface and implementations.
 *
 * Slots:
 *   A: Anthropic (Claude models via Anthropic API)
 *   B: OpenAI-compatible (OpenRouter, Ollama, any compatible endpoint)
 *   C: No key → Bubbles Lite (deterministic engine, see bubbles-lite.js)
 *
 * Every adapter implements:
 *   { id, testConnection(cfg), complete({system, messages, tools, maxTokens, signal}), capabilities() }
 */

export const PROVIDER_IDS = {
  ANTHROPIC: 'anthropic',
  OPENAI_COMPATIBLE: 'openai_compatible',
  LITE: 'lite',
};

/** Validate an Anthropic-style API key (starts with 'sk-ant'). */
export function validAnthropicKey(key) {
  return typeof key === 'string' && key.startsWith('sk-ant-') && key.length > 20;
}

/** Validate an OpenAI-compatible key (non-empty). */
export function validOpenAICompatibleKey(key) {
  return typeof key === 'string' && key.length > 0;
}

/** Validate a base URL for the openai_compatible slot. */
export function validBaseURL(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Capabilities a provider advertises. */
export function capabilities(caps) {
  return {
    tools: caps.tools ?? false,
    jsonMode: caps.jsonMode ?? false,
    maxContext: caps.maxContext ?? 200000,
    models: caps.models ?? [],
  };
}

// ---------------------------------------------------------------------------
// Slot A: Anthropic
// ---------------------------------------------------------------------------

export async function anthropicTestConnection({ apiKey, model }) {
  if (!validAnthropicKey(apiKey)) return { ok: false, error: 'Invalid API key format.' };
  try {
    const resp = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-12-01',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: body.error?.message || `HTTP ${resp.status}` };
    }
    const { data } = await resp.json();
    const modelName = model || 'claude-sonnet-5-5';
    const found = data?.find(m => m.id === modelName);
    return { ok: true, modelName: found?.id || modelName };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Connection timed out.' : err.message };
  }
}

export async function anthropicComplete({ apiKey, model, system, messages, maxTokens, signal, tools }) {
  if (!validAnthropicKey(apiKey)) throw new Error('Invalid API key.');
  const modelName = model || 'claude-sonnet-5-5';
  const body = {
    model: modelName,
    max_tokens: maxTokens || 4096,
    system: system || '',
    messages,
    temperature: 0.7,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-12-01',
    },
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const message = errBody.error?.message || `HTTP ${resp.status}`;
    // Classify the error
    if (resp.status === 401) throw new Error('AUTH_FAILED');
    if (resp.status === 429) throw new Error('RATE_LIMITED');
    if (resp.status >= 500) throw new Error('UPSTREAM_ERROR');
    throw new Error(message);
  }

  const json = await resp.json();
  const text = json.content?.[0]?.text || '';
  const usage = json.usage?.input_tokens
    ? { input: json.usage.input_tokens, output: json.usage.output_tokens, cacheRead: json.usage.cache_creation_input_tokens ?? 0 }
    : { input: 0, output: 0, cacheRead: 0 };

  return { text, usage };
}

// ---------------------------------------------------------------------------
// Slot B: OpenAI-compatible
// ---------------------------------------------------------------------------

export async function openAICompatibleTestConnection({ apiKey, baseURL, model }) {
  if (!validOpenAICompatibleKey(apiKey)) return { ok: false, error: 'Invalid API key.' };
  if (!validBaseURL(baseURL)) return { ok: false, error: 'Invalid base URL.' };
  try {
    const resp = await fetch(`${baseURL}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.status === 404) {
      // Some providers don't expose /models; try a minimal chat call instead
      return openaicompatibleTinyProbe({ apiKey, baseURL, model });
    }
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: body.error?.message || `HTTP ${resp.status}` };
    }
    return { ok: true, modelName: model || 'gpt-4o' };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Connection timed out.' : err.message };
  }
}

async function openaicompatibleTinyProbe({ apiKey, baseURL, model }) {
  try {
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: 'OK' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: body.error?.message || `HTTP ${resp.status}` };
    }
    return { ok: true, modelName: model || 'gpt-4o' };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Connection timed out.' : err.message };
  }
}

export async function openAICompatibleComplete({ apiKey, baseURL, model, system, messages, maxTokens, signal }) {
  if (!validOpenAICompatibleKey(apiKey)) throw new Error('Invalid API key.');
  if (!validBaseURL(baseURL)) throw new Error('Invalid base URL.');

  const modelName = model || 'gpt-4o';
  const body = {
    model: modelName,
    max_tokens: maxTokens || 4096,
    temperature: 0.7,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
  };

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const message = errBody.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 401) throw new Error('AUTH_FAILED');
    if (resp.status === 429) throw new Error('RATE_LIMITED');
    if (resp.status >= 500) throw new Error('UPSTREAM_ERROR');
    throw new Error(message);
  }

  const json = await resp.json();
  const text = json.choices?.[0]?.message?.content || '';
  const usage = json.usage
    ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens, cacheRead: 0 }
    : { input: 0, output: 0, cacheRead: 0 };

  return { text, usage };
}

// ---------------------------------------------------------------------------
// Unified provider router
// ---------------------------------------------------------------------------

/**
 * Provider config saved per tenant.
 * { id: 'anthropic' | 'openai_compatible', apiKey, baseURL?, model, lastFour, status }
 */
export function providerSummary(cfg) {
  if (!cfg) return null;
  return {
    id: cfg.id,
    model: cfg.model || '',
    lastFour: cfg.lastFour || '',
    status: cfg.status === 'active' ? 'active' : 'inactive',
  };
}

/**
 * Execute a completion through the configured provider.
 * Throws with classified error codes: AUTH_FAILED, RATE_LIMITED, UPSTREAM_ERROR, INVALID_CONFIG.
 */
export async function completeThroughProvider(cfg, { system, messages, maxTokens, signal, tools }) {
  if (!cfg || cfg.status !== 'active') {
    throw new Error('INVALID_CONFIG');
  }

  if (cfg.id === PROVIDER_IDS.ANTHROPIC) {
    return anthropicComplete({
      apiKey: cfg.apiKey,
      model: cfg.model,
      system,
      messages,
      maxTokens,
      signal,
      tools,
    });
  }

  if (cfg.id === PROVIDER_IDS.OPENAI_COMPATIBLE) {
    return openAICompatibleComplete({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
      system,
      messages,
      maxTokens,
      signal,
    });
  }

  throw new Error('INVALID_CONFIG');
}

/**
 * Test a provider configuration. Returns { ok, modelName?, error? }.
 */
export async function testProvider(cfg) {
  if (cfg.id === PROVIDER_IDS.ANTHROPIC) {
    return anthropicTestConnection({ apiKey: cfg.apiKey, model: cfg.model });
  }
  if (cfg.id === PROVIDER_IDS.OPENAI_COMPATIBLE) {
    return openAICompatibleTestConnection({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model });
  }
  return { ok: false, error: 'Unknown provider.' };
}
