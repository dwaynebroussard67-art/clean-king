/**
 * Bubbles handler: the new assistant handler using per-tenant provider config,
 * encrypted key vault, dollar budgets, and Bubbles Lite fallback.
 *
 * Build packages 2, 3, 4 from the dossier.
 */

import { testProvider, completeThroughProvider, providerSummary, PROVIDER_IDS } from '../ai/provider-adapter.js';
import { saveProviderKey, getProviderKey, deleteProviderKey, testSavedProviderKey } from './provider-key-vault.mjs';
import { liteResponse, buildLiteData } from '../ai/bubbles-lite.js';
import { buildSystemPrompt } from '../assistant-prompt.mjs';
import { settingsForPrompt } from '../assistant-settings-schema.mjs';

const BODY_LIMIT = 8192;
const ETH_PRICE_PER_1K_TOKENS_CENTS = 0; // Placeholder; real calculation uses provider usage

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Create the Bubbles handler.
 *
 * deps:
 *   - getSessionClient(): returns a Supabase session client
 *   - getTenantId(session): resolves the current tenant/organization id
 *   - loadSettings(session): loads assistant settings (capabilities, limits, persona)
 *   - buildSystemPrompt(settings, language, snapshot): builds the system prompt
 *   - loadSnapshot(session, capabilities): loads aggregate snapshot data
 *   - recordAction(tenantId, actionType, proposal, decision, result, actorId, actorRole): logs to audit
 */
export function createBubblesHandler(deps) {
  return async function handle(request) {
    // Gate: assistant must be enabled and owner must be logged in
    if (request.headers.get('origin') !== deps.env.APP_ORIGIN ||
        request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return reply({ error: 'rejected' }, 403);
    }

    const declaredLength = request.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > BODY_LIMIT) {
      return reply({ error: 'too_large' }, 413);
    }

    let body;
    try { body = await readBody(request); }
    catch (error) { return reply({ error: error?.message === 'too_large' ? 'too_large' : 'invalid' }, error?.message === 'too_large' ? 413 : 400); }

    const input = parseInput(body);
    if (!input) return reply({ error: 'invalid' }, 400);

    // Authenticate
    const session = await deps.getSessionClient();
    if (!session) return reply({ error: 'sign_in' }, 401);

    let user;
    try {
      const { data, error } = await session.auth.getUser();
      user = data?.user;
      if (error || !user?.id) return reply({ error: 'sign_in' }, 401);
    } catch { return reply({ error: 'sign_in' }, 401); }

    // Authorize: must be an owner or manager
    const tenantId = await deps.getTenantId(session, user);
    if (!tenantId) return reply({ error: 'not_authorized' }, 403);

    // Load settings
    let settings;
    try {
      settings = await deps.loadSettings(session, user, tenantId);
      if (!settings || settings.enabled !== true) {
        return reply({ error: 'disabled' }, 503);
      }
    } catch { return reply({ error: 'provider_failed' }, 503); }

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

    // Try the configured provider first
    let providerResult;
    try {
      providerResult = await executeThroughProvider(tenantId, user.id, session, {
        system,
        messages,
        maxTokens: settings.limits.maxOutputTokens || 4096,
        temperature: settings.limits.temperature ?? 0.7,
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
        },
      });
    }

    // Fall back to Bubbles Lite
    const liteData = await buildLiteDataForSession(session, tenantId);
    const liteAnswer = liteResponse(input.message, liteData);

    return reply({
      answer: liteAnswer.text,
      meta: {
        provider: 'lite',
        model: null,
        tier: 'lite',
        intent: liteAnswer.intent,
      },
    });
  };
};

/**
 * Execute a completion through the tenant's configured provider.
 * Checks budget, decrypts key, calls provider, records spend.
 */
