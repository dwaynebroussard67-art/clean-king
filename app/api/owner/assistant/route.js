import { callProvider, validateCustomBaseUrl } from '../../../../lib/ai/index.mjs';
import { loadSnapshot } from '../../../../lib/server/assistant-snapshot.mjs';
import {
  beginAssistantRun, createOwnerAssistantHandler, finishAssistantRun, readAssistantSecret,
} from '../../../../lib/server/owner-assistant-handler.mjs';
import { createSettingsStore } from '../../../../lib/server/assistant-settings-store.mjs';
import { ownerLoginEnabled, sessionClient } from '../../../../lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const env = process.env;
const store = client => createSettingsStore({ client, secretKey: env.ASSISTANT_SECRET_KEY });

export const POST = createOwnerAssistantHandler({
  env,
  ownerLoginEnabled,
  getSessionClient: sessionClient,
  loadSettings: client => store(client).load(),
  getSecret: (name, client) => readAssistantSecret(store(client), name),
  loadSnapshot,
  beginRun: beginAssistantRun,
  finishRun: finishAssistantRun,
  callProvider,
  validateCustomBaseUrl,
});
