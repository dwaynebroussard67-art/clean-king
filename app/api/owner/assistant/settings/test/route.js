import { callProvider, validateCustomBaseUrl } from '../../../../../../lib/ai/index.mjs';
import { createSettingsStore } from '../../../../../../lib/server/assistant-settings-store.mjs';
import { beginAssistantRun, finishAssistantRun } from '../../../../../../lib/server/owner-assistant-handler.mjs';
import { createOwnerSettingsHandlers } from '../../../../../../lib/server/owner-settings-handler.mjs';
import { ownerLoginEnabled, sessionClient } from '../../../../../../lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const env = process.env;
const handlers = createOwnerSettingsHandlers({
  env,
  ownerLoginEnabled,
  getSessionClient: sessionClient,
  createStore: client => createSettingsStore({ client, secretKey: env.ASSISTANT_SECRET_KEY }),
  beginRun: beginAssistantRun,
  finishRun: finishAssistantRun,
  callProvider,
  validateCustomBaseUrl,
});

export const POST = handlers.POST_TEST;
