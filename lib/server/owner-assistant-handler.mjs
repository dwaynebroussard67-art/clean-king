const BODY_LIMIT = 8192;
const VALID_CODES = new Set(['config', 'auth', 'rate_limit', 'timeout', 'upstream', 'bad_response', 'blocked_url']);
const FALLBACK_CODES = new Set(['upstream', 'timeout', 'rate_limit']);

const reply = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

export function createOwnerAssistantHandler(deps) {
  return async function handle(request) {
    const { env, ownerLoginEnabled } = deps;
    if (env.OWNER_ASSISTANT_ENABLED !== 'true' || !ownerLoginEnabled()) {
      return reply({ error: 'not_configured' }, 503);
    }
    if (request.headers.get('origin') !== env.APP_ORIGIN ||
        request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return reply({ error: 'rejected' }, 403);
    }
    const declaredLength = request.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > BODY_LIMIT) {
      return reply({ error: 'too_large' }, 413);
    }

    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return reply({ error: error?.message === 'too_large' ? 'too_large' : 'invalid' }, error?.message === 'too_large' ? 413 : 400);
    }
    const input = parseInput(body);
    if (!input) return reply({ error: 'invalid' }, 400);

    const session = await deps.getSessionClient();
    if (!session) return reply({ error: 'sign_in' }, 401);
    let user;
    try {
      const { data, error } = await session.auth.getUser();
      user = data?.user;
      if (error || !user?.id) return reply({ error: 'sign_in' }, 401);
    } catch {
      return reply({ error: 'sign_in' }, 401);
    }
    try {
      const { data: member, error } = await session.from('owner_memberships')
        .select('user_id').eq('user_id', user.id).maybeSingle();
      if (error || !member) return reply({ error: 'not_authorized' }, 403);
    } catch {
      return reply({ error: 'not_authorized' }, 403);
    }

    let runId = null;
    let success = false;
    let response;
    try {
      const loaded = await deps.loadSettings(session, user);
      const settings = loaded?.settings ?? loaded;
      if (!settings || settings.enabled !== true) {
        response = reply({ error: 'disabled' }, 503);
      } else {
        const admission = await deps.beginRun({
          perMinute: settings.limits.perMinute,
          perMonth: settings.limits.perMonth,
        }, session, user);
        const run = normalizeRun(admission);
        if (run.result === 'rate_limit' || run.result === 'monthly_limit') {
          response = reply({ error: 'rate_limited' }, 429);
        } else if (run.result !== 'ok' || !run.runId) {
          response = reply({ error: 'provider_failed' }, 503);
        } else {
          runId = run.runId;
          const primary = await resolveProvider(settings, 'primary', deps, session, user, env);
          if (!primary) {
            response = reply({ error: 'provider_not_set' }, 503);
          } else {
            const snapshot = await deps.loadSnapshot(session, settings.capabilities);
            const system = deps.buildSystemPrompt
              ? deps.buildSystemPrompt(settings, input.language, snapshot)
              : undefined;
            const providerMessages = [
              ...(input.history ?? []).map(({ role, text }) => ({ role, content: text })),
              { role: 'user', content: input.message },
            ];
            try {
              const result = await deps.callProvider({
                ...primary,
                system,
                messages: providerMessages,
                maxTokens: settings.limits.maxOutputTokens,
                temperature: settings.limits.temperature,
              });
              success = true;
              response = reply({ answer: result.text, meta: { provider: result.provider, model: result.model } });
            } catch (error) {
              if (shouldFallback(error, settings, primary.provider)) {
                const secondary = await resolveProvider(settings, 'custom', deps, session, user, env);
                if (secondary) {
                  try {
                    const result = await deps.callProvider({
                      ...secondary,
                      system,
                      messages: providerMessages,
                      maxTokens: settings.limits.maxOutputTokens,
                      temperature: settings.limits.temperature,
                    });
                    success = true;
                    response = reply({ answer: result.text, meta: { provider: result.provider, model: result.model } });
                  } catch {
                    response = reply({ error: 'provider_failed' }, 503);
                  }
                } else {
                  response = reply({ error: 'provider_failed' }, 503);
                }
              } else {
                response = reply({ error: 'provider_failed' }, errorStatus(error));
              }
            }
          }
        }
      }
    } catch {
      response = reply({ error: 'provider_failed' }, 503);
    } finally {
      if (runId) {
        try {
          await deps.finishRun(runId, success, session, user);
        } catch {
          // Quota metadata is intentionally best-effort; no request content is recorded.
        }
      }
    }
    return response ?? reply({ error: 'provider_failed' }, 503);
  };
}

async function resolveProvider(settings, requested, deps, session, user, env) {
  const provider = requested === 'primary' ? settings.provider.active : requested;
  if (provider === 'anthropic') {
    const key = await deps.getSecret(session, user, 'anthropic') || env.ANTHROPIC_API_KEY;
    if (!key || !settings.provider.anthropicModel) return null;
    return { provider, apiKey: key, model: settings.provider.anthropicModel };
  }
  if (provider === 'custom') {
    const checked = deps.validateCustomBaseUrl(settings.provider.customBaseUrl, {
      allowLocal: env.AI_ALLOW_LOCAL_CUSTOM === 'true' && env.NODE_ENV !== 'production',
    });
    if (!checked.ok || !settings.provider.customModel) return null;
    const key = await deps.getSecret(session, user, 'custom');
    if (!key) return null;
    return {
      provider,
      apiKey: key,
      model: settings.provider.customModel,
      baseUrl: checked.url,
      allowLocal: env.AI_ALLOW_LOCAL_CUSTOM === 'true' && env.NODE_ENV !== 'production',
    };
  }
  return null;
}

function shouldFallback(error, settings, provider) {
  return provider === 'anthropic' && settings.provider.fallbackToCustom === true &&
    FALLBACK_CODES.has(error?.code);
}

function errorStatus(error) {
  return VALID_CODES.has(error?.code) ? 503 : 503;
}

function normalizeRun(value) {
  const result = value?.data?.[0] ?? value?.[0] ?? value;
  return {
    result: result?.result,
    runId: result?.run_id ?? result?.runId ?? null,
  };
}

function parseInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'language,message' && keys.join(',') !== 'history,language,message') return null;
  if (!['en', 'es'].includes(value.language) || typeof value.message !== 'string' ||
      value.message.trim().length === 0 || value.message.length > 2500) return null;
  if (value.history !== undefined) {
    if (!Array.isArray(value.history) || value.history.length > 6) return null;
    for (let index = 0; index < value.history.length; index += 1) {
      const turn = value.history[index];
      const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
      if (!turn || typeof turn !== 'object' || Array.isArray(turn) ||
          Object.keys(turn).sort().join(',') !== 'role,text' || turn.role !== expectedRole ||
          typeof turn.text !== 'string' || turn.text.trim().length === 0 || turn.text.length > 1000) return null;
    }
    if (value.history.length % 2 === 1) return null;
  }
  return {
    message: value.message.trim(),
    language: value.language,
    ...(value.history ? { history: value.history } : {}),
  };
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT) {
      await reader.cancel();
      throw new Error('too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
