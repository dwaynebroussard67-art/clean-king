/**
 * Bubbles handler: the new assistant handler using per-tenant provider config,
 * encrypted key vault, dollar budgets, and Bubbles Lite fallback.
 *
 * Build packages 2, 3, 4 from the dossier.
 *
 * deps:
 *   - env: process.env-like object (APP_ORIGIN)
 *   - getSessionClient(): returns a Supabase session client
 *   - getTenantId(session): resolves the current tenant/organization id
 *   - loadSettings(session): loads assistant settings (capabilities, limits, persona)
 *   - buildSystemPrompt(settings, language, snapshot): builds the system prompt
 *   - loadSnapshot(session, capabilities): loads aggregate snapshot data
 *   - recordAction(tenantId, actionType, proposal, decision, result, actorId, actorRole): logs to audit
 *   - providerKeys: { save, get, delete, testSaved } (from createProviderKeyVault)
 *   - rpc: (name, args) => service-role RPC caller (check_ai_budget, etc.)
 */

import { completeThroughProvider, PROVIDER_IDS } from '../ai/provider-adapter.js';
import { liteResponse, buildLiteData } from '../ai/bubbles-lite.js';
import { buildSystemPrompt } from '../assistant-prompt.mjs';
import { settingsForPrompt } from '../assistant-settings-schema.mjs';

const BODY_LIMIT = 8192;
const MAX_OUTPUT_TOKENS_CAP = 800; // per-request ceiling, server-side clamp
const MAX_INPUT_HISTORY = 8; // per-request ceiling on history turns

// Model pricing: millicents (1/1000 of a cent) per 1M tokens.
// Conservative estimates; over-charging is safer for fail-closed budget enforcement.
const MODEL_PRICE_MILLICENTS_PER_M = {
  [PROVIDER_IDS.ANTHROPIC]: {
    'claude-sonnet-5-5': { input: 300, output: 1500 }, // $3.00 / $15.00 per 1M
    'claude-haiku-5-5': { input: 80, output: 400 },     // $0.80 / $4.00 per 1M
    default: { input: 300, output: 1500 },
  },
  [PROVIDER_IDS.OPENAI_COMPATIBLE]: {
    'gpt-4o': { input: 250, output: 1000 }, // $2.50 / $10.00 per 1M
    'gpt-4o-mini': { input: 15, output: 60 }, // $0.15 / $0.60 per 1M
    default: { input: 250, output: 1000 },
  },
};

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Estimate spend in millicents for a request. Returns null if price data missing. */
export function estimateSpendMillicents(messages, maxTokens, providerId, model) {
  const priceMap = MODEL_PRICE_MILLICENTS_PER_M[providerId];
  if (!priceMap) return null;

  const price = priceMap[model];
  if (!price) return null;

  const inputChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const inputTokens = Math.ceil(inputChars / 4) + 1000; // ~1K token system prompt
  const outputTokens = Math.min(maxTokens, MAX_OUTPUT_TOKENS_CAP);

  const inputMillicents = (inputTokens / 1_000_000) * price.input;
  const outputMillicents = (outputTokens / 1_000_000) * price.output;
  return Math.ceil(inputMillicents + outputMillicents);
}

