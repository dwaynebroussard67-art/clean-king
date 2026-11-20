import { ProviderError } from './errors.mjs';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

export function buildAnthropicRequest({ apiKey, model, system, messages, maxTokens, temperature, signal }) {
  return {
    url: ANTHROPIC_MESSAGES_URL,
    init: {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages,
      }),
      signal,
      redirect: 'manual',
    },
  };
}

export function parseAnthropicResponse(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.content)) {
    throw new ProviderError('bad_response');
  }
  if (payload.content.some((block) => block?.type === 'tool_use' || block?.type === 'tool_calls')) {
    throw new ProviderError('bad_response');
  }
  const text = payload.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  return {
    text,
    usage: normalizeUsage(payload.usage?.input_tokens, payload.usage?.output_tokens),
  };
}

function normalizeUsage(inputTokens, outputTokens) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
      !Number.isSafeInteger(outputTokens) || outputTokens < 0) return undefined;
  return { inputTokens, outputTokens };
}
