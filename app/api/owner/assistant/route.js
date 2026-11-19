import { callProvider, validateCustomBaseUrl } from '../../../../lib/ai/index.mjs';
import { settingsForPrompt } from '../../../../lib/assistant-settings-schema.mjs';
import { buildSystemPrompt } from '../../../../lib/assistant-prompt.mjs';
import { createOwnerAssistantHandler } from '../../../../lib/server/owner-assistant-handler.mjs';
import { loadSnapshot } from '../../../../lib/server/assistant-snapshot.mjs';
import { createSettingsStore } from '../../../../lib/server/assistant-settings-store.mjs';
import { secretKeyValid } from '../../../../lib/server/secret-box.mjs';
import { adminClient, ownerLoginEnabled, sessionClient } from '../../../../lib/server/supabase.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const env = process.env;

const handle = createOwnerAssistantHandler({
  env,
  ownerLoginEnabled: () => ownerLoginEnabled() && secretKeyValid(process.env.ASSISTANT_SECRET_KEY),
  getSessionClient: sessionClient,
  loadSettings: async (_session, user) => settingsStore(user).load(),
  getSecret: async (_session, user, name) => settingsStore(user).getSecretPlain(name),
  loadSnapshot,
  beginRun: async (session) => {
    const { data, error } = await session.rpc('begin_assistant_run');
    if (error) throw new Error('quota_unavailable');
    return data;
  },
  finishRun: async (runId, success, session) => {
    const { error } = await session.rpc('finish_assistant_run', {
      p_run_id: runId,
      p_success: success,
    });
    if (error) throw new Error('quota_unavailable');
  },
  callProvider,
  validateCustomBaseUrl,
  logProvider: ({ provider, model }) => console.info('owner-assistant-provider', provider, model),
  buildSystemPrompt: (settings, language, snapshot) => buildSystemPrompt(
    settingsForPrompt(settings),
    { language, snapshot },
  ),
});

function settingsStore(user) {
  const client = adminClient();
  if (!client) throw new Error('settings_store_not_configured');
  return createSettingsStore({
    client,
    secretKey: process.env.ASSISTANT_SECRET_KEY,
    ownerId: user.id,
  });
}

export const POST = (request) => handle(request);