async function executeThroughProvider(tenantId, userId, session, { system, messages, maxTokens, temperature }) {
  // Get the tenant's provider config
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

  // Get the decrypted key
  const keyResult = await getProviderKey(tenantId, providerCfg.provider_id);
  if (!keyResult.ok || !keyResult.apiKey) {
    return null;
  }

  // Check budget
  const spendCents = estimateSpendCents(messages, maxTokens, providerCfg.provider_id);
  const { data: budgetCheck } = await client.rpc('check_ai_budget', {
    p_tenant_id: tenantId,
    p_cents: spendCents,
  });

  if (!budgetCheck || !budgetCheck[0]?.allowed) {
    // Budget exceeded — fall back to Lite
    return null;
  }

  // Build provider config for the call
  const providerConfig = {
    id: providerCfg.provider_id,
    apiKey: keyResult.apiKey,
    model: providerCfg.model || (providerCfg.provider_id === PROVIDER_IDS.ANTHROPIC ? 'claude-sonnet-5-5' : 'gpt-4o'),
    baseURL: providerCfg.base_url,
  };

  // Call the provider
  const result = await completeThroughProvider(providerConfig, {
    system,
    messages,
    maxTokens,
    temperature,
    signal: AbortSignal.timeout(30000),
  });

  // Record the actual spend (adjust based on real usage if available)
  const actualSpendCents = calculateSpendFromUsage(spendCents, result.usage);
  if (actualSpendCents !== spendCents) {
    await client.rpc('check_ai_budget', {
      p_tenant_id: tenantId,
      p_cents: actualSpendCents - spendCents, // Adjust the difference
    });
  }

  return {
    text: result.text,
    provider: providerCfg.provider_id,
    model: providerCfg.model,
    usage: result.usage,
  };
}

/**
 * Estimate spend in cents for a request.
 * Haiku: ~$0.0006/quick question → ~0.06 cents
 * Sonnet: ~$0.011/quick question → ~1.1 cents
 * Opus: ~$0.023/quick question → ~2.3 cents
 */
function estimateSpendCents(messages, maxTokens, providerId) {
  const inputTokens = messages.reduce((sum, m) => sum + (m.content?.length || 0) * 1.3, 0) + 6000; // system prompt ~6K tokens
  const outputTokens = maxTokens;

  if (providerId === PROVIDER_IDS.ANTHROPIC) {
    // Anthropic: Haiku $0.10/$1M input, $0.50/$1M output
    return Math.ceil((inputTokens * 0.00010 + outputTokens * 0.00050));
  }

  // OpenAI-compatible: assume GPT-4o pricing ($2.50/$1M input, $10/$1M output)
  return Math.ceil((inputTokens * 0.00025 + outputTokens * 0.00100));
}

function calculateSpendFromUsage(estimated, usage) {
  if (!usage) return estimated;
  // Adjust based on actual token usage if provider reports it
  const inputTokens = usage.input || estimated * 0.7;
  const outputTokens = usage.output || estimated * 0.3;
  return Math.ceil(inputTokens * 0.00025 + outputTokens * 0.00100);
}

/**
 * Build data for Bubbles Lite from the database.
 */
async function buildLiteDataForSession(session, tenantId) {
  try {
    const [completedJobs, scheduledJobs, openShifts, newApplicants, newQuotes, recentApplicants, quoteCount] = await Promise.all([
      session.from('jobs').select('id').eq('organization_id', tenantId).eq('status', 'completed').eq('date', new Date().toISOString().split('T')[0]).maybeSingle(),
      session.from('jobs').select('id').eq('organization_id', tenantId).eq('date', new Date().toISOString().split('T')[0]).maybeSingle(),
      session.from('shifts').select('id, site_name, shift_time').eq('organization_id', tenantId).eq('status', 'open').limit(5),
      session.from('applicants').select('id').eq('organization_id', tenantId).eq('status', 'new').maybeSingle(),
      session.from('leads').select('id').eq('organization_id', tenantId).eq('status', 'new').maybeSingle(),
      session.from('applicants').select('first_name').eq('organization_id', tenantId).eq('status', 'new').limit(3),
      session.from('leads').select('id').eq('organization_id', tenantId).eq('status', 'new').maybeSingle(),
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
    for (const chunk of chunks) bytes.set(chunk, offset += chunk.byteLength);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > BODY_LIMIT) throw new Error('too_large');
  return JSON.parse(text);
}
