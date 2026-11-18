import { createSettingsStore } from '../../../../../../lib/server/assistant-settings-store.mjs';
import { createOwnerSettingsHandlers } from '../../../../../../lib/server/owner-settings-handler.mjs';
import { secretKeyValid } from '../../../../../../lib/server/secret-box.mjs';
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
  secretKeyValid,
});

export const POST = handlers.POST_SECRET;
