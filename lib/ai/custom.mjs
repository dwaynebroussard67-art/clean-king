import { ProviderError } from './errors.mjs';

export function buildCustomRequest({ baseUrl, apiKey, model, system, messages, maxTokens, temperature, signal }) {
  return {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal,
      redirect: 'manual',
    },
  };
}

export function parseCustomResponse(payload) {
  const message = payload?.choices?.[0]?.message;
  if (!message || typeof message !== 'object' ||
      Object.hasOwn(message, 'tool_calls') || Object.hasOwn(message, 'tool_use')) {
    throw new ProviderError('bad_response');
  }
  return {
    text: message.content,
    usage: normalizeUsage(payload.usage?.prompt_tokens, payload.usage?.completion_tokens),
  };
}

function normalizeUsage(inputTokens, outputTokens) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
      !Number.isSafeInteger(outputTokens) || outputTokens < 0) return undefined;
  return { inputTokens, outputTokens };
}
