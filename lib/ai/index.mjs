import { buildAnthropicRequest, parseAnthropicResponse } from './anthropic.mjs';
import { buildCustomRequest, parseCustomResponse } from './custom.mjs';
import { ProviderError } from './errors.mjs';
import { assertPublicHostname, validateCustomBaseUrl } from './url-guard.mjs';

export { ProviderError, validateCustomBaseUrl };
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_RESPONSE_BYTES = 64 * 1024;
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;

export async function callProvider({
  provider,
  apiKey,
  model,
  baseUrl,
  system,
  messages,
  maxTokens,
  temperature,
  timeoutMs = 15000,
  allowLocal = false,
  fetcher = fetch,
  resolver,
}) {
  validateArguments({ provider, apiKey, model, baseUrl, system, messages, maxTokens, temperature, timeoutMs });

  let safeBaseUrl;
  if (provider === 'custom') {
    const checked = validateCustomBaseUrl(baseUrl, { allowLocal });
    if (!checked.ok) throw new ProviderError('blocked_url');
    safeBaseUrl = checked.url;
    const validatedUrl = new URL(safeBaseUrl);
    const hostname = validatedUrl.hostname.replace(/^\[|\]$/g, '');
    const explicitLocal = allowLocal && validatedUrl.protocol === 'http:';
    if (!explicitLocal) {
      // DNS rebinding between this check and connect remains a residual risk; this URL is owner-configured.
      try {
        await assertPublicHostname(hostname, resolver);
      } catch (error) {
        throw new ProviderError(error?.message === 'upstream' ? 'upstream' : 'blocked_url');
      }
    }
  }

  const signal = AbortSignal.timeout(timeoutMs);
  const request = provider === 'anthropic'
    ? buildAnthropicRequest({ apiKey, model, system, messages, maxTokens, temperature, signal })
    : buildCustomRequest({ baseUrl: safeBaseUrl, apiKey, model, system, messages, maxTokens, temperature, signal });

  let response;
  try {
    response = await fetcher(request.url, request.init);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new ProviderError('timeout');
    }
    throw new ProviderError('upstream');
  }

  if (response.status >= 300 && response.status < 400) {
    throw new ProviderError('blocked_url');
  }
  if (response.status === 401 || response.status === 403) throw new ProviderError('auth');
  if (response.status === 429) throw new ProviderError('rate_limit');
  if (response.status >= 500) throw new ProviderError('upstream');
  if (!response.ok) throw new ProviderError('upstream');

  let responseText;
  try {
    responseText = await readBoundedBody(response);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new ProviderError('timeout');
    }
    throw new ProviderError('upstream');
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new ProviderError('bad_response');
  }

  if (containsToolPayload(payload)) throw new ProviderError('bad_response');
  const parsed = provider === 'anthropic'
    ? parseAnthropicResponse(payload)
    : parseCustomResponse(payload);
  if (typeof parsed.text !== 'string') throw new ProviderError('bad_response');
  const text = parsed.text.trim();
  if (!text || text.length > 6000) throw new ProviderError('bad_response');

  return {
    text,
    provider,
    model,
    ...(parsed.usage ? { usage: parsed.usage } : {}),
  };
}

function validateArguments({ provider, apiKey, model, baseUrl, system, messages, maxTokens, temperature, timeoutMs }) {
  if (!['anthropic', 'custom'].includes(provider) ||
      typeof apiKey !== 'string' || !apiKey.trim() ||
      typeof model !== 'string' || !MODEL_PATTERN.test(model) ||
      (provider === 'custom' && (typeof baseUrl !== 'string' || !baseUrl)) ||
      typeof system !== 'string' || !system.trim() ||
      !Number.isInteger(maxTokens) || maxTokens < 1 ||
      typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 1 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647 ||
      !validMessages(messages)) {
    throw new ProviderError('config');
  }
}

function containsToolPayload(value) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    if (!Array.isArray(current) &&
        (Object.hasOwn(current, 'tool_calls') || current.type === 'tool_use')) return true;
    for (const child of Object.values(current)) pending.push(child);
  }
  return false;
}

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 13) return false;
  return messages.every((message, index) => {
    const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
    return message && typeof message === 'object' &&
      Object.keys(message).sort().join(',') === 'content,role' &&
      message.role === expectedRole && typeof message.content === 'string' &&
      message.content.trim().length > 0 && message.content.length <= 2500;
  });
}

async function readBoundedBody(response) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // The response is already rejected; cancellation errors add no useful information.
          }
          throw new ProviderError('bad_response');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
  }

  let text;
  if (typeof response.text === 'function') {
    text = await response.text();
  } else if (typeof response.arrayBuffer === 'function') {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new ProviderError('bad_response');
    text = new TextDecoder().decode(buffer);
  } else {
    throw new ProviderError('bad_response');
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new ProviderError('bad_response');
  }
  return text;
}