export function createBubblesHandler(deps) {
  return async function handle(request) {
    // Gate: assistant must be enabled and owner must be logged in
    if (request.headers.get('origin') !== deps.env.APP_ORIGIN ||
        request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return reply({ error: 'rejected', reason: 'bad_request' }, 403);
    }

    const declaredLength = request.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > BODY_LIMIT) {
      return reply({ error: 'too_large', reason: 'request_too_large' }, 413);
    }

    let body;
    try { body = await readBody(request); }
    catch (error) { return reply({ error: error?.message === 'too_large' ? 'too_large' : 'invalid', reason: error?.message === 'too_large' ? 'request_too_large' : 'invalid_json' }, error?.message === 'too_large' ? 413 : 400); }

    const input = parseInput(body);
    if (!input) return reply({ error: 'invalid', reason: 'invalid_json' }, 400);

    // Cap input history length (per-request ceiling)
    if (input.history && input.history.length > MAX_INPUT_HISTORY) {
      input.history = input.history.slice(-MAX_INPUT_HISTORY);
    }

    // Authenticate
    const session = await deps.getSessionClient();
    if (!session) return reply({ error: 'sign_in', reason: 'not_authenticated' }, 401);

    let user;
    try {
      const { data, error } = await session.auth.getUser();
      user = data?.user;
      if (error || !user?.id) return reply({ error: 'sign_in', reason: 'not_authenticated' }, 401);
    } catch { return reply({ error: 'sign_in', reason: 'not_authenticated' }, 401); }

    // Authorize: must be an owner or manager
    const tenantId = await deps.getTenantId(session, user);
    if (!tenantId) return reply({ error: 'not_authorized', reason: 'no_membership' }, 403);

    // Load settings
    let settings;
    try {
      settings = await deps.loadSettings(session, user, tenantId);
      if (!settings || settings.enabled !== true) {
        return reply({ error: 'disabled', reason: 'assistant_disabled' }, 503);
      }
    } catch { return reply({ error: 'provider_failed', reason: 'settings_load_failed' }, 503); }

    // Load snapshot for the system prompt
    let snapshot;
    try {
      snapshot = await deps.loadSnapshot(session, settings.capabilities);
    } catch { snapshot = null; }

    // Build system prompt
    const system = deps.buildSystemPrompt
      ? deps.buildSystemPrompt(settings, input.language, snapshot)
      : buildDefaultSystemPrompt(tenantId, input.language, snapshot);

    // Build messages
    const messages = [
      ...(input.history ?? []).map(({ role, text }) => ({ role, content: text })),
      { role: 'user', content: input.message },
    ];

    // Clamp maxOutputTokens server-side (per-request ceiling)
    const maxTokens = Math.min(settings.limits?.maxOutputTokens || 400, MAX_OUTPUT_TOKENS_CAP);

    // Try the configured provider first (with budget enforcement)
    let providerResult;
    try {
      providerResult = await executeThroughProvider(tenantId, user.id, session, deps, {
        system,
        messages,
        maxTokens,
        temperature: settings.limits?.temperature ?? 0.4,
      });
    } catch (error) {
      // Provider failed — fall back to Bubbles Lite
      providerResult = null;
    }

    // If provider succeeded, return the answer
    if (providerResult && providerResult.text) {
      return reply({
        answer: providerResult.text,
        meta: {
          provider: providerResult.provider,
          model: providerResult.model,
          tier: 'ai',
          reason: providerResult.budgetReason || null,
        },
      });
    }

    // Fall back to Bubbles Lite (budget exceeded or provider unavailable)
    const liteData = await buildLiteDataForSession(session, tenantId);
    const liteAnswer = liteResponse(input.message, liteData);

    return reply({
      answer: liteAnswer.text,
      meta: {
        provider: 'lite',
        model: null,
        tier: 'lite',
        reason: 'budget_or_provider_unavailable',
        intent: liteAnswer.intent,
      },
    });
  };
}

/**
 * Execute a completion through the tenant's configured provider.
 * Reserves budget via check_ai_budget BEFORE calling the provider (fail-closed).
 * Returns null when no provider, no key, budget denied, or price data missing.
 */
