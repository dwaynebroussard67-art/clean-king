import { createOwnerAssistantHandler } from '../../../../lib/server/owner-assistant-handler.mjs';
import { sessionClient, ownerLoginEnabled } from '../../../../lib/server/supabase.js';
import { createSettingsStore } from '../../../../lib/server/assistant-settings-store.mjs';
import { loadSnapshot } from '../../../../lib/server/assistant-snapshot.mjs';
import { callProvider, validateCustomBaseUrl } from '../../../../lib/ai/index.mjs';
import { buildSystemPrompt } from '../../../../lib/assistant-prompt.mjs';
import { settingsForPrompt } from '../../../../lib/assistant-settings-schema.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const env = process.env;
const storeFor = (session) => createSettingsStore({ client: session, secretKey: env.ASSISTANT_SECRET_KEY });

/**
 * Owner assistant endpoint — the single, audited implementation.
 *
 * Gates (all must pass): OWNER_ASSISTANT_ENABLED=true, development email-link owner
 * login enabled (production refuses both), exact-origin + JSON content-type, 8 KiB
 * body cap, signed-in user with an owner_memberships row, saved settings with
 * enabled=true, and an RPC quota admission (begin_assistant_run). Custom HTTPS
 * provider endpoints are DNS-pinned to validated public IP ranges; plain HTTP is
 * only ever considered for explicit localhost development. No applicant data is
 * sent besides the counters the owner explicitly enabled in settings.
 */
const handle = createOwnerAssistantHandler({
  env,
  ownerLoginEnabled,
  getSessionClient: sessionClient,
  loadSettings: async (session) => storeFor(session).load(),
  getSecret: async (session, _user, name) => {
    try {
      return await storeFor(session).getSecretPlain(name);
    } catch {
      // Treat unreadable/missing secret material as unset (fail closed), never fall back to partial decryption.
      return null;
    }
  },
  loadSnapshot,
  beginRun: (session) => session.rpc('begin_assistant_run'),
  finishRun: (runId, success, session) =>
    session.rpc('finish_assistant_run', { p_run_id: runId, p_success: success }),
  validateCustomBaseUrl,
  callProvider,
  buildSystemPrompt: (settings, language, snapshot) =>
    buildSystemPrompt(settingsForPrompt(settings), { language, snapshot }),
  logProvider: ({ provider, model }) => {
    // Metadata only: provider and model name. Never prompt, response, or key material.
    console.info('owner-assistant provider call', { provider, model });
  },
});

export const POST = (request) => handle(request);