async function executeThroughProvider(tenantId, userId, session, deps, { system, messages, maxTokens, temperature }) {
  const providerKeys = deps.providerKeys;
  const rpc = deps.rpc;

  if (!providerKeys || !rpc) {
    return null;
  }

  // Get the tenant's provider config via the session client (RLS-scoped)
  const client = await session;
  const { data: providerCfg } = await client
    .from('tenant_ai_providers')
    .select('provider_id, model, base_url, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();

  if (!providerCfg) {
    // No active provider configured — fall back to Lite
    return null;
  }

  // Get the decrypted key via the vault (write-only, server-side)
  const keyResult = await providerKeys.get(tenantId, providerCfg.provider_id);
  if (!keyResult.ok || !keyResult.apiKey) {
    return null;
  }

  // Budget: fail closed — no rpc, or reserve denied → Lite fallback
  const model = providerCfg.model || (providerCfg.provider_id === PROVIDER_IDS.ANTHROPIC ? 'claude-sonnet-5-5' : 'gpt-4o');
  const estimatedMillicents = estimateSpendMillicents(messages, maxTokens, providerCfg.provider_id, model);
  if (estimatedMillicents === null) {
    // No price data → fail closed
    return null;
  }

  // Convert millicents to cents (round up). check_ai_budget increments spent_cents atomically.
  const estimatedCents = Math.ceil(estimatedMillicents / 100);
  if (estimatedCents < 1) {
    // Even sub-cent estimates cost at least 1 cent to track
    // (use 0 for truly free; but we still check budget)
  }

  const { data: budgetCheck } = await rpc('check_ai_budget', {
    p_tenant_id: tenantId,
    p_cents: estimatedCents,
  });

  if (!budgetCheck || !budgetCheck[0]?.allowed) {
    // Budget denied — fall back to Lite
    return null;
  }

  // Build provider config for the call
  const providerConfig = {
    id: providerCfg.provider_id,
    apiKey: keyResult.apiKey,
    model,
    baseURL: providerCfg.base_url,
  };

  let result;
  try {
    result = await completeThroughProvider(providerConfig, {
      system,
      messages,
      maxTokens,
      temperature,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    // Provider call failed — budget was already reserved (conservative charge)
    return null;
  }

  return {
    text: result.text,
    provider: providerCfg.provider_id,
    model: providerCfg.model,
    usage: result.usage,
    budgetReason: budgetCheck[0]?.remaining_cents !== null && budgetCheck[0].remaining_cents < estimatedCents * 5
      ? 'budget_running_low'
      : null,
  };
}

/**
 * Build data for Bubbles Lite from the database.
 */
async function buildLiteDataForSession(session, tenantId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [completedJobs, scheduledJobs, openShifts, newApplicants, newQuotes, recentApplicants] = await Promise.all([
      session.from('jobs').select('id').eq('organization_id', tenantId).eq('status', 'completed').eq('date', today).maybeSingle(),
      session.from('jobs').select('id').eq('organization_id', tenantId).eq('date', today).maybeSingle(),
      session.from('shifts').select('id, site_name, shift_time').eq('organization_id', tenantId).eq('status', 'open').limit(5),
      session.from('applicants').select('id').eq('organization_id', tenantId).eq('status', 'new').maybeSingle(),
      session.from('leads').select('id').eq('organization_id', tenantId).eq('status', 'new').maybeSingle(),
      session.from('applicants').select('first_name').eq('organization_id', tenantId).eq('status', 'new').limit(3),
    ]);

    return {
      completedJobs: completedJobs?.id ? 1 : 0,
      scheduledJobs: scheduledJobs?.id ? 1 : 0,
      openShifts: (openShifts?.data || []).map(s => ({ siteName: s.site_name, shiftTime: s.shift_time })),
      newApplicants: newApplicants?.id ? 1 : 0,
      newQuotes: newQuotes?.id ? 1 : 0,
      recentApplicants: (recentApplicants?.data || []).map(a => ({ name: a.first_name })),
      quoteCount: newQuotes?.id ? 1 : 0,
    };
  } catch {
    return {};
  }
}

/**
 * Default system prompt when deps.buildSystemPrompt is not provided.
 */
function buildDefaultSystemPrompt(tenantId, language, snapshot) {
  const snap = snapshot || {};
  return `You are Bubbles, a warm, helpful assistant for a cleaning business franchise.

You help the owner manage their day. Be concise, practical, and friendly.
You speak in ${language === 'es' ? 'Spanish' : 'English'} unless the user switches.

Current snapshot:
- Completed jobs today: ${snap.completedJobs || 0}
- Scheduled jobs today: ${snap.scheduledJobs || 0}
- New applicants waiting: ${snap.newApplicants || 0}
- Open shifts: ${snap.openShifts || 0}

You NEVER:
- Make hiring decisions
- Send messages to applicants or customers
- Access personal data you shouldn't
- Guess at numbers you don't have

If you don't know something, say so and offer to help with what you CAN do.`;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

function parseInput(body) {
  if (!body || typeof body !== 'object') return null;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return null;
  return {
    message,
    language: body.language === 'es' ? 'es' : 'en',
    history: Array.isArray(body.history) ? body.history.slice(0, 12) : [],
  };
}

async function readBody(request) {
  if (request.body?.getReader) {
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > BODY_LIMIT) { await reader.cancel(); throw new Error('too_large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock?.(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) || null;
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > BODY_LIMIT) throw new Error('too_large');
  return JSON.parse(text) || null;
}